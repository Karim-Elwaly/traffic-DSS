"""
Mega-Event & School Peak Surge Orchestrator Engine (Module 10).
Simulates stadium egress, exhibition dispersal, and school-cluster peak demand,
comparing uncontrolled simultaneous discharge with a staggered, zoned release
and an express egress chute.

The corridor is modelled as a fluid queue. Event vehicles first clear the venue
gate, then enter the corridor, where they compete with the base traffic. When
the corridor storage is full, vehicles remain at the gate: they cannot
physically enter the arterial. This two-stage queue is what makes simultaneous
egress dangerous and staggered release effective.

The previous implementation multiplied a single-lane queue by 6.5 m on a
four-lane arterial, capped clearance and delay-reduction percentages with
hardcoded floors, and left an unused ``effective_discharge_cap``.
"""

import math
from typing import List, Optional

from backend.app.models.schemas import (
    SurgeOrchestratorRequest,
    SurgeOrchestratorResponse,
    SurgeTimelineStep,
)

# ---------------------------------------------------------------------------
# Physical constants
# ---------------------------------------------------------------------------
CORRIDOR_LANES = 4
CORRIDOR_CAPACITY_PCE = 8000.0        # 4 lanes x 2,000 PCE/h

# Simultaneous venue egress forces merges and weaving across all lanes and
# costs roughly 15% of the arterial's discharge capacity. A channelized
# express chute preserves the full design capacity.
UNCONTROLLED_MERGE_CAPACITY_FACTOR = 0.85
EXPRESS_CHUTE_CAPACITY_FACTOR = 1.0

# A single released zone can empty its gates at this rate. When all gates open
# together the gate itself is not the bottleneck; the corridor is.
ZONE_GATE_CAPACITY_VPH = 4500.0
OPEN_GATE_CAPACITY_VPH = 50000.0

JAM_SPACING_M = 6.5
MAX_QUEUE_M = 2500.0
MAX_QUEUE_VEH = MAX_QUEUE_M * CORRIDOR_LANES / JAM_SPACING_M

QUEUE_CLEAR_THRESHOLD_VEH = 30.0
ANALYSIS_STEP_MIN = 10
HORIZON_MIN = 180
DT_HOURS = ANALYSIS_STEP_MIN / 60.0

# Gaussian release profiles (minutes).
UNCONTROLLED_CENTER_MIN = 30.0
UNCONTROLLED_SIGMA_MIN = 14.0
STAGGERED_FIRST_WAVE_MIN = 15.0
STAGGERED_SIGMA_MIN = 12.0
SURGE_ARRIVAL_CUTOFF_MIN = 80


def _gaussian_density(minute: float, center: float, sigma: float) -> float:
    return (
        1.0
        / (sigma * math.sqrt(2.0 * math.pi))
        * math.exp(-0.5 * ((minute - center) / sigma) ** 2)
    )


def _uncontrolled_event_flow(req: SurgeOrchestratorRequest, minute: float) -> float:
    """Hourly event flow at the corridor entrance (veh/h)."""
    if minute > SURGE_ARRIVAL_CUTOFF_MIN:
        return 0.0
    density = _gaussian_density(
        minute, UNCONTROLLED_CENTER_MIN, UNCONTROLLED_SIGMA_MIN
    )
    return req.surge_vehicles * density * 60.0


def _staggered_event_flow(
    req: SurgeOrchestratorRequest, minute: float, stagger_min: int
) -> float:
    """Hourly event flow when zones are released one after another."""
    if stagger_min <= 0:
        return _uncontrolled_event_flow(req, minute)

    sub_count = req.surge_vehicles / 3.0
    waves = [
        STAGGERED_FIRST_WAVE_MIN,
        STAGGERED_FIRST_WAVE_MIN + stagger_min,
        STAGGERED_FIRST_WAVE_MIN + 2 * stagger_min,
    ]
    flow = 0.0
    for wave_start in waves:
        density = _gaussian_density(
            minute, wave_start, STAGGERED_SIGMA_MIN
        )
        flow += sub_count * density * 60.0
    return flow


class _FluidCorridor:
    """Two-stage queue: venue gate -> corridor storage."""

    def __init__(self, discharge_capacity_pce: float, gate_capacity_vph: float):
        self.discharge_capacity_pce = discharge_capacity_pce
        self.gate_capacity_vph = gate_capacity_vph
        self.gate_queue_veh = 0.0
        self.corridor_queue_veh = 0.0
        self.max_corridor_queue_veh = 0.0

    def step(self, event_flow_vph: float, base_flow_pce: float) -> None:
        """Advances the two-stage queue by one analysis step."""
        # 1. Venue gate release.
        gate_offer = self.gate_queue_veh + event_flow_vph * DT_HOURS
        gate_release = min(gate_offer, self.gate_capacity_vph * DT_HOURS)
        self.gate_queue_veh = gate_offer - gate_release

        # 2. Corridor admission: vehicles cannot enter beyond physical storage.
        storage_free = max(0.0, MAX_QUEUE_VEH - self.corridor_queue_veh)
        admitted = min(gate_release, storage_free)
        self.gate_queue_veh += gate_release - admitted
        self.corridor_queue_veh += admitted

        # 3. Corridor discharge: base traffic has priority, the remainder of
        #    the design capacity serves event vehicles.
        event_capacity_vph = max(
            0.0, self.discharge_capacity_pce - base_flow_pce
        )
        departed = min(self.corridor_queue_veh, event_capacity_vph * DT_HOURS)
        self.corridor_queue_veh -= departed

        self.max_corridor_queue_veh = max(
            self.max_corridor_queue_veh, self.corridor_queue_veh
        )

    @property
    def total_queue_veh(self) -> float:
        return self.gate_queue_veh + self.corridor_queue_veh

    def max_queue_length_m(self) -> float:
        return min(
            MAX_QUEUE_M,
            self.max_corridor_queue_veh * JAM_SPACING_M / CORRIDOR_LANES,
        )


def evaluate_surge_orchestration(
    req: SurgeOrchestratorRequest,
) -> SurgeOrchestratorResponse:
    stagger_min = max(0, req.stagger_minutes)

    uncontrolled_capacity = (
        CORRIDOR_CAPACITY_PCE * UNCONTROLLED_MERGE_CAPACITY_FACTOR
    )
    staggered_capacity = CORRIDOR_CAPACITY_PCE * (
        EXPRESS_CHUTE_CAPACITY_FACTOR
        if req.enable_express_chute
        else UNCONTROLLED_MERGE_CAPACITY_FACTOR
    )

    uncontrolled = _FluidCorridor(
        uncontrolled_capacity, OPEN_GATE_CAPACITY_VPH
    )
    staggered = _FluidCorridor(
        staggered_capacity,
        ZONE_GATE_CAPACITY_VPH if stagger_min > 0 else OPEN_GATE_CAPACITY_VPH,
    )

    timeline: List[SurgeTimelineStep] = []
    peak_uncontrolled_vc = 0.0
    peak_staggered_vc = 0.0
    uncontrolled_delay_area = 0.0
    staggered_delay_area = 0.0
    uncontrolled_clearance: Optional[int] = None
    staggered_clearance: Optional[int] = None
    uncontrolled_peak_step = 0
    staggered_peak_step = 0
    uncontrolled_had_queue = False
    staggered_had_queue = False

    for step_min in range(0, HORIZON_MIN + 1, ANALYSIS_STEP_MIN):
        uncontrolled_flow = _uncontrolled_event_flow(req, step_min)
        staggered_flow = _staggered_event_flow(req, step_min, stagger_min)

        uncontrolled_total = req.base_corridor_flow_pce + uncontrolled_flow
        staggered_total = req.base_corridor_flow_pce + staggered_flow
        uncontrolled_vc = uncontrolled_total / CORRIDOR_CAPACITY_PCE
        staggered_vc = staggered_total / CORRIDOR_CAPACITY_PCE
        peak_uncontrolled_vc = max(peak_uncontrolled_vc, uncontrolled_vc)
        peak_staggered_vc = max(peak_staggered_vc, staggered_vc)

        uncontrolled.step(uncontrolled_flow, req.base_corridor_flow_pce)
        staggered.step(staggered_flow, req.base_corridor_flow_pce)

        uncontrolled_delay_area += uncontrolled.total_queue_veh * DT_HOURS
        staggered_delay_area += staggered.total_queue_veh * DT_HOURS

        if uncontrolled.corridor_queue_veh > QUEUE_CLEAR_THRESHOLD_VEH:
            uncontrolled_had_queue = True
            uncontrolled_peak_step = step_min
        elif (
            uncontrolled_had_queue
            and uncontrolled_clearance is None
            and step_min > uncontrolled_peak_step
        ):
            uncontrolled_clearance = step_min

        if staggered.corridor_queue_veh > QUEUE_CLEAR_THRESHOLD_VEH:
            staggered_had_queue = True
            staggered_peak_step = step_min
        elif (
            staggered_had_queue
            and staggered_clearance is None
            and step_min > staggered_peak_step
        ):
            staggered_clearance = step_min

        # A share of the queue clears each step; report the remaining vehicles.
        delay_saved_step = (
            max(
                0.0,
                (uncontrolled.total_queue_veh - staggered.total_queue_veh)
                / max(1.0, uncontrolled.total_queue_veh),
            )
            * 100.0
            if uncontrolled.total_queue_veh > 0.0
            else 0.0
        )

        timeline.append(
            SurgeTimelineStep(
                minute=step_min,
                uncontrolled_flow_vph=round(uncontrolled_total, 0),
                staggered_flow_vph=round(staggered_total, 0),
                corridor_capacity_vph=CORRIDOR_CAPACITY_PCE,
                uncontrolled_vc=round(uncontrolled_vc, 2),
                staggered_vc=round(staggered_vc, 2),
                uncontrolled_queue_veh=round(
                    uncontrolled.corridor_queue_veh, 0
                ),
                staggered_queue_veh=round(staggered.corridor_queue_veh, 0),
                delay_saved_pct=round(delay_saved_step, 1),
            )
        )

    # ------------------------------------------------------------------
    # Clearance and delay savings
    # ------------------------------------------------------------------
    # Clearance is the time after the peak queue at which the corridor queue
    # falls below 30 vehicles. A scenario that never queues is congestion-free
    # from minute zero.
    if not uncontrolled_had_queue:
        uncontrolled_clearance_min = 0
    elif uncontrolled_clearance is None:
        uncontrolled_clearance_min = HORIZON_MIN
    else:
        uncontrolled_clearance_min = uncontrolled_clearance

    if not staggered_had_queue:
        staggered_clearance_min = 0
    elif staggered_clearance is None:
        staggered_clearance_min = HORIZON_MIN
    else:
        staggered_clearance_min = staggered_clearance

    clearance_saved = max(
        0, uncontrolled_clearance_min - staggered_clearance_min
    )

    if uncontrolled_delay_area > 0.0:
        delay_reduction_pct = (
            (uncontrolled_delay_area - staggered_delay_area)
            / uncontrolled_delay_area
            * 100.0
        )
    else:
        delay_reduction_pct = 0.0
    delay_reduction_pct = max(0.0, min(100.0, delay_reduction_pct))

    # The coned chute is reclaimed once the last zone has finished releasing.
    if stagger_min > 0:
        release_complete_min = min(
            HORIZON_MIN,
            STAGGERED_FIRST_WAVE_MIN + 2 * stagger_min + 25,
        )
    else:
        release_complete_min = min(HORIZON_MIN, SURGE_ARRIVAL_CUTOFF_MIN)

    playbook_en = [
        "Minute 00: Deploy traffic cones along the right curb creating a 600 m express chute on Lane 1 for event egress only.",
        "Minute 15: Release Zone A (Upper Tier & VIP Exits) into the Lane 1 express chute; hold Zones B & C in the parking gates.",
        f"Minute {STAGGERED_FIRST_WAVE_MIN + stagger_min}: Release Zone B (mid-level concourses); keep the green-wave corridor flush offsets active.",
        f"Minute {STAGGERED_FIRST_WAVE_MIN + 2 * stagger_min}: Release Zone C (general parking plazas); keep the remaining through-lanes open for civil traffic.",
        (
            f"Minute {release_complete_min}: Event release complete. "
            "Reclaim the express-chute cones and restore normal 4-lane flow."
        ),
    ]

    playbook_ar = [
        "الدقيقة 00: فرد أقماع مرورية بطول 600 متر لتخصيص الحارة 1 كمسار سريع (Express Chute) مخصص لإخلاء الفعالية فقط.",
        "الدقيقة 15: فتح بوابات خروج القطاع (أ) (المدرجات العلوية وكبار الشخصيات) مع تثبيت بوابات القطاعين (ب) و(ج) مؤقتاً.",
        f"الدقيقة {STAGGERED_FIRST_WAVE_MIN + stagger_min}: فتح بوابات القطاع (ب) مع مزامنة موجة الإشارات الخضراء لتفريغ الدفعة دون توقف.",
        f"الدقيقة {STAGGERED_FIRST_WAVE_MIN + 2 * stagger_min}: فتح بوابات ساحات الانتظار العامة (ج) مع الحفاظ على انسياب الحارات المتبقية للمرور العابر للمحور.",
        (
            f"الدقيقة {release_complete_min}: اكتمال تفريغ الفعالية بالكامل. "
            "رفع الأقماع وإعادة فتح الحارة اليمنى للمرور الطبيعي."
        ),
    ]

    return SurgeOrchestratorResponse(
        corridor_id=req.corridor_id,
        event_type=req.event_type,
        surge_vehicles=req.surge_vehicles,
        uncontrolled_peak_vc=round(peak_uncontrolled_vc, 2),
        staggered_peak_vc=round(peak_staggered_vc, 2),
        uncontrolled_clearance_min=uncontrolled_clearance_min,
        staggered_clearance_min=staggered_clearance_min,
        clearance_time_saved_min=clearance_saved,
        aggregate_delay_reduction_pct=round(delay_reduction_pct, 1),
        max_uncontrolled_queue_m=round(
            uncontrolled.max_queue_length_m(), 0
        ),
        max_staggered_queue_m=round(staggered.max_queue_length_m(), 0),
        timeline=timeline,
        gate_playbook_en=playbook_en,
        gate_playbook_ar=playbook_ar,
    )

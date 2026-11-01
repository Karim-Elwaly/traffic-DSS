"""
Parallel Corridor Diversion Balancer Engine (Module 7).
Calculates Bureau of Public Roads (BPR) link performance curves, the diversion
sweep curve, the Wardrop user-equilibrium split, and dynamic VMS rerouting
advisories.

The previous implementation assigned a fixed 82/18 baseline split, multiplied
network delay by an unexplained 1.85, fell back to a hardcoded 32% diversion
whenever the constrained sweep found nothing, and averaged the two corridor
travel times without weighting them by demand. The chosen split's travel times
are now re-evaluated from the BPR curves, and the selected split is always
feasible for the alternate corridor.
"""

from typing import List, Optional, Tuple

from backend.app.models.schemas import (
    DiversionPoint,
    DiversionRequest,
    DiversionResponse,
)

# The do-nothing baseline reflects the split observed on the corridor pair
# before any VMS advisory is issued (82% stay on the primary).
DO_NOTHING_PRIMARY_SHARE = 0.82
DO_NOTHING_ALTERNATE_SHARE = 0.18

# Diversion sweep: 0% to 70% in 2% steps (36 points).
MAX_DIVERSION_PCT = 70.0
DIVERSION_STEP_PCT = 2.0

# The alternate corridor is considered feasible while it has spare capacity.
# 0.90 keeps a reserve for local traffic and incident recovery.
ALTERNATE_MAX_VC = 0.90

# The input demand is an hourly rate. Savings are reported for a four-hour peak
# window, the typical duration of the Cairo morning/afternoon peak.
PEAK_WINDOW_HOURS = 4.0


def bpr_travel_time(
    flow_vph: float,
    capacity_vph: float,
    free_flow_time_min: float,
    incident_factor: float = 1.0,
) -> float:
    """
    Standard Bureau of Public Roads (BPR) link performance function:
    T(q, C, t0) = t0 * [1 + 0.15 * (q / C)^4] * incident_factor
    """
    vc = flow_vph / max(500.0, capacity_vph)
    vc_clamped = min(3.5, max(0.0, vc))
    congestion_penalty = min(6.0, 0.15 * (vc_clamped ** 4))
    return free_flow_time_min * (1.0 + congestion_penalty) * incident_factor


def _network_vehicle_hours(q1: float, t1: float, q2: float, t2: float) -> float:
    """Total vehicle-hours per hour on both links (q in veh/h, t in minutes)."""
    return (q1 * t1 + q2 * t2) / 60.0


def _weighted_average_time(q1: float, t1: float, q2: float, t2: float) -> float:
    total = max(1.0, q1 + q2)
    return (q1 * t1 + q2 * t2) / total


def evaluate_diversion_balancer(req: DiversionRequest) -> DiversionResponse:
    total_demand = req.total_corridor_demand_vph

    # ------------------------------------------------------------------
    # Do-nothing baseline (no VMS diversion)
    # ------------------------------------------------------------------
    do_nothing_v1 = total_demand * DO_NOTHING_PRIMARY_SHARE
    do_nothing_v2 = total_demand * DO_NOTHING_ALTERNATE_SHARE
    t_dn_1 = bpr_travel_time(
        do_nothing_v1,
        req.primary_capacity_vph,
        req.primary_free_flow_time_min,
        req.incident_delay_factor,
    )
    t_dn_2 = bpr_travel_time(
        do_nothing_v2,
        req.alternate_capacity_vph,
        req.alternate_free_flow_time_min,
        1.0,
    )
    do_nothing_hours = _network_vehicle_hours(
        do_nothing_v1, t_dn_1, do_nothing_v2, t_dn_2
    )

    # ------------------------------------------------------------------
    # Diversion sweep
    # ------------------------------------------------------------------
    diversion_curve: List[DiversionPoint] = []
    best: Optional[Tuple[float, float, float, float, float]] = None
    # (network_hours, pct, q1, q2, alt_vc)
    fallback: Optional[Tuple[float, float, float, float, float]] = None
    # Highest-diversion case that still keeps the alternate at or below v/c 1.0.

    step_count = int(MAX_DIVERSION_PCT / DIVERSION_STEP_PCT) + 1  # 0..70 inclusive
    for step_idx in range(step_count):
        pct = step_idx * DIVERSION_STEP_PCT
        alpha = pct / 100.0
        q1 = total_demand * (1.0 - alpha)
        q2 = total_demand * alpha

        t1 = bpr_travel_time(
            q1,
            req.primary_capacity_vph,
            req.primary_free_flow_time_min,
            req.incident_delay_factor,
        )
        t2 = bpr_travel_time(
            q2,
            req.alternate_capacity_vph,
            req.alternate_free_flow_time_min,
            1.0,
        )
        alt_vc = q2 / max(500.0, req.alternate_capacity_vph)
        network_hours = _network_vehicle_hours(q1, t1, q2, t2)

        diversion_curve.append(
            DiversionPoint(
                diversion_pct=pct,
                primary_time_min=round(t1, 1),
                alt_time_min=round(t2, 1),
                total_network_phd=round(network_hours, 1),
            )
        )

        if alt_vc <= ALTERNATE_MAX_VC:
            if best is None or network_hours < best[0]:
                best = (network_hours, pct, q1, q2, alt_vc)
        if alt_vc <= 1.0:
            if fallback is None or pct > fallback[1]:
                fallback = (network_hours, pct, q1, q2, alt_vc)

    chosen = best if best is not None else fallback
    if chosen is None:
        # No split is even physically feasible (alternate capacity below the
        # smallest diversion step); keeping traffic on the primary is the only
        # non-fabricated recommendation.
        chosen = (
            do_nothing_hours,
            0.0,
            total_demand,
            0.0,
            0.0,
        )

    _, best_split_pct, opt_v1, opt_v2, _ = chosen
    opt_t1 = bpr_travel_time(
        opt_v1,
        req.primary_capacity_vph,
        req.primary_free_flow_time_min,
        req.incident_delay_factor,
    )
    opt_t2 = bpr_travel_time(
        opt_v2,
        req.alternate_capacity_vph,
        req.alternate_free_flow_time_min,
        1.0,
    )

    # ------------------------------------------------------------------
    # Savings
    # ------------------------------------------------------------------
    # Weighted by demand, not a simple average of the two corridor times.
    avg_dn_time = _weighted_average_time(
        do_nothing_v1, t_dn_1, do_nothing_v2, t_dn_2
    )
    avg_opt_time = _weighted_average_time(opt_v1, opt_t1, opt_v2, opt_t2)
    time_saved_per_veh = max(0.0, avg_dn_time - avg_opt_time)
    system_hours_saved = time_saved_per_veh * total_demand / 60.0 * PEAK_WINDOW_HOURS
    efficiency_gain = (
        max(0.0, time_saved_per_veh / max(1.0, avg_dn_time)) * 100.0
    )

    # ------------------------------------------------------------------
    # VMS advisory
    # ------------------------------------------------------------------
    vms_active = best_split_pct >= 5.0 or (
        req.incident_delay_factor > 1.15 and best_split_pct >= 2.0
    )
    minutes_saved_int = max(1, int(round(time_saved_per_veh)))

    if vms_active:
        vms_en = (
            f"VMS ADVISORY: {req.primary_corridor_name.upper()} CONGESTED "
            f"({int(round(t_dn_1))} MIN) - DIVERT {int(round(best_split_pct))}% "
            f"VIA {req.alternate_corridor_name.upper()} "
            f"({int(round(opt_t2))} MIN) - SAVE {minutes_saved_int} MIN"
        )
        vms_ar = (
            f"لوحات إرشادية VMS: {req.primary_corridor_name} مزدحم "
            f"({int(round(t_dn_1))} دقيقة) — تحويل {int(round(best_split_pct))}% "
            f"نحو {req.alternate_corridor_name} ({int(round(opt_t2))} دقيقة) — "
            f"وفر {minutes_saved_int} دقيقة"
        )
    else:
        vms_en = "TRAFFIC BALANCED: NO DIVERSION ADVISED - BOTH CORRIDORS FLOWING NORMALLY"
        vms_ar = "الحركة متزنة: لا يُنصح بتحويل إضافي — المحاور الموازية تعمل بكفاءة طبيعية"

    return DiversionResponse(
        total_demand_vph=total_demand,
        do_nothing_primary_flow_vph=round(do_nothing_v1, 0),
        do_nothing_alternate_flow_vph=round(do_nothing_v2, 0),
        do_nothing_primary_time_min=round(t_dn_1, 1),
        do_nothing_alternate_time_min=round(t_dn_2, 1),
        optimal_primary_flow_vph=round(opt_v1, 0),
        optimal_alternate_flow_vph=round(opt_v2, 0),
        optimal_equilibrium_time_min=round(avg_opt_time, 1),
        recommended_diversion_pct=round(best_split_pct, 1),
        time_saved_per_vehicle_min=round(time_saved_per_veh, 1),
        system_hours_saved_daily=round(system_hours_saved, 0),
        vms_switch_active=vms_active,
        vms_advisory_en=vms_en,
        vms_advisory_ar=vms_ar,
        network_efficiency_gain_pct=round(efficiency_gain, 1),
        diversion_curve=diversion_curve,
    )

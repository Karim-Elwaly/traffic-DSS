"""
Module 3: Incident Shockwave & Micro-Friction Predictor Engine.
Implements LWR (Lighthill-Whitham-Richards) hydrodynamic shockwave equations,
computes backward shockwave speed (w in km/h), upstream exit blockage countdown,
60-minute queue progression curve, and micro-friction engineering interventions.
"""

import sys
from pathlib import Path

_ROOT_DIR = Path(__file__).resolve().parent.parent.parent.parent
if str(_ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(_ROOT_DIR))

import math
from typing import List, Dict, Any, Optional
from backend.app.models.schemas import (
    ShockwaveRequest,
    ShockwaveResponse,
    QueueProgressionStep,
    ShockwaveSOP,
)


JAM_SPACING_M = 6.5
JAM_DENSITY_PER_LANE_VEH_KM = 1000.0 / JAM_SPACING_M  # 153.8 veh/km/lane
MAX_SHOCKWAVE_KMH = 25.0
MAX_TIME_TO_BLOCK_MIN = 240.0
NO_BLOCKAGE_SENTINEL = 999.0


def predict_incident_shockwave(
    request: ShockwaveRequest,
    arrival_flow_pce: float,
    arrival_speed_kmh: float,
    upstream_exit_distance_m: float = 600.0,
    base_capacity_per_lane: float = 2000.0,
    avg_pce: float = 1.2,
) -> ShockwaveResponse:
    """
    Simulates LWR shockwave propagation and micro-friction impacts during an
    incident.

    All flows are PCE/h and all densities are PCE/km so the LWR wave speed
    ``w = dq / dk`` has consistent units. The physical jam density is converted
    to PCE/km with the same fleet-average PCE used to build the demand. The wave
    speed is bounded to a physically observed 25 km/h, and the queue cannot grow
    beyond the upstream storage between the incident and the previous exit.
    """
    total_lanes = 4
    open_lanes = max(1, total_lanes - request.blocked_lanes)
    avg_pce = max(1.0, min(3.0, avg_pce))

    # 1. State 1: Upstream arrival conditions
    q1 = max(0.0, arrival_flow_pce)
    v1 = max(15.0, min(arrival_speed_kmh, 120.0))
    k1_veh = q1 / max(1.0, v1) / avg_pce  # physical veh/km across all lanes
    k1_pce = k1_veh * avg_pce  # PCE/km, consistent with q1

    # 2. State 2: Bottleneck discharge conditions
    # Microbus stops or erratic weaving degrade capacity by up to 32%
    micro_friction_factor = max(0.68, 1.0 - (0.32 * request.weaving_index))

    # Incident type severity factor
    incident_penalties = {
        "STALL": 0.95,
        "COLLISION": 0.88,
        "MICROBUS_STOP": 0.78,  # Frequent lane-cutting and sudden stopping
    }
    incident_factor = incident_penalties.get(request.incident_type.upper(), 0.90)

    # Bottleneck capacity in PCE/h
    q2 = base_capacity_per_lane * open_lanes * micro_friction_factor * incident_factor

    # Jam density: 6.5 m stopped spacing, converted to PCE/km. A queue cannot
    # physically store more vehicles than this.
    k_jam_veh = JAM_DENSITY_PER_LANE_VEH_KM * total_lanes
    k_jam_pce = k_jam_veh * avg_pce

    # 3. LWR Backward Shockwave Speed
    excess_flow = max(0.0, q1 - q2)
    density_headroom = max(1e-6, k_jam_pce - min(k1_pce, k_jam_pce * 0.95))
    if excess_flow > 1e-6:
        w_speed_kmh = min(MAX_SHOCKWAVE_KMH, excess_flow / density_headroom)
    else:
        w_speed_kmh = 0.0

    # 4. Countdown to Upstream Exit Blockage
    upstream_exit_m = max(50.0, upstream_exit_distance_m)
    if w_speed_kmh > 0.05:
        raw_time_to_block = (upstream_exit_m / 1000.0) / w_speed_kmh * 60.0
        time_to_block_min = min(MAX_TIME_TO_BLOCK_MIN, raw_time_to_block)
    else:
        time_to_block_min = NO_BLOCKAGE_SENTINEL

    is_spillback_imminent = time_to_block_min <= 20.0

    # Maximum number of physical vehicles the upstream storage can hold.
    storage_veh = upstream_exit_m / JAM_SPACING_M * total_lanes

    # 5. 60-Minute Queue Progression (every 5 minutes)
    queue_progression: List[QueueProgressionStep] = []
    for t_min in range(0, 65, 5):
        if w_speed_kmh > 0.0:
            elapsed_h = t_min / 60.0
            # Shockwave travel distance, capped by the upstream storage.
            q_len_m = min(upstream_exit_m, w_speed_kmh * elapsed_h * 1000.0)
            excess_veh = excess_flow / avg_pce * elapsed_h
            geometry_veh = q_len_m / JAM_SPACING_M * total_lanes
            veh_queued = int(max(0.0, min(storage_veh, excess_veh, geometry_veh)))
            # Speed degrades as the queue approaches the upstream exit.
            curr_speed = max(
                10.0,
                v1 - (q_len_m / upstream_exit_m) * (v1 - 10.0),
            )
        else:
            q_len_m = 0.0
            veh_queued = 0
            curr_speed = v1

        spillback_reached = q_len_m >= upstream_exit_m - 0.5

        queue_progression.append(
            QueueProgressionStep(
                elapsed_minutes=t_min,
                queue_length_m=round(q_len_m, 1),
                spillback_reached=spillback_reached,
                vehicles_in_queue=veh_queued,
                upstream_speed_kmh=round(curr_speed, 1),
            )
        )

    # 6. Micro-Friction Containment Recommendations & SOP
    remedy_en = (
        f"Install 140m high-tensile steel pedestrian/curb barrier at kilometer marker to prevent random drop-offs, "
        f"and formalize microbus bay 250m downstream with deceleration pocket. "
        f"Recovers estimated +{round(request.weaving_index * 26.0, 1)}% corridor throughput."
    )
    remedy_ar = (
        f"تركيب حاجز معدني فاصل بطول 140 متراً لمنع التوقف والنزول العشوائي لمركبات الميكروباص، "
        f"وترحيل موقف التحميل على بعد 250 متراً للأمام مع حارة تباطؤ مخصصة. "
        f"يستعيد هذا الإجراء حوالي +{round(request.weaving_index * 26.0, 1)}% من سعة المحور المهدرة."
    )

    if time_to_block_min >= NO_BLOCKAGE_SENTINEL:
        block_phrase_en = "No upstream exit blockage is expected while demand remains at or below the bottleneck capacity."
        block_phrase_ar = "لا يُتوقع ارتداد الطابور إلى المخرج السابق ما دام الطلب عند سعة عنق الزجاجة أو أقل."
    else:
        block_phrase_en = (
            f"Upstream exit blockage estimated in {time_to_block_min:.1f} minutes at a "
            f"{w_speed_kmh:.1f} km/h backward shockwave."
        )
        block_phrase_ar = (
            f"من المتوقع وصول الطابور إلى المخرج السابق خلال {time_to_block_min:.1f} دقيقة "
            f"بسرعة ارتداد {w_speed_kmh:.1f} كم/س."
        )

    actions_en = [
        f"URGENT: {block_phrase_en}",
        f"Dispatch Traffic Police rapid-intervention patrol to upstream exit ({upstream_exit_m:.0f}m) to hold or divert incoming flows.",
        f"Switch Dynamic Message Signs (DMS) to 'INCIDENT AHEAD - MERGE INTO LANES 3 & 4 - MAX SPEED 40 KM/H'.",
        f"Deploy heavy rotator tow truck for immediate clearance of blocked lane(s).",
    ]
    actions_ar = [
        f"تنبيه طارئ: {block_phrase_ar}",
        f"توجيه دورية مرور سريعة إلى المخرج السابق (على بعد {upstream_exit_m:.0f}م) لإدارة وتوزيع الكثافات.",
        f"تفعيل اللوحات الإرشادية المتغيرة (DMS): 'حادث أمامك - الالتزام بالحارات 3 و 4 - أقصى سرعة 40 كم/س'.",
        f"استدعاء ونش الإنقاذ السريع لرفع المركبة المتعطلة وفتح الحارات فوراً.",
    ]

    severity = (
        "HIGH - RED ALERT"
        if is_spillback_imminent
        else "MODERATE - AMBER"
        if w_speed_kmh > 0.0
        else "LOW - GREEN"
    )

    sop = ShockwaveSOP(
        incident_severity=severity,
        time_to_block_min=round(time_to_block_min, 1),
        backward_shockwave_speed_kmh=round(w_speed_kmh, 1),
        bottleneck_discharge_pce=round(q2, 1),
        containment_actions_en=actions_en,
        containment_actions_ar=actions_ar,
        micro_friction_remedy_en=remedy_en,
        micro_friction_remedy_ar=remedy_ar,
    )

    return ShockwaveResponse(
        corridor_id=request.corridor_id,
        arrival_flow_pce=round(q1, 1),
        arrival_speed_kmh=round(v1, 1),
        arrival_density_veh_km=round(k1_veh, 1),
        bottleneck_capacity_pce=round(q2, 1),
        jam_density_veh_km=round(k_jam_veh, 1),
        backward_shockwave_speed_kmh=round(w_speed_kmh, 1),
        upstream_exit_distance_m=round(upstream_exit_m, 1),
        time_to_block_minutes=round(time_to_block_min, 1),
        is_spillback_imminent=is_spillback_imminent,
        queue_progression=queue_progression,
        sop=sop,
    )

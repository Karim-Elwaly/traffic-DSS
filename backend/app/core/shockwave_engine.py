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

from typing import List, Dict, Any, Optional
from backend.app.models.schemas import (
    ShockwaveRequest,
    ShockwaveResponse,
    QueueProgressionStep,
    ShockwaveSOP,
)


def predict_incident_shockwave(
    request: ShockwaveRequest,
    arrival_flow_pce: float,
    arrival_speed_kmh: float,
    upstream_exit_distance_m: float = 600.0,
    base_capacity_per_lane: float = 2000.0,
) -> ShockwaveResponse:
    """
    Simulates LWR shockwave propagation and micro-friction impacts during an incident.
    """
    total_lanes = 4
    open_lanes = max(1, total_lanes - request.blocked_lanes)

    # 1. State 1: Upstream arrival conditions
    q1 = arrival_flow_pce
    v1 = max(15.0, arrival_speed_kmh)
    k1 = q1 / v1  # density in veh/km across 4 lanes

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

    # Bottleneck capacity
    q2 = base_capacity_per_lane * open_lanes * micro_friction_factor * incident_factor

    # Jam density across 4 lanes (145 veh/km/lane)
    k_jam = 145.0 * total_lanes  # 580.0 veh/km

    # 3. LWR Backward Shockwave Speed
    if q1 > q2:
        w_speed_kmh = abs((q2 - q1) / max(10.0, (k_jam - k1)))
    else:
        w_speed_kmh = 0.0

    # 4. Countdown to Upstream Exit Blockage
    upstream_exit_km = upstream_exit_distance_m / 1000.0
    if w_speed_kmh > 0.0:
        time_to_block_min = (upstream_exit_km / w_speed_kmh) * 60.0
    else:
        time_to_block_min = 999.0

    is_spillback_imminent = time_to_block_min <= 20.0

    # 5. 60-Minute Queue Progression (every 5 minutes)
    queue_progression: List[QueueProgressionStep] = []
    for t_min in range(0, 65, 5):
        if w_speed_kmh > 0.0:
            # Physical queue length in meters
            q_len_m = (w_speed_kmh * (t_min / 60.0)) * 1000.0
            veh_queued = int(max(0.0, (q1 - q2) * (t_min / 60.0)))
            # Speed degrades as queue builds up
            curr_speed = max(10.0, v1 - (q_len_m / upstream_exit_distance_m) * (v1 - 12.0))
        else:
            q_len_m = 0.0
            veh_queued = 0
            curr_speed = v1

        spillback_reached = q_len_m >= upstream_exit_distance_m

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

    actions_en = [
        f"URGENT: Upstream exit blockage estimated in {time_to_block_min:.1f} minutes at shockwave speed {w_speed_kmh:.1f} km/h.",
        f"Dispatch Traffic Police rapid-intervention patrol to upstream exit ({upstream_exit_distance_m:.0f}m) to hold or divert incoming flows.",
        f"Switch Dynamic Message Signs (DMS) to 'INCIDENT AHEAD - MERGE INTO LANES 3 & 4 - MAX SPEED 40 KM/H'.",
        f"Deploy heavy rotator tow truck for immediate clearance of blocked lane(s).",
    ]
    actions_ar = [
        f"تنبيه طارئ: متوقع إغلاق المخرج السابق خلال {time_to_block_min:.1f} دقيقة بسرعة ارتداد للموجة {w_speed_kmh:.1f} كم/س.",
        f"توجيه دورية مرور سريعة إلى المخرج السابق (على بعد {upstream_exit_distance_m:.0f}م) لإدارة وتوزيع الكثافات.",
        f"تفعيل اللوحات الإرشادية المتغيرة (DMS): 'حادث أمامك - الالتزام بالحارات 3 و 4 - أقصى سرعة 40 كم/س'.",
        f"استدعاء ونش الإنقاذ السريع لرفع المركبة المتعطلة وفتح الحارات فوراً.",
    ]

    sop = ShockwaveSOP(
        incident_severity="HIGH - RED ALERT" if is_spillback_imminent else "MODERATE - AMBER",
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
        arrival_density_veh_km=round(k1, 1),
        bottleneck_capacity_pce=round(q2, 1),
        jam_density_veh_km=round(k_jam, 1),
        backward_shockwave_speed_kmh=round(w_speed_kmh, 1),
        upstream_exit_distance_m=upstream_exit_distance_m,
        time_to_block_minutes=round(time_to_block_min, 1),
        is_spillback_imminent=is_spillback_imminent,
        queue_progression=queue_progression,
        sop=sop,
    )

"""
Module 4: Dynamic Reversible Lanes & Green Wave Planner Engine.
Evaluates 4+4 vs 5+3 dynamic barrier lane reallocation during peak directional surges,
and computes Green Wave signal progression offsets and emergency pre-arrival queue flush timings.
"""

import sys
from pathlib import Path

_ROOT_DIR = Path(__file__).resolve().parent.parent.parent.parent
if str(_ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(_ROOT_DIR))

from typing import List, Dict, Any
from backend.app.models.schemas import (
    ReversibleRequest,
    ReversibleResponse,
    ReversibleConfigMetric,
    GreenWaveIntersection,
)


def evaluate_reversible_corridor(request: ReversibleRequest) -> ReversibleResponse:
    """
    Simulates dynamic lane reallocation (5+3) against baseline (4+4)
    and computes Green Wave synchronization offsets.

    Delay is derived from the travel-time difference between the congested
    speed and the free-flow speed, so ``inbound_delay`` and
    ``travel_time_saved_pct`` can never contradict each other. It is capped at
    600 s. Queue and flush estimates are capped by the physical corridor
    storage. A 5+3 reallocation is viable when the outbound direction keeps a
    safe v/c margin and the inbound travel time actually improves.
    """
    total_flow = request.inbound_flow + request.outbound_flow
    split_pct = (request.inbound_flow / max(1.0, total_flow)) * 100.0
    free_flow_speed_kmh = 75.0
    free_flow_time_min = (
        request.corridor_length_km / free_flow_speed_kmh
    ) * 60.0

    def travel_delay_sec(travel_time_min: float) -> float:
        # Delay is the extra time spent relative to a free-flow trip over the
        # same corridor, capped for slider extremes.
        return max(0.0, min(600.0, (travel_time_min - free_flow_time_min) * 60.0))

    # -----------------------------------------------------------------------
    # Baseline Configuration: Standard 4 Inbound / 4 Outbound
    # -----------------------------------------------------------------------
    std_in_cap = 7200.0  # 4 * 1800
    std_out_cap = 7200.0
    std_in_vc = request.inbound_flow / std_in_cap
    std_out_vc = request.outbound_flow / std_out_cap

    # Free flow speed 75 km/h, drops as v/c exceeds 0.70
    std_in_speed = max(
        12.0,
        75.0 * (1.0 - 0.75 * max(0.0, std_in_vc - 0.65)),
    )
    std_in_time_min = (request.corridor_length_km / std_in_speed) * 60.0
    std_in_delay = travel_delay_sec(std_in_time_min)
    std_out_safety = max(0.0, min(100.0, (1.0 - std_out_vc) * 100.0))

    config_std = ReversibleConfigMetric(
        configuration_name="Standard 4+4 Static Lanes",
        inbound_lanes=4,
        outbound_lanes=4,
        inbound_capacity=std_in_cap,
        outbound_capacity=std_out_cap,
        inbound_vc_ratio=round(std_in_vc, 2),
        outbound_vc_ratio=round(std_out_vc, 2),
        inbound_speed_kmh=round(std_in_speed, 1),
        inbound_travel_time_min=round(std_in_time_min, 1),
        inbound_delay_sec=round(std_in_delay, 1),
        outbound_safety_margin_pct=round(std_out_safety, 1),
        is_viable=std_in_vc <= 1.0 and std_out_vc <= 1.0,
    )

    # -----------------------------------------------------------------------
    # Dynamic Reversible Configuration: 5 Inbound / 3 Outbound
    # -----------------------------------------------------------------------
    rev_in_cap = 8850.0   # 5 * 1770 (slight merge friction on reversible lane)
    rev_out_cap = 5250.0  # 3 * 1750
    rev_in_vc = request.inbound_flow / rev_in_cap
    rev_out_vc = request.outbound_flow / rev_out_cap

    rev_in_speed = max(
        15.0,
        75.0 * (1.0 - 0.75 * max(0.0, rev_in_vc - 0.65)),
    )
    rev_in_time_min = (request.corridor_length_km / rev_in_speed) * 60.0
    rev_in_delay = travel_delay_sec(rev_in_time_min)
    rev_out_safety = max(0.0, min(100.0, (1.0 - rev_out_vc) * 100.0))
    # Reversible operation is viable when the direction that loses a lane
    # retains a safe margin and the inbound direction is genuinely improved.
    # Inbound v/c may still exceed 1.0 at extreme surges; that is reported as a
    # residual oversaturation warning rather than used to veto an improvement.
    rev_is_viable = rev_out_vc < 0.85 and rev_in_vc < std_in_vc

    config_rev = ReversibleConfigMetric(
        configuration_name="Dynamic Reversible 5+3 Lanes",
        inbound_lanes=5,
        outbound_lanes=3,
        inbound_capacity=rev_in_cap,
        outbound_capacity=rev_out_cap,
        inbound_vc_ratio=round(rev_in_vc, 2),
        outbound_vc_ratio=round(rev_out_vc, 2),
        inbound_speed_kmh=round(rev_in_speed, 1),
        inbound_travel_time_min=round(rev_in_time_min, 1),
        inbound_delay_sec=round(rev_in_delay, 1),
        outbound_safety_margin_pct=round(rev_out_safety, 1),
        is_viable=rev_is_viable,
    )

    # Savings metrics
    time_saved_pct = max(
        0.0,
        min(
            100.0,
            round(
                ((std_in_time_min - rev_in_time_min) / max(0.1, std_in_time_min))
                * 100.0,
                1,
            ),
        ),
    )
    delay_saved_pct = max(
        0.0,
        round(((std_in_delay - rev_in_delay) / max(0.1, std_in_delay)) * 100.0, 1)
        if std_in_delay > 0
        else 0.0,
    )

    # Decision recommendation follows the specification:
    # directional split > 68% AND outbound standard 4+4 v/c < 0.45 (or emergency override).
    if (
        (split_pct > 68.0 and std_out_vc < 0.45 and rev_is_viable)
        or (request.emergency_mode and rev_is_viable)
    ):
        recommended_mode = "REVERSIBLE_5_3"
    else:
        recommended_mode = "STANDARD_4_4"

    # -----------------------------------------------------------------------
    # Green Wave Coordination (consecutive intersections)
    # -----------------------------------------------------------------------
    # Target progression speed = 60 km/h (16.67 m/s). The spacing must come
    # from the actual corridor length and the number of signals; a fixed 450 m
    # spacing is only correct for a 1.8 km corridor and produced impossible
    # offsets on an 8.5 km axis.
    progression_speed_ms = 60.0 / 3.6
    cycle_length = 90.0
    green_window = 52.0
    link_spacing_m = (
        request.corridor_length_km * 1000.0
        / max(1, request.intersections_count)
    )

    intersections_meta = [
        ("Axis Entrance Interchange", "تقاطع مدخل المحور"),
        ("Hyper One / Service Node", "تقاطع هايبر وان / المنطقة الخدمية"),
        ("Smart Village Main Bridge", "تقاطع كوبري القرية الذكية"),
        ("Abu Rawash Industrial Link", "تقاطع وصلة أبو رواش الصناعية"),
        ("Ring Road Connector Flyover", "تقاطع الربط مع الطريق الدائري"),
    ]

    green_wave_schedule: List[GreenWaveIntersection] = []
    cumulative_distance = 0.0

    for idx in range(1, request.intersections_count + 1):
        if idx <= len(intersections_meta):
            name_en, name_ar = intersections_meta[idx - 1]
        else:
            name_en, name_ar = f"Corridor Signal Node {idx}", f"تقاطع المحور رقم {idx}"
        if idx > 1:
            cumulative_distance += link_spacing_m
        offset_sec = (cumulative_distance / progression_speed_ms) % cycle_length

        green_wave_schedule.append(
            GreenWaveIntersection(
                intersection_index=idx,
                name_en=name_en,
                name_ar=name_ar,
                distance_from_start_m=round(cumulative_distance, 0),
                offset_seconds=round(offset_sec, 1),
                cycle_length_sec=cycle_length,
                green_window_sec=green_window,
            )
        )

    # Emergency Pre-Arrival Queue Flush Time
    # Little's law: average vehicles in the approach = arrival rate x delay.
    # Convert that count to a physical queue length with 7.5 m per vehicle over
    # the four inbound lanes, capped by the corridor storage.
    avg_queue_veh = (request.inbound_flow / 3600.0) * std_in_delay
    estimated_queue_m = min(
        request.corridor_length_km * 1000.0 * 0.90,
        max(0.0, avg_queue_veh * 7.5 / 4.0),
    )
    pre_arrival_flush_sec = (
        0.0
        if estimated_queue_m < 1.0
        else round(min(240.0, (estimated_queue_m / 8.5) + 18.0), 1)
    )

    # Executive Summaries
    if recommended_mode == "REVERSIBLE_5_3":
        residual_en = (
            f" Inbound demand remains above capacity at v/c {rev_in_vc:.2f}; "
            "pair the reallocation with upstream metering or demand management."
            if rev_in_vc > 1.0
            else ""
        )
        residual_ar = (
            f" لا يزال الطلب الداخل فوق السعة بنسبة استيعاب {rev_in_vc:.2f}؛ "
            "يجب دمج إعادة التوزيع مع تنظيم التدفق من المنبع أو إدارة الطلب."
            if rev_in_vc > 1.0
            else ""
        )
        exec_en = (
            f"RECOMMENDATION: ACTIVATE REVERSIBLE 5+3 CONFIGURATION. Directional surge is {split_pct:.1f}% Inbound. "
            f"Adding 5th inbound lane expands throughput to 8,850 PCE/h, increasing average travel speed from "
            f"{std_in_speed:.1f} to {rev_in_speed:.1f} km/h (saving {time_saved_pct:.1f}% travel time and "
            f"{delay_saved_pct:.1f}% of the inbound delay). Outbound capacity remains secure with a "
            f"{rev_out_safety:.1f}% safety buffer.{residual_en}"
        )
        exec_ar = (
            f"توصية العمليات: تفعيل نظام الحارة الترددية (5 للداخل / 3 للخارج). نسبة المدخل تصل إلى {split_pct:.1f}%. "
            f"تخصيص الحارة الخامسة يرفع سعة التدفق إلى 8,850 م.ر/س، مما يرفع متوسط السرعة من {std_in_speed:.1f} إلى "
            f"{rev_in_speed:.1f} كم/س (توفير {time_saved_pct:.1f}% من زمن الرحلة و{delay_saved_pct:.1f}% من تأخير المدخل) "
            f"مع بقاء هامش أمان {rev_out_safety:.1f}% للاتجاه المعاكس.{residual_ar}"
        )
    else:
        oversat_en = (
            f" The inbound direction is already oversaturated at v/c {std_in_vc:.2f}; "
            "the opposing flow leaves insufficient headroom for a safe 5+3 reallocation, "
            "so upstream metering or demand management is required."
            if std_in_vc > 1.0
            else ""
        )
        oversat_ar = (
            f" الاتجاه الداخل مشبع بالفعل بنسبة استيعاب {std_in_vc:.2f}؛ ولا يترك التدفق المعاكس هامشاً آمناً "
            "لإعادة توزيع 5+3، لذا يلزم تنظيم التدفق من المنبع أو إدارة الطلب."
            if std_in_vc > 1.0
            else ""
        )
        exec_en = (
            f"RECOMMENDATION: MAINTAIN STANDARD 4+4 LANES. Directional split ({split_pct:.1f}%) does not exceed the "
            f"68% activation threshold with a standard outbound v/c below 0.45, so barrier reallocation is not warranted "
            f"without penalizing the opposing direction.{oversat_en}"
        )
        exec_ar = (
            f"توصية العمليات: الإبقاء على التوزيع المتوازن (4 حارات لكل اتجاه). نسبة التدفق ({split_pct:.1f}%) لم تتجاوز "
            f"الحد الأدنى (68%) مع نسبة استيعاب للاتجاه المعاكس أقل من 0.45، لذا لا يبرر تعديل الحواجز حالياً.{oversat_ar}"
        )

    return ReversibleResponse(
        corridor_id=request.corridor_id,
        total_bidirectional_flow=round(total_flow, 1),
        directional_split_pct=round(split_pct, 1),
        recommended_mode=recommended_mode,
        standard_4_4=config_std,
        reversible_5_3=config_rev,
        travel_time_saved_pct=time_saved_pct,
        delay_reduction_pct=delay_saved_pct,
        green_wave_schedule=green_wave_schedule,
        pre_arrival_flush_time_sec=pre_arrival_flush_sec,
        executive_summary_en=exec_en,
        executive_summary_ar=exec_ar,
    )

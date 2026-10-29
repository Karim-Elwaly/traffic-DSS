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
    """
    total_flow = request.inbound_flow + request.outbound_flow
    split_pct = (request.inbound_flow / max(1.0, total_flow)) * 100.0

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
    std_in_delay = max(0.0, (std_in_vc - 0.75) * 220.0)
    std_out_safety = max(0.0, (1.0 - std_out_vc) * 100.0)

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
        is_viable=True,
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
    rev_in_delay = max(0.0, (rev_in_vc - 0.75) * 220.0)
    rev_out_safety = max(0.0, (1.0 - rev_out_vc) * 100.0)
    rev_is_viable = rev_out_vc < 0.85 and (split_pct >= 62.0 or request.emergency_mode)

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
        round(((std_in_time_min - rev_in_time_min) / max(0.1, std_in_time_min)) * 100.0, 1),
    )
    delay_saved_pct = max(
        0.0,
        round(((std_in_delay - rev_in_delay) / max(0.1, std_in_delay)) * 100.0, 1)
        if std_in_delay > 0
        else 0.0,
    )

    # Decision Recommendation
    if (split_pct >= 65.0 and rev_is_viable) or request.emergency_mode:
        recommended_mode = "REVERSIBLE_5_3"
    else:
        recommended_mode = "STANDARD_4_4"

    # -----------------------------------------------------------------------
    # Green Wave Coordination (5 Consecutive Intersections)
    # -----------------------------------------------------------------------
    # Target progression speed = 60 km/h (16.67 m/s)
    progression_speed_ms = 60.0 / 3.6
    cycle_length = 90.0
    green_window = 52.0

    intersections_meta = [
        ("Axis Entrance Interchange", "تقاطع مدخل المحور"),
        ("Hyper One / Service Node", "تقاطع هايبر وان / المنطقة الخدمية"),
        ("Smart Village Main Bridge", "تقاطع كوبري القرية الذكية"),
        ("Abu Rawash Industrial Link", "تقاطع وصلة أبو رواش الصناعية"),
        ("Ring Road Connector Flyover", "تقاطع الربط مع الطريق الدائري"),
    ]

    green_wave_schedule: List[GreenWaveIntersection] = []
    cumulative_distance = 0.0

    for idx, (name_en, name_ar) in enumerate(intersections_meta, start=1):
        if idx > 1:
            cumulative_distance += 480.0  # ~480 meters between nodes
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
    # Assuming baseline queue of ~85 meters before progression
    estimated_queue_m = max(25.0, (std_in_delay * 1.8))
    pre_arrival_flush_sec = round((estimated_queue_m / 8.5) + 18.0, 1)

    # Executive Summaries
    if recommended_mode == "REVERSIBLE_5_3":
        exec_en = (
            f"RECOMMENDATION: ACTIVATE REVERSIBLE 5+3 CONFIGURATION. Directional surge is {split_pct:.1f}% Inbound. "
            f"Adding 5th inbound lane expands throughput to 8,850 PCE/h, increasing average travel speed from "
            f"{std_in_speed:.1f} to {rev_in_speed:.1f} km/h (saving {time_saved_pct:.1f}% travel time). "
            f"Outbound capacity remains secure with a {rev_out_safety:.1f}% safety buffer."
        )
        exec_ar = (
            f"توصية العمليات: تفعيل نظام الحارة الترددية (5 للداخل / 3 للخارج). نسبة المدخل تصل إلى {split_pct:.1f}%. "
            f"تخصيص الحارة الخامسة يرفع سعة التدفق إلى 8,850 م.ر/س، مما يرفع متوسط السرعة من {std_in_speed:.1f} إلى "
            f"{rev_in_speed:.1f} كم/س (توفير {time_saved_pct:.1f}% من زمن الرحلة) مع بقاء هامش أمان {rev_out_safety:.1f}% للاتجاه المعاكس."
        )
    else:
        exec_en = (
            f"RECOMMENDATION: MAINTAIN STANDARD 4+4 LANES. Directional split ({split_pct:.1f}%) does not meet the "
            f"65% threshold required to warrant barrier reallocation without penalizing outbound safety."
        )
        exec_ar = (
            f"توصية العمليات: الإبقاء على التوزيع المتوازن (4 حارات لكل اتجاه). نسبة التدفق ({split_pct:.1f}%) لم تتجاوز "
            f"الحد الأدنى (65%) الذي يبرر تعديل الحواجز دون التأثير سلباً على الاتجاه المعاكس."
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

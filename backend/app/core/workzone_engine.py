"""
Module 1: Work-Zone & Lane Closure Advisor Engine.
Computes effective work-zone capacity, queue accumulation, spillback risk,
person-hours of delay (PHD), optimal maintenance windows, and bilingual SOPs.
"""

import sys
from pathlib import Path

_ROOT_DIR = Path(__file__).resolve().parent.parent.parent.parent
if str(_ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(_ROOT_DIR))

from typing import List, Dict, Any, Optional
from backend.app.core.hcm_math import (
    compute_workzone_capacity,
    compute_taper_and_buffer,
    calculate_los,
)
from backend.app.models.schemas import (
    WorkZoneRequest,
    WorkZoneResponse,
    HourlyWorkZoneDetail,
    WindowOption,
    WorkZoneSOP,
)


def evaluate_maintenance_window(
    start_hour: int,
    duration_hours: int,
    hourly_demands: List[float],
    hourly_passengers: List[float],
    workzone_capacity: float,
    open_lanes: int,
    upstream_exit_distance_m: float,
) -> Dict[str, Any]:
    """
    Simulates queue accumulation and person-hours of delay across a contiguous D-hour window.
    Accounts for queue carry-over during maintenance and post-maintenance queue dissipation.
    """
    queue_veh = 0.0
    total_phd = 0.0
    max_queue_len = 0.0
    has_spillback = False

    # Simulate from start_hour for duration_hours
    for step in range(duration_hours):
        h = (start_hour + step) % 24
        demand = hourly_demands[h]
        pax = hourly_passengers[h]

        # Queue accumulation
        queue_veh = max(0.0, queue_veh + demand - workzone_capacity)
        queue_length_m = (queue_veh * 6.5) / max(1, open_lanes)

        if queue_length_m > max_queue_len:
            max_queue_len = queue_length_m

        if queue_length_m >= upstream_exit_distance_m:
            has_spillback = True

        # Delay in seconds per vehicle
        vc_ratio = demand / max(1.0, workzone_capacity)
        delay_sec = 12.0 * (vc_ratio ** 3) + (queue_veh / max(1.0, workzone_capacity)) * 1800.0

        # Person-hours of delay
        pax_per_pce = pax / max(1.0, demand)
        phd = (demand * delay_sec / 3600.0) * pax_per_pce
        total_phd += phd

    return {
        "start_hour": start_hour,
        "end_hour": (start_hour + duration_hours) % 24,
        "total_phd": round(total_phd, 2),
        "max_queue_m": round(max_queue_len, 1),
        "has_spillback": has_spillback,
    }


def optimize_workzone_schedule(
    request: WorkZoneRequest,
    hourly_demands: List[float],
    hourly_passengers: List[float],
    hourly_heavy_ratios: List[float],
    corridor_speed_limit: float = 80.0,
    upstream_exit_distance_m: float = 600.0,
    base_capacity_per_lane: float = 2000.0,
) -> WorkZoneResponse:
    """
    Master Work-Zone Advisor optimizer:
    1. Computes effective capacity drop based on closed lanes and heavy traffic.
    2. Evaluates all 24 potential start hours.
    3. Identifies Top 3 Optimal Windows vs Worst Window.
    4. Generates standard 24h baseline curve and bilingual SOP.
    """
    n_closed = len(request.closed_lanes)
    open_lanes = max(1, 4 - n_closed)
    avg_heavy_ratio = sum(hourly_heavy_ratios) / max(1, len(hourly_heavy_ratios))

    # Calculate effective capacity
    c_wz, f_merge, f_lane, f_hv = compute_workzone_capacity(
        base_capacity_per_lane=base_capacity_per_lane,
        total_lanes=4,
        closed_lanes=request.closed_lanes,
        heavy_vehicle_proportion=avg_heavy_ratio,
    )
    base_corridor_capacity = base_capacity_per_lane * 4
    capacity_drop_pct = round(((base_corridor_capacity - c_wz) / base_corridor_capacity) * 100.0, 1)

    # 1. Evaluate 24 hourly curve assuming work zone is active
    hourly_curves: List[HourlyWorkZoneDetail] = []
    current_queue = 0.0

    for h in range(24):
        demand = hourly_demands[h]
        pax = hourly_passengers[h]

        current_queue = max(0.0, current_queue + demand - c_wz)
        q_len = (current_queue * 6.5) / open_lanes
        spillback = q_len >= upstream_exit_distance_m

        vc = demand / max(1.0, c_wz)
        delay_s = 12.0 * (vc ** 3) + (current_queue / max(1.0, c_wz)) * 1800.0
        pax_per_pce = pax / max(1.0, demand)
        phd = (demand * delay_s / 3600.0) * pax_per_pce

        los_grade = calculate_los(delay_s, vc)

        hourly_curves.append(
            HourlyWorkZoneDetail(
                hour=h,
                demand_pce=round(demand, 1),
                effective_capacity=round(c_wz, 1),
                queue_veh=round(current_queue, 1),
                queue_length_m=round(q_len, 1),
                spillback_risk=spillback,
                delay_sec_per_veh=round(delay_s, 1),
                person_hours_delay=round(phd, 2),
                level_of_service=los_grade,
            )
        )

    # 2. Evaluate all 24 potential start windows of duration_hours
    window_evaluations = []
    for h_start in range(24):
        res = evaluate_maintenance_window(
            start_hour=h_start,
            duration_hours=request.duration_hours,
            hourly_demands=hourly_demands,
            hourly_passengers=hourly_passengers,
            workzone_capacity=c_wz,
            open_lanes=open_lanes,
            upstream_exit_distance_m=upstream_exit_distance_m,
        )
        # Score = PHD + 5000 if spillback else 0
        score = res["total_phd"] + (5000.0 if res["has_spillback"] else 0.0)
        window_evaluations.append((score, res))

    # Sort windows: lowest score is best
    window_evaluations.sort(key=lambda x: x[0])

    top_3_options: List[WindowOption] = []
    for rank, (score, w) in enumerate(window_evaluations[:3], start=1):
        top_3_options.append(
            WindowOption(
                start_hour=w["start_hour"],
                end_hour=w["end_hour"],
                total_person_hours_delay=w["total_phd"],
                max_queue_length_m=w["max_queue_m"],
                has_spillback=w["has_spillback"],
                avg_speed_drop_pct=round(min(65.0, (w["max_queue_m"] / upstream_exit_distance_m) * 50.0), 1),
                rank=rank,
                is_recommended=(rank == 1),
            )
        )

    # Worst window
    worst_raw = window_evaluations[-1][1]
    worst_option = WindowOption(
        start_hour=worst_raw["start_hour"],
        end_hour=worst_raw["end_hour"],
        total_person_hours_delay=worst_raw["total_phd"],
        max_queue_length_m=worst_raw["max_queue_m"],
        has_spillback=worst_raw["has_spillback"],
        avg_speed_drop_pct=round(min(90.0, (worst_raw["max_queue_m"] / upstream_exit_distance_m) * 80.0), 1),
        rank=24,
        is_recommended=False,
    )

    # 3. Geometry & Field SOP
    l_taper, l_buffer = compute_taper_and_buffer(
        speed_limit_kmh=corridor_speed_limit,
        closed_lanes_count=n_closed,
    )
    workzone_speed_limit = max(40.0, corridor_speed_limit - 20.0)
    best_win = top_3_options[0]

    has_heavy_lane = (1 in request.closed_lanes or 2 in request.closed_lanes)
    divert_heavy = bool(has_heavy_lane and avg_heavy_ratio > 0.10)

    tactical_en = [
        f"Stage work zone equipment starting at {best_win.start_hour:02d}:00 with complete clearance by {best_win.end_hour:02d}:00.",
        f"Deploy sequential flashing arrow board and {l_taper}m merge taper upstream of lane closure.",
        f"Enforce mandatory deceleration buffer of {l_buffer}m and reduced speed limit of {workzone_speed_limit:.0f} km/h.",
        "Position rapid-response heavy recovery tow truck 150m upstream of merge taper.",
    ]
    if divert_heavy:
        tactical_en.append(
            "MANDATORY: Divert heavy trucks and microbuses to alternative service road at upstream exit to prevent weaving gridlock."
        )

    tactical_ar = [
        f"بدء أعمال الصيانة في تمام الساعة {best_win.start_hour:02d}:00 والانتهاء والإخلاء التام بحلول {best_win.end_hour:02d}:00.",
        f"تثبيت لوحة الأسهم المضيئة ومخاريط التحويل بطول مسافة التدرج (Taper) البالغة {l_taper} متر قبل منطقة الأعمال.",
        f"تطبيق منطقة أمان عازلة بطول {l_buffer} متر وخفض السرعة القانونية إلى {workzone_speed_limit:.0f} كم/س.",
        "تمركز ونش إنقاذ ورافعة ثقيلة على بعد 150 متر قبل بداية التدرج للتدخل الفوري.",
    ]
    if divert_heavy:
        tactical_ar.append(
            "إجراء إلزامي: تحويل مسار سيارات النقل الثقيل والميكروباص إلى المحور البديل عند المخرج السابق لمنع احتكاك المسارات."
        )

    sop = WorkZoneSOP(
        directive_id=f"SOP-WZ-{request.corridor_id.upper()}-{best_win.start_hour:02d}{best_win.end_hour:02d}",
        optimal_window_en=f"{best_win.start_hour:02d}:00 - {best_win.end_hour:02d}:00 (Duration: {request.duration_hours}h)",
        optimal_window_ar=f"من {best_win.start_hour:02d}:00 إلى {best_win.end_hour:02d}:00 (المدة: {request.duration_hours} ساعات)",
        taper_length_m=l_taper,
        buffer_space_m=l_buffer,
        posted_speed_limit_kmh=corridor_speed_limit,
        workzone_speed_limit_kmh=workzone_speed_limit,
        tow_truck_staging_m=150.0,
        heavy_vehicle_diversion=divert_heavy,
        tactical_instructions_en=tactical_en,
        tactical_instructions_ar=tactical_ar,
    )

    return WorkZoneResponse(
        corridor_id=request.corridor_id,
        n_closed=n_closed,
        closed_lanes=request.closed_lanes,
        duration_hours=request.duration_hours,
        base_corridor_capacity=base_corridor_capacity,
        workzone_capacity=round(c_wz, 1),
        capacity_drop_pct=capacity_drop_pct,
        hourly_curves=hourly_curves,
        optimal_windows=top_3_options,
        worst_window=worst_option,
        sop=sop,
    )

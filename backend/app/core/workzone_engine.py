"""
Module 1: Work-Zone & Lane Closure Advisor Engine.
Computes effective work-zone capacity, queue accumulation, spillback risk,
person-hours of delay (PHD), optimal maintenance windows (24h and 168h),
and bilingual SOPs.
"""

import sys
from pathlib import Path

_ROOT_DIR = Path(__file__).resolve().parent.parent.parent.parent
if str(_ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(_ROOT_DIR))

from typing import List, Dict, Any, Optional, Sequence
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


DAY_NAMES_EN = [
    "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
]
DAY_NAMES_AR = [
    "الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت",
]


def _simulate_hourly_step(
    demand: float,
    passengers: float,
    capacity: float,
    queue_veh: float,
    open_lanes: int,
    upstream_exit_distance_m: float,
) -> Dict[str, Any]:
    """Advances the queue recursion by one hour and evaluates delay/LoS."""
    queue_veh = max(0.0, queue_veh + demand - capacity)
    queue_length_m = (queue_veh * 6.5) / max(1, open_lanes)
    spillback = queue_length_m >= upstream_exit_distance_m

    vc_ratio = demand / max(1.0, capacity)
    delay_sec = 12.0 * (vc_ratio ** 3) + (queue_veh / max(1.0, capacity)) * 1800.0
    pax_per_pce = passengers / max(1.0, demand)
    phd = (demand * delay_sec / 3600.0) * pax_per_pce

    return {
        "queue_veh": queue_veh,
        "queue_length_m": queue_length_m,
        "spillback": spillback,
        "vc_ratio": vc_ratio,
        "delay_sec": delay_sec,
        "phd": phd,
        "los": calculate_los(delay_sec, vc_ratio),
    }


def evaluate_maintenance_window(
    start_hour: int,
    duration_hours: int,
    hourly_demands: List[float],
    hourly_passengers: List[float],
    workzone_capacity: float,
    open_lanes: int,
    upstream_exit_distance_m: float,
    day_of_week: int = 0,
) -> Dict[str, Any]:
    """
    Simulates queue accumulation and person-hours of delay across a contiguous
    D-hour window on a selected day (wrapping across midnight when required).
    """
    queue_veh = 0.0
    total_phd = 0.0
    max_queue_len = 0.0
    has_spillback = False

    for step in range(duration_hours):
        h = (start_hour + step) % 24
        state = _simulate_hourly_step(
            demand=hourly_demands[h],
            passengers=hourly_passengers[h],
            capacity=workzone_capacity,
            queue_veh=queue_veh,
            open_lanes=open_lanes,
            upstream_exit_distance_m=upstream_exit_distance_m,
        )
        queue_veh = state["queue_veh"]
        total_phd += state["phd"]
        max_queue_len = max(max_queue_len, state["queue_length_m"])
        has_spillback = has_spillback or state["spillback"]

    absolute_end = start_hour + duration_hours
    return {
        "start_hour": start_hour,
        "end_hour": absolute_end % 24,
        "day_of_week": day_of_week,
        "end_day_of_week": (day_of_week + absolute_end // 24) % 7,
        "total_phd": round(total_phd, 2),
        "max_queue_m": round(max_queue_len, 1),
        "has_spillback": has_spillback,
    }


def evaluate_weekly_maintenance_window(
    start_day: int,
    start_hour: int,
    duration_hours: int,
    weekly_demands: Sequence[Sequence[float]],
    weekly_passengers: Sequence[Sequence[float]],
    capacity_by_day: Sequence[float],
    open_lanes: int,
    upstream_exit_distance_m: float,
) -> Dict[str, Any]:
    """
    Evaluates a contiguous D-hour window anywhere in the 7-day x 24-hour week.
    Window hours and capacities roll across midnight and day boundaries correctly.
    """
    queue_veh = 0.0
    total_phd = 0.0
    max_queue_len = 0.0
    has_spillback = False

    for step in range(duration_hours):
        absolute = start_hour + step
        day = (start_day + absolute // 24) % 7
        hour = absolute % 24
        state = _simulate_hourly_step(
            demand=weekly_demands[day][hour],
            passengers=weekly_passengers[day][hour],
            capacity=capacity_by_day[day],
            queue_veh=queue_veh,
            open_lanes=open_lanes,
            upstream_exit_distance_m=upstream_exit_distance_m,
        )
        queue_veh = state["queue_veh"]
        total_phd += state["phd"]
        max_queue_len = max(max_queue_len, state["queue_length_m"])
        has_spillback = has_spillback or state["spillback"]

    absolute_end = start_hour + duration_hours
    return {
        "start_hour": start_hour,
        "end_hour": absolute_end % 24,
        "day_of_week": start_day,
        "end_day_of_week": (start_day + absolute_end // 24) % 7,
        "total_phd": round(total_phd, 2),
        "max_queue_m": round(max_queue_len, 1),
        "has_spillback": has_spillback,
    }


def _to_window_option(
    raw: Dict[str, Any],
    rank: int,
    is_recommended: bool,
    upstream_exit_distance_m: float,
) -> WindowOption:
    """Converts a raw window simulation into the API contract."""
    spillback_ratio = raw["max_queue_m"] / max(1.0, upstream_exit_distance_m)
    return WindowOption(
        start_hour=raw["start_hour"],
        end_hour=raw["end_hour"],
        day_of_week=raw.get("day_of_week"),
        end_day_of_week=raw.get("end_day_of_week"),
        total_person_hours_delay=raw["total_phd"],
        max_queue_length_m=raw["max_queue_m"],
        has_spillback=raw["has_spillback"],
        avg_speed_drop_pct=round(min(90.0, spillback_ratio * 55.0), 1),
        rank=rank,
        is_recommended=is_recommended,
    )


def _format_window_en(window: WindowOption) -> str:
    start_day = DAY_NAMES_EN[window.day_of_week or 0]
    end_day = DAY_NAMES_EN[window.end_day_of_week if window.end_day_of_week is not None else (window.day_of_week or 0)]
    return f"{start_day} {window.start_hour:02d}:00 - {end_day} {window.end_hour:02d}:00"


def _format_window_ar(window: WindowOption) -> str:
    start_day = DAY_NAMES_AR[window.day_of_week or 0]
    end_day = DAY_NAMES_AR[window.end_day_of_week if window.end_day_of_week is not None else (window.day_of_week or 0)]
    return f"{start_day} من {window.start_hour:02d}:00 إلى {end_day} {window.end_hour:02d}:00"


def optimize_workzone_schedule(
    request: WorkZoneRequest,
    hourly_demands: List[float],
    hourly_passengers: List[float],
    hourly_heavy_ratios: List[float],
    corridor_speed_limit: float = 80.0,
    upstream_exit_distance_m: float = 600.0,
    base_capacity_per_lane: float = 2000.0,
    weekly_demands: Optional[Sequence[Sequence[float]]] = None,
    weekly_passengers: Optional[Sequence[Sequence[float]]] = None,
    weekly_heavy_ratios: Optional[Sequence[Sequence[float]]] = None,
) -> WorkZoneResponse:
    """
    Master Work-Zone Advisor optimizer:
    1. Computes effective capacity drop based on closed lanes and heavy traffic.
    2. Evaluates all 24 start hours for the selected day.
    3. Evaluates all 168 weekly start hours when a 7-day profile is supplied.
    4. Identifies Top 3 optimal windows vs. the worst window for both scopes.
    5. Generates the standard 24h baseline curve and bilingual field SOP.
    """
    n_closed = len(request.closed_lanes)
    open_lanes = max(1, 4 - n_closed)
    avg_heavy_ratio = sum(hourly_heavy_ratios) / max(1, len(hourly_heavy_ratios))

    # Calculate effective capacity for the selected analysis day
    c_wz, f_merge, f_lane, f_hv = compute_workzone_capacity(
        base_capacity_per_lane=base_capacity_per_lane,
        total_lanes=4,
        closed_lanes=request.closed_lanes,
        heavy_vehicle_proportion=avg_heavy_ratio,
    )
    base_corridor_capacity = base_capacity_per_lane * 4
    capacity_drop_pct = round(((base_corridor_capacity - c_wz) / base_corridor_capacity) * 100.0, 1)

    # 1. Evaluate the 24-hour hourly curve assuming the work zone is active
    hourly_curves: List[HourlyWorkZoneDetail] = []
    current_queue = 0.0

    for h in range(24):
        state = _simulate_hourly_step(
            demand=hourly_demands[h],
            passengers=hourly_passengers[h],
            capacity=c_wz,
            queue_veh=current_queue,
            open_lanes=open_lanes,
            upstream_exit_distance_m=upstream_exit_distance_m,
        )
        current_queue = state["queue_veh"]
        hourly_curves.append(
            HourlyWorkZoneDetail(
                hour=h,
                demand_pce=round(hourly_demands[h], 1),
                effective_capacity=round(c_wz, 1),
                queue_veh=round(state["queue_veh"], 1),
                queue_length_m=round(state["queue_length_m"], 1),
                spillback_risk=state["spillback"],
                delay_sec_per_veh=round(state["delay_sec"], 1),
                person_hours_delay=round(state["phd"], 2),
                level_of_service=state["los"],
            )
        )

    # 2. Evaluate all 24 start hours on the selected day
    daily_evaluations = []
    for h_start in range(24):
        raw = evaluate_maintenance_window(
            start_hour=h_start,
            duration_hours=request.duration_hours,
            hourly_demands=hourly_demands,
            hourly_passengers=hourly_passengers,
            workzone_capacity=c_wz,
            open_lanes=open_lanes,
            upstream_exit_distance_m=upstream_exit_distance_m,
            day_of_week=request.day_of_week,
        )
        score = raw["total_phd"] + (5000.0 if raw["has_spillback"] else 0.0)
        daily_evaluations.append((score, raw))
    daily_evaluations.sort(key=lambda x: x[0])

    optimal_windows = [
        _to_window_option(raw, rank=rank, is_recommended=(rank == 1), upstream_exit_distance_m=upstream_exit_distance_m)
        for rank, (_score, raw) in enumerate(daily_evaluations[:3], start=1)
    ]
    worst_window = _to_window_option(
        daily_evaluations[-1][1], rank=24, is_recommended=False,
        upstream_exit_distance_m=upstream_exit_distance_m,
    )

    # 3. Evaluate all 168 weekly start hours when a full weekly profile is available
    weekly_optimal_windows: List[WindowOption] = []
    weekly_worst_window: Optional[WindowOption] = None
    if weekly_demands and weekly_passengers and weekly_heavy_ratios:
        capacity_by_day: List[float] = []
        for day in range(7):
            day_hv = sum(weekly_heavy_ratios[day]) / 24.0
            day_capacity, _, _, _ = compute_workzone_capacity(
                base_capacity_per_lane=base_capacity_per_lane,
                total_lanes=4,
                closed_lanes=request.closed_lanes,
                heavy_vehicle_proportion=day_hv,
            )
            capacity_by_day.append(day_capacity)

        weekly_evaluations = []
        for day in range(7):
            for h_start in range(24):
                raw = evaluate_weekly_maintenance_window(
                    start_day=day,
                    start_hour=h_start,
                    duration_hours=request.duration_hours,
                    weekly_demands=weekly_demands,
                    weekly_passengers=weekly_passengers,
                    capacity_by_day=capacity_by_day,
                    open_lanes=open_lanes,
                    upstream_exit_distance_m=upstream_exit_distance_m,
                )
                score = raw["total_phd"] + (5000.0 if raw["has_spillback"] else 0.0)
                weekly_evaluations.append((score, raw))
        weekly_evaluations.sort(key=lambda x: x[0])

        weekly_optimal_windows = [
            _to_window_option(raw, rank=rank, is_recommended=(rank == 1), upstream_exit_distance_m=upstream_exit_distance_m)
            for rank, (_score, raw) in enumerate(weekly_evaluations[:3], start=1)
        ]
        weekly_worst_window = _to_window_option(
            weekly_evaluations[-1][1], rank=168, is_recommended=False,
            upstream_exit_distance_m=upstream_exit_distance_m,
        )

    # 4. Optional requested-window evaluation (target_start_hour)
    requested_window: Optional[WindowOption] = None
    if request.target_start_hour is not None:
        raw_requested = evaluate_maintenance_window(
            start_hour=request.target_start_hour,
            duration_hours=request.duration_hours,
            hourly_demands=hourly_demands,
            hourly_passengers=hourly_passengers,
            workzone_capacity=c_wz,
            open_lanes=open_lanes,
            upstream_exit_distance_m=upstream_exit_distance_m,
            day_of_week=request.day_of_week,
        )
        requested_window = _to_window_option(
            raw_requested, rank=0, is_recommended=False,
            upstream_exit_distance_m=upstream_exit_distance_m,
        )

    # 5. Geometry & field SOP - the weekly winner is the authoritative schedule
    l_taper, l_buffer = compute_taper_and_buffer(
        speed_limit_kmh=corridor_speed_limit,
        closed_lanes_count=n_closed,
    )
    workzone_speed_limit = max(40.0, corridor_speed_limit - 20.0)
    best_win = weekly_optimal_windows[0] if weekly_optimal_windows else optimal_windows[0]
    sop_day = best_win.day_of_week if best_win.day_of_week is not None else request.day_of_week

    has_heavy_lane = (1 in request.closed_lanes or 2 in request.closed_lanes)
    divert_heavy = bool(has_heavy_lane)

    window_en = _format_window_en(best_win)
    window_ar = _format_window_ar(best_win)

    tactical_en = [
        f"Stage work zone equipment on {window_en} (duration: {request.duration_hours}h).",
        f"Deploy sequential flashing arrow board and {l_taper}m merge taper upstream of the lane closure.",
        f"Enforce mandatory deceleration buffer of {l_buffer}m and reduced speed limit of {workzone_speed_limit:.0f} km/h.",
        "Position rapid-response heavy recovery tow truck 150m upstream of the merge taper.",
    ]
    tactical_ar = [
        f"بدء أعمال الصيانة وتركيب التجهيزات في {window_ar} (المدة: {request.duration_hours} ساعات).",
        f"تثبيت لوحة الأسهم المضيئة ومخاريط التحويل بطول مسافة التدرج (Taper) البالغة {l_taper} متر قبل منطقة الأعمال.",
        f"تطبيق منطقة أمان عازلة بطول {l_buffer} متر وخفض السرعة القانونية إلى {workzone_speed_limit:.0f} كم/س.",
        "تمركز ونش إنقاذ ورافعة ثقيلة على بعد 150 متر قبل بداية التدرج للتدخل الفوري.",
    ]
    if divert_heavy:
        tactical_en.append(
            "MANDATORY: Divert heavy trucks and microbuses to the alternative service road at the upstream exit to prevent weaving gridlock."
        )
        tactical_ar.append(
            "إجراء إلزامي: تحويل مسار سيارات النقل الثقيل والميكروباص إلى المحور البديل عند المخرج السابق لمنع احتكاك المسارات."
        )

    sop = WorkZoneSOP(
        directive_id=f"SOP-WZ-{request.corridor_id.upper()}-D{sop_day}-{best_win.start_hour:02d}{best_win.end_hour:02d}",
        optimal_window_en=f"{window_en} (Duration: {request.duration_hours}h)",
        optimal_window_ar=f"{window_ar} (المدة: {request.duration_hours} ساعات)",
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
        optimal_windows=optimal_windows,
        worst_window=worst_window,
        weekly_optimal_windows=weekly_optimal_windows,
        weekly_worst_window=weekly_worst_window,
        requested_window=requested_window,
        sop=sop,
    )

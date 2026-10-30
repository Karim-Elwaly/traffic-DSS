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

# Queue storage constants. 6.5 m is the stopped bumper-to-bumper spacing used
# by the microscopic canvases and by Egyptian work-zone practice.
JAM_SPACING_M = 6.5
DEFAULT_HEAVY_RATIO = 0.12
MAX_HOURLY_DELAY_SEC = 600.0


def fleet_average_pce(heavy_ratio: float) -> float:
    """
    Fleet-average PCE for the same Egyptian mix used by the microscopic
    canvases: 25% microbuses, the remaining share split 40/60 between
    buses (PCE 2.0) and trucks (PCE 2.5), with cars at PCE 1.0.

    avg = (0.75 - hv) * 1.0 + 0.25 * 1.5 + hv * (0.4*2.0 + 0.6*2.5)
        = 1.125 + 1.3 * hv
    """
    hv = max(0.0, min(0.4, heavy_ratio))
    return 1.125 + 1.3 * hv


def _simulate_hourly_step(
    demand: float,
    passengers: float,
    capacity: float,
    queue_veh: float,
    open_lanes: int,
    upstream_exit_distance_m: float,
    heavy_ratio: float = DEFAULT_HEAVY_RATIO,
    posted_speed_kmh: float = 80.0,
    workzone_speed_kmh: float = 60.0,
    workzone_length_m: float = 400.0,
) -> Dict[str, Any]:
    """
    Advances a deterministic fluid queue by one hour.

    The old recursion let ``queue += demand - capacity`` grow without bound for
    every oversaturated hour, producing queues of hundreds of kilometres and
    millions of person-hours. A real queue is bounded by the upstream storage
    between the work zone and the previous exit. Once that storage is full the
    excess demand is metered/diverted at the upstream exit; it cannot join the
    queue. This function models that storage explicitly and derives delay from
    Little's law (vehicle-hours in queue / vehicles served) rather than from an
    arbitrary multiplier on the queue length.
    """
    hv = max(0.0, min(0.4, heavy_ratio))
    avg_pce = fleet_average_pce(hv)
    demand_veh = max(0.0, demand) / avg_pce
    capacity_veh = max(1.0, capacity) / avg_pce

    # Physical storage between the work-zone taper and the previous exit.
    storage_veh = max(1.0, upstream_exit_distance_m * open_lanes / JAM_SPACING_M)
    q0 = max(0.0, min(queue_veh, storage_veh))

    if demand_veh <= capacity_veh:
        drain_rate = capacity_veh - demand_veh
        if q0 <= 0.0:
            queue_veh_hours = 0.0
            q_end = 0.0
        elif drain_rate <= 1e-9:
            # Exactly saturated: the queue neither grows nor clears.
            queue_veh_hours = q0
            q_end = q0
        else:
            drain_time_h = min(1.0, q0 / drain_rate)
            queue_veh_hours = 0.5 * q0 * drain_time_h
            q_end = max(0.0, q0 - drain_rate * 1.0)
        joining_veh = demand_veh
    else:
        growth_rate = demand_veh - capacity_veh
        if q0 >= storage_veh:
            # Upstream storage is already full: only the bottleneck capacity
            # can enter this hour, the rest is held/diverted upstream.
            fill_time_h = 0.0
            queue_veh_hours = storage_veh
            q_end = storage_veh
            joining_veh = capacity_veh
        else:
            fill_time_h = min(1.0, (storage_veh - q0) / growth_rate)
            queue_veh_hours = (
                q0 * fill_time_h
                + 0.5 * growth_rate * fill_time_h ** 2
                + storage_veh * (1.0 - fill_time_h)
            )
            q_end = min(storage_veh, q0 + growth_rate * fill_time_h)
            joining_veh = demand_veh * fill_time_h + capacity_veh * (1.0 - fill_time_h)

    # Work-zone geometric delay (speed reduction) plus one merge friction loss.
    length_km = max(0.0, workzone_length_m) / 1000.0
    free_flow_time = length_km / max(1.0, posted_speed_kmh) * 3600.0
    wz_time = length_km / max(1.0, workzone_speed_kmh) * 3600.0
    merge_delay = 3.0 if open_lanes < 4 else 0.0
    base_delay_sec = max(0.0, wz_time - free_flow_time) + merge_delay

    queue_delay_sec = (
        queue_veh_hours / joining_veh * 3600.0 if joining_veh > 1e-6 else 0.0
    )
    delay_sec = min(MAX_HOURLY_DELAY_SEC, queue_delay_sec + base_delay_sec)

    queue_length_m = min(
        upstream_exit_distance_m,
        q_end * JAM_SPACING_M / max(1, open_lanes),
    )
    spillback = (
        q_end >= storage_veh * 0.95
        or queue_length_m >= upstream_exit_distance_m * 0.95
    )

    # Speed drop relative to a free-flow trip over the same work-zone length.
    if joining_veh > 1e-6 and free_flow_time > 0.0:
        travel_time = free_flow_time + delay_sec
        speed_drop_pct = 100.0 * (1.0 - free_flow_time / max(1.0, travel_time))
    else:
        speed_drop_pct = 0.0
    speed_drop_pct = max(0.0, min(90.0, speed_drop_pct))

    pax_per_veh = passengers / demand_veh if demand_veh > 1e-6 else 0.0
    person_hours = (
        queue_veh_hours + base_delay_sec * joining_veh / 3600.0
    ) * pax_per_veh

    vc_ratio = demand_veh / capacity_veh

    return {
        "queue_veh": q_end,
        "queue_length_m": queue_length_m,
        "spillback": spillback,
        "vc_ratio": vc_ratio,
        "delay_sec": delay_sec,
        "phd": person_hours,
        "los": calculate_los(delay_sec, vc_ratio),
        "demand_veh": demand_veh,
        "capacity_veh": capacity_veh,
        "avg_pce": avg_pce,
        "speed_drop_pct": speed_drop_pct,
        "heavy_ratio": hv,
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
    hourly_heavy_ratios: Optional[Sequence[float]] = None,
    posted_speed_kmh: float = 80.0,
    workzone_speed_kmh: float = 60.0,
    workzone_length_m: float = 400.0,
) -> Dict[str, Any]:
    """
    Simulates queue accumulation and person-hours of delay across a contiguous
    D-hour window on a selected day (wrapping across midnight when required).
    """
    queue_veh = 0.0
    total_phd = 0.0
    max_queue_len = 0.0
    has_spillback = False
    weighted_speed_drop = 0.0
    speed_weight = 0.0
    demand_sum = 0.0
    capacity_sum = 0.0
    heavy_sum = 0.0

    for step in range(duration_hours):
        h = (start_hour + step) % 24
        hv = (
            hourly_heavy_ratios[h]
            if hourly_heavy_ratios is not None and h < len(hourly_heavy_ratios)
            else DEFAULT_HEAVY_RATIO
        )
        state = _simulate_hourly_step(
            demand=hourly_demands[h],
            passengers=hourly_passengers[h],
            capacity=workzone_capacity,
            queue_veh=queue_veh,
            open_lanes=open_lanes,
            upstream_exit_distance_m=upstream_exit_distance_m,
            heavy_ratio=hv,
            posted_speed_kmh=posted_speed_kmh,
            workzone_speed_kmh=workzone_speed_kmh,
            workzone_length_m=workzone_length_m,
        )
        queue_veh = state["queue_veh"]
        total_phd += state["phd"]
        max_queue_len = max(max_queue_len, state["queue_length_m"])
        has_spillback = has_spillback or state["spillback"]
        demand_sum += hourly_demands[h]
        capacity_sum += workzone_capacity
        heavy_sum += hv
        weight = max(1.0, state["demand_veh"])
        weighted_speed_drop += state["speed_drop_pct"] * weight
        speed_weight += weight

    absolute_end = start_hour + duration_hours
    return {
        "start_hour": start_hour,
        "end_hour": absolute_end % 24,
        "day_of_week": day_of_week,
        "end_day_of_week": (day_of_week + absolute_end // 24) % 7,
        "total_phd": round(total_phd, 2),
        "max_queue_m": round(max_queue_len, 1),
        "has_spillback": has_spillback,
        "avg_speed_drop_pct": round(
            weighted_speed_drop / max(1.0, speed_weight), 1
        ),
        "avg_demand_pce": demand_sum / max(1, duration_hours),
        "avg_capacity_pce": capacity_sum / max(1, duration_hours),
        "avg_heavy_pct": heavy_sum / max(1, duration_hours) * 100.0,
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
    weekly_heavy_ratios: Optional[Sequence[Sequence[float]]] = None,
    posted_speed_kmh: float = 80.0,
    workzone_speed_kmh: float = 60.0,
    workzone_length_m: float = 400.0,
) -> Dict[str, Any]:
    """
    Evaluates a contiguous D-hour window anywhere in the 7-day x 24-hour week.
    Window hours and capacities roll across midnight and day boundaries correctly.
    """
    queue_veh = 0.0
    total_phd = 0.0
    max_queue_len = 0.0
    has_spillback = False
    weighted_speed_drop = 0.0
    speed_weight = 0.0
    demand_sum = 0.0
    capacity_sum = 0.0
    heavy_sum = 0.0

    for step in range(duration_hours):
        absolute = start_hour + step
        day = (start_day + absolute // 24) % 7
        hour = absolute % 24
        hv = (
            weekly_heavy_ratios[day][hour]
            if weekly_heavy_ratios is not None
            and day < len(weekly_heavy_ratios)
            and hour < len(weekly_heavy_ratios[day])
            else DEFAULT_HEAVY_RATIO
        )
        capacity = capacity_by_day[day]
        state = _simulate_hourly_step(
            demand=weekly_demands[day][hour],
            passengers=weekly_passengers[day][hour],
            capacity=capacity,
            queue_veh=queue_veh,
            open_lanes=open_lanes,
            upstream_exit_distance_m=upstream_exit_distance_m,
            heavy_ratio=hv,
            posted_speed_kmh=posted_speed_kmh,
            workzone_speed_kmh=workzone_speed_kmh,
            workzone_length_m=workzone_length_m,
        )
        queue_veh = state["queue_veh"]
        total_phd += state["phd"]
        max_queue_len = max(max_queue_len, state["queue_length_m"])
        has_spillback = has_spillback or state["spillback"]
        demand_sum += weekly_demands[day][hour]
        capacity_sum += capacity
        heavy_sum += hv
        weight = max(1.0, state["demand_veh"])
        weighted_speed_drop += state["speed_drop_pct"] * weight
        speed_weight += weight

    absolute_end = start_hour + duration_hours
    return {
        "start_hour": start_hour,
        "end_hour": absolute_end % 24,
        "day_of_week": start_day,
        "end_day_of_week": (start_day + absolute_end // 24) % 7,
        "total_phd": round(total_phd, 2),
        "max_queue_m": round(max_queue_len, 1),
        "has_spillback": has_spillback,
        "avg_speed_drop_pct": round(
            weighted_speed_drop / max(1.0, speed_weight), 1
        ),
        "avg_demand_pce": demand_sum / max(1, duration_hours),
        "avg_capacity_pce": capacity_sum / max(1, duration_hours),
        "avg_heavy_pct": heavy_sum / max(1, duration_hours) * 100.0,
    }


def _to_window_option(
    raw: Dict[str, Any],
    rank: int,
    is_recommended: bool,
    upstream_exit_distance_m: float,
) -> WindowOption:
    """Converts a raw window simulation into the API contract."""
    return WindowOption(
        start_hour=raw["start_hour"],
        end_hour=raw["end_hour"],
        day_of_week=raw.get("day_of_week"),
        end_day_of_week=raw.get("end_day_of_week"),
        total_person_hours_delay=raw["total_phd"],
        max_queue_length_m=raw["max_queue_m"],
        has_spillback=raw["has_spillback"],
        avg_speed_drop_pct=round(raw.get("avg_speed_drop_pct", 0.0), 1),
        avg_demand_pce=round(raw.get("avg_demand_pce", 0.0), 1),
        avg_capacity_pce=round(raw.get("avg_capacity_pce", 0.0), 1),
        heavy_vehicle_percentage=round(raw.get("avg_heavy_pct", 12.0), 1),
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

    # Calculate effective capacity for the selected analysis day. Heavy
    # vehicles are already present in the PCE demand, so f_hv is not applied
    # a second time.
    c_wz, f_merge, f_lane, f_hv = compute_workzone_capacity(
        base_capacity_per_lane=base_capacity_per_lane,
        total_lanes=4,
        closed_lanes=request.closed_lanes,
        heavy_vehicle_proportion=avg_heavy_ratio,
    )
    base_corridor_capacity = base_capacity_per_lane * 4
    capacity_drop_pct = round(
        ((base_corridor_capacity - c_wz) / max(1.0, base_corridor_capacity)) * 100.0,
        1,
    )

    # Work-zone geometry and speed regime. The zone includes the merge taper,
    # the longitudinal buffer and a 150 m work area.
    l_taper, l_buffer = compute_taper_and_buffer(
        speed_limit_kmh=corridor_speed_limit,
        closed_lanes_count=n_closed,
    )
    workzone_speed_limit = max(40.0, corridor_speed_limit - 20.0)
    workzone_length_m = max(300.0, l_taper + l_buffer + 150.0)

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
            heavy_ratio=hourly_heavy_ratios[h],
            posted_speed_kmh=corridor_speed_limit,
            workzone_speed_kmh=workzone_speed_limit,
            workzone_length_m=workzone_length_m,
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
            hourly_heavy_ratios=hourly_heavy_ratios,
            posted_speed_kmh=corridor_speed_limit,
            workzone_speed_kmh=workzone_speed_limit,
            workzone_length_m=workzone_length_m,
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
                    weekly_heavy_ratios=weekly_heavy_ratios,
                    posted_speed_kmh=corridor_speed_limit,
                    workzone_speed_kmh=workzone_speed_limit,
                    workzone_length_m=workzone_length_m,
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
            hourly_heavy_ratios=hourly_heavy_ratios,
            posted_speed_kmh=corridor_speed_limit,
            workzone_speed_kmh=workzone_speed_limit,
            workzone_length_m=workzone_length_m,
        )
        requested_window = _to_window_option(
            raw_requested, rank=0, is_recommended=False,
            upstream_exit_distance_m=upstream_exit_distance_m,
        )

    # 5. Geometry & field SOP - the weekly winner is the authoritative schedule
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
        heavy_vehicle_percentage=round(avg_heavy_ratio * 100.0, 1),
        hourly_curves=hourly_curves,
        optimal_windows=optimal_windows,
        worst_window=worst_window,
        weekly_optimal_windows=weekly_optimal_windows,
        weekly_worst_window=weekly_worst_window,
        requested_window=requested_window,
        sop=sop,
    )

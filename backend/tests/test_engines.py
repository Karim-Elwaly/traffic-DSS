"""
Unit tests for IT-DSS mathematical engines and physics formulas.
Verifies Highway Capacity Manual (HCM), Webster's delay, LWR shockwave,
and Reversible lane calculations.
"""

import sys
from pathlib import Path

_ROOT_DIR = Path(__file__).resolve().parent.parent.parent
if str(_ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(_ROOT_DIR))

import pytest
from backend.app.core.hcm_math import (
    compute_pce_flow,
    compute_passenger_flow,
    calculate_los,
    compute_heavy_vehicle_factor,
    compute_workzone_capacity,
    compute_taper_and_buffer,
)
from backend.app.core.workzone_engine import (
    evaluate_maintenance_window,
    optimize_workzone_schedule,
)
from backend.app.core.intersection_engine import (
    simulate_intersections,
)
from backend.app.core.shockwave_engine import (
    predict_incident_shockwave,
)
from backend.app.core.reversible_engine import (
    evaluate_reversible_corridor,
)
from backend.app.models.schemas import (
    WorkZoneRequest,
    IntersectionRequest,
    ShockwaveRequest,
    ReversibleRequest,
)


def test_hcm_pce_and_passenger_math():
    # 100 cars, 20 microbuses, 5 buses, 10 trucks, 15 motorcycles
    # PCE: 100*1.0 + 20*1.5 + 5*2.0 + 10*2.5 + 15*0.4 = 100 + 30 + 10 + 25 + 6 = 171.0
    pce = compute_pce_flow(cars=100, microbus=20, buses=5, trucks=10, motorcycles=15)
    assert pce == 171.0

    # Human pax: 100*1.4 + 20*14.0 + 5*45.0 + 10*1.2 + 15*1.2
    # = 140 + 280 + 225 + 12 + 18 = 675.0
    pax = compute_passenger_flow(cars=100, microbus=20, buses=5, trucks=10, motorcycles=15)
    assert pax == 675.0


def test_los_grading():
    assert calculate_los(8.0, 0.45) == "A"
    assert calculate_los(15.0, 0.65) == "B"
    assert calculate_los(28.0, 0.75) == "C"
    assert calculate_los(45.0, 0.85) == "D"
    assert calculate_los(70.0, 0.95) == "E"
    assert calculate_los(95.0, 0.80) == "F"
    assert calculate_los(25.0, 1.05) == "F"


def test_workzone_capacity_and_penalty():
    # Base = 2000 per lane, 4 lanes, close lane 1 (rightmost heavy)
    c_wz, f_merge, f_lane, f_hv = compute_workzone_capacity(
        base_capacity_per_lane=2000.0,
        total_lanes=4,
        closed_lanes=[1],
        heavy_vehicle_proportion=0.15,
    )
    # n_closed = 1 -> open = 3
    # f_merge = 1 - 0.12*1 = 0.88
    # closing lane 1 -> f_lane = 0.88
    # f_hv = 1 / (1 + 0.15 * 1.5) = 1 / 1.225 = 0.8163
    # c_wz = 2000 * 3 * 0.88 * 0.88 * f_hv
    assert f_merge == 0.88
    assert f_lane == 0.88
    assert c_wz > 3500.0 and c_wz < 4000.0


def test_workzone_optimizer_and_sop():
    req = WorkZoneRequest(
        corridor_id="corridor_26july",
        closed_lanes=[1],
        duration_hours=4,
        day_of_week=0,
    )
    hourly_demands = [3000.0] * 24
    hourly_passengers = [8000.0] * 24
    hourly_heavy = [0.12] * 24

    resp = optimize_workzone_schedule(
        request=req,
        hourly_demands=hourly_demands,
        hourly_passengers=hourly_passengers,
        hourly_heavy_ratios=hourly_heavy,
        corridor_speed_limit=80.0,
        upstream_exit_distance_m=600.0,
    )

    assert resp.n_closed == 1
    assert len(resp.hourly_curves) == 24
    assert len(resp.optimal_windows) == 3
    assert resp.worst_window is not None
    assert resp.sop.taper_length_m > 0.0
    assert resp.sop.buffer_space_m > 0.0
    assert resp.sop.tow_truck_staging_m == 150.0


def test_intersection_engine():
    req = IntersectionRequest(
        main_flow=3500.0,
        cross_flow=800.0,
        turning_pct=15.0,
        heavy_pct=10.0,
        uturn_distance_m=400.0,
    )
    resp = simulate_intersections(req)

    assert len(resp.alternatives) == 4
    open_alt = next(a for a in resp.alternatives if a.id == "OPEN")
    sig_alt = next(a for a in resp.alternatives if a.id == "SIGNAL")
    uturn_alt = next(a for a in resp.alternatives if a.id == "UTURN")
    round_alt = next(a for a in resp.alternatives if a.id == "ROUNDABOUT")

    assert open_alt.conflict_points == 32
    assert sig_alt.conflict_points == 8
    assert uturn_alt.conflict_points == 4
    assert round_alt.conflict_points == 8

    # High main flow should favor U-Turn or Signal
    assert resp.recommended_option_id in ["UTURN", "SIGNAL"]
    assert resp.recommendation_rationale_en is not None
    assert resp.recommendation_rationale_ar is not None


def test_shockwave_engine():
    req = ShockwaveRequest(
        corridor_id="corridor_26july",
        hour=8,
        blocked_lanes=2,
        incident_type="COLLISION",
        weaving_index=0.5,
    )
    resp = predict_incident_shockwave(
        request=req,
        arrival_flow_pce=6200.0,
        arrival_speed_kmh=65.0,
        upstream_exit_distance_m=600.0,
    )

    assert resp.backward_shockwave_speed_kmh > 0.0
    assert resp.time_to_block_minutes > 0.0
    assert len(resp.queue_progression) == 13  # 0 to 60 mins in 5-min increments
    assert resp.sop.micro_friction_remedy_en is not None


def test_reversible_engine():
    # 70% directional split: 7000 inbound, 3000 outbound
    req = ReversibleRequest(
        corridor_id="corridor_26july",
        inbound_flow=7000.0,
        outbound_flow=3000.0,
        corridor_length_km=8.5,
        emergency_mode=False,
    )
    resp = evaluate_reversible_corridor(req)

    assert resp.directional_split_pct == 70.0
    assert resp.recommended_mode == "REVERSIBLE_5_3"
    assert resp.travel_time_saved_pct >= 0.0
    assert len(resp.green_wave_schedule) == 5
    assert resp.pre_arrival_flush_time_sec > 18.0


def test_reversible_activation_requires_strict_68_and_outbound_headroom():
    # Exactly 68.0% split must NOT activate the reversible lane.
    exact = evaluate_reversible_corridor(
        ReversibleRequest(
            corridor_id="corridor_26july",
            inbound_flow=6800.0,
            outbound_flow=3200.0,
            corridor_length_km=8.5,
            emergency_mode=False,
        )
    )
    assert exact.directional_split_pct == 68.0
    assert exact.recommended_mode == "STANDARD_4_4"

    # 69% split but outbound standard v/c >= 0.45 must also stay standard.
    constrained = evaluate_reversible_corridor(
        ReversibleRequest(
            corridor_id="corridor_26july",
            inbound_flow=7100.0,
            outbound_flow=3300.0,
            corridor_length_km=8.5,
            emergency_mode=False,
        )
    )
    assert constrained.directional_split_pct > 68.0
    assert constrained.standard_4_4.outbound_vc_ratio >= 0.45
    assert constrained.recommended_mode == "STANDARD_4_4"

    # Emergency mode bypasses the split/headroom gate.
    emergency = evaluate_reversible_corridor(
        ReversibleRequest(
            corridor_id="corridor_26july",
            inbound_flow=4000.0,
            outbound_flow=4000.0,
            corridor_length_km=8.5,
            emergency_mode=True,
        )
    )
    assert emergency.recommended_mode == "REVERSIBLE_5_3"


def test_green_wave_spacing_and_node_count():
    resp = evaluate_reversible_corridor(
        ReversibleRequest(
            corridor_id="corridor_26july",
            inbound_flow=7000.0,
            outbound_flow=2500.0,
            corridor_length_km=8.5,
            intersections_count=3,
        )
    )
    assert len(resp.green_wave_schedule) == 3
    distances = [node.distance_from_start_m for node in resp.green_wave_schedule]
    assert distances == [0.0, 450.0, 900.0]
    # 450m at 60 km/h (16.667 m/s) = 27.0s offset per link.
    assert resp.green_wave_schedule[1].offset_seconds == pytest.approx(27.0)
    assert resp.green_wave_schedule[2].offset_seconds == pytest.approx(54.0)


def test_weekly_workzone_optimizer_and_requested_window():
    req = WorkZoneRequest(
        corridor_id="corridor_26july",
        closed_lanes=[1],
        duration_hours=4,
        day_of_week=0,
    )
    hourly_demands = [5000.0] * 24
    hourly_passengers = [12000.0] * 24
    hourly_heavy = [0.12] * 24

    weekly_demands = [[5000.0] * 24 for _ in range(7)]
    weekly_passengers = [[12000.0] * 24 for _ in range(7)]
    weekly_heavy = [[0.12] * 24 for _ in range(7)]
    # Friday (day 5) pre-dawn is the quietest slice of the week.
    for hour in range(2, 6):
        weekly_demands[5][hour] = 500.0

    resp = optimize_workzone_schedule(
        request=req,
        hourly_demands=hourly_demands,
        hourly_passengers=hourly_passengers,
        hourly_heavy_ratios=hourly_heavy,
        corridor_speed_limit=80.0,
        upstream_exit_distance_m=600.0,
        weekly_demands=weekly_demands,
        weekly_passengers=weekly_passengers,
        weekly_heavy_ratios=weekly_heavy,
    )

    assert len(resp.weekly_optimal_windows) == 3
    assert resp.weekly_worst_window is not None
    assert resp.weekly_worst_window.rank == 168
    assert resp.weekly_optimal_windows[0].day_of_week == 5
    assert resp.weekly_optimal_windows[0].is_recommended is True
    assert all(win.day_of_week is not None for win in resp.weekly_optimal_windows)
    # SOP must reference the weekly winner, not the arbitrary daily request day.
    assert "Friday" in resp.sop.optimal_window_en
    assert "الجمعة" in resp.sop.optimal_window_ar

    requested = optimize_workzone_schedule(
        request=WorkZoneRequest(
            corridor_id="corridor_26july",
            closed_lanes=[1],
            duration_hours=4,
            day_of_week=2,
            target_start_hour=7,
        ),
        hourly_demands=hourly_demands,
        hourly_passengers=hourly_passengers,
        hourly_heavy_ratios=hourly_heavy,
        corridor_speed_limit=80.0,
        upstream_exit_distance_m=600.0,
        weekly_demands=weekly_demands,
        weekly_passengers=weekly_passengers,
        weekly_heavy_ratios=weekly_heavy,
    )
    assert requested.requested_window is not None
    assert requested.requested_window.start_hour == 7
    assert requested.requested_window.day_of_week == 2
    assert requested.requested_window.rank == 0


def test_los_exact_thresholds():
    assert calculate_los(10.0, 0.5) == "A"
    assert calculate_los(10.1, 0.5) == "B"
    assert calculate_los(20.0, 0.5) == "B"
    assert calculate_los(20.1, 0.5) == "C"
    assert calculate_los(35.0, 0.5) == "C"
    assert calculate_los(35.1, 0.5) == "D"
    assert calculate_los(55.0, 0.5) == "D"
    assert calculate_los(55.1, 0.5) == "E"
    assert calculate_los(80.0, 0.5) == "E"
    assert calculate_los(80.1, 0.5) == "F"
    assert calculate_los(5.0, 1.001) == "F"

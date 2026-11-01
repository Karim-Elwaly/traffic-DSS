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
from backend.app.core.weather_engine import (
    evaluate_weather_protocol,
)
from backend.app.core.checkpoint_engine import (
    evaluate_checkpoint_optimizer,
)
from backend.app.core.diversion_engine import (
    evaluate_diversion_balancer,
)
from backend.app.core.ramp_engine import (
    evaluate_ramp_metering,
)
from backend.app.core.defect_roi_engine import (
    evaluate_defect_prioritization,
)
from backend.app.core.surge_engine import (
    evaluate_surge_orchestration,
)
from backend.app.models.schemas import (
    WorkZoneRequest,
    IntersectionRequest,
    ShockwaveRequest,
    ReversibleRequest,
    WeatherRequest,
    CheckpointRequest,
    DiversionRequest,
    RampMeteringRequest,
    DefectRoiRequest,
    SurgeOrchestratorRequest,
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
    # f_merge = 1 - 0.06*1 = 0.94
    # closing lane 1 (rightmost) -> f_lane = 1.0
    # f_hv = 1 / (1 + 0.15 * 1.5) = 1 / 1.225 = 0.8163
    # Demand is already in PCE, so f_hv is reported but NOT applied twice:
    # c_wz = 2000 * 3 * 0.94 = 5,640 PCE/h (29.5% drop for one lane lost)
    assert f_merge == pytest.approx(0.94)
    assert f_lane == pytest.approx(1.0)
    assert f_hv == pytest.approx(1.0 / 1.225)
    assert c_wz == pytest.approx(5640.0)
    # A 3-lane work zone must retain far more than half the base capacity.
    assert c_wz > 2000.0 * 3 * 0.90


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

    # The winner is data-driven; every alternative must report finite,
    # physically bounded HCM values.
    valid_ids = {alt.id for alt in resp.alternatives}
    assert resp.recommended_option_id in valid_ids
    assert resp.recommendation_rationale_en is not None
    assert resp.recommendation_rationale_ar is not None
    for alt in resp.alternatives:
        assert 0.0 <= alt.average_delay_sec <= 300.0
        assert 0.0 <= alt.queue_95th_m <= 950.0
        assert 0.0 <= alt.volume_to_capacity < 100.0
        assert alt.level_of_service in {"A", "B", "C", "D", "E", "F"}
        assert alt.conflict_points >= 0


def test_intersection_engine_heavy_demand_prefers_grade_separated_or_signal():
    req = IntersectionRequest(
        main_flow=6000.0,
        cross_flow=1500.0,
        turning_pct=18.0,
        heavy_pct=12.0,
        uturn_distance_m=450.0,
    )
    resp = simulate_intersections(req)
    assert resp.recommended_option_id in {"UTURN", "SIGNAL"}
    for alt in resp.alternatives:
        assert alt.average_delay_sec <= 300.0
        assert alt.queue_95th_m <= 950.0
        assert alt.volume_to_capacity < 100.0


def test_uncontrolled_open_junction_cannot_win_at_gridlock():
    # 10,500 veh/h is well above the 8-lane gap-acceptance capacity. An open
    # junction must show a large HCM overflow delay and never be recommended.
    resp = simulate_intersections(
        IntersectionRequest(
            main_flow=7000.0,
            cross_flow=3500.0,
            turning_pct=18.0,
            heavy_pct=12.0,
            uturn_distance_m=450.0,
        )
    )
    open_alt = next(a for a in resp.alternatives if a.id == "OPEN")
    assert open_alt.average_delay_sec > 150.0
    assert resp.recommended_option_id != "OPEN"


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

    assert 0.0 < resp.backward_shockwave_speed_kmh <= 25.0
    assert resp.time_to_block_minutes > 0.0
    assert len(resp.queue_progression) == 13  # 0 to 60 mins in 5-min increments
    assert resp.sop.micro_friction_remedy_en is not None
    storage_veh = 600.0 / 6.5 * 4
    for step in resp.queue_progression:
        assert 0.0 <= step.queue_length_m <= 600.0
        assert 0 <= step.vehicles_in_queue <= storage_veh
        assert 10.0 <= step.upstream_speed_kmh <= resp.arrival_speed_kmh


def test_shockwave_no_queue_when_demand_below_bottleneck():
    resp = predict_incident_shockwave(
        request=ShockwaveRequest(
            corridor_id="corridor_26july",
            blocked_lanes=1,
            incident_type="STALL",
            weaving_index=0.1,
        ),
        arrival_flow_pce=1800.0,
        arrival_speed_kmh=70.0,
        upstream_exit_distance_m=600.0,
    )
    assert resp.backward_shockwave_speed_kmh == 0.0
    assert resp.time_to_block_minutes == 999.0
    assert resp.is_spillback_imminent is False
    assert all(step.queue_length_m == 0.0 for step in resp.queue_progression)


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


def test_reversible_high_inbound_surge_delay_and_travel_time_agree():
    # 9,000/500: standard 4+4 inbound is at v/c 1.25; 5+3 cuts it to 1.02.
    # The reallocation must be recommended and its delay saving must be
    # consistent with the travel-time saving instead of reporting 0 s/100%.
    resp = evaluate_reversible_corridor(
        ReversibleRequest(
            corridor_id="corridor_26july",
            inbound_flow=9000.0,
            outbound_flow=500.0,
            corridor_length_km=8.5,
            emergency_mode=False,
        )
    )
    assert resp.recommended_mode == "REVERSIBLE_5_3"
    assert (
        resp.reversible_5_3.inbound_delay_sec
        < resp.standard_4_4.inbound_delay_sec
    )
    assert resp.delay_reduction_pct > 0.0
    assert resp.travel_time_saved_pct > 0.0
    # Both metrics come from the same travel-time difference.
    expected = (
        resp.standard_4_4.inbound_delay_sec
        - resp.reversible_5_3.inbound_delay_sec
    ) / max(0.1, resp.standard_4_4.inbound_delay_sec) * 100.0
    assert resp.delay_reduction_pct == pytest.approx(expected, abs=0.2)


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
    # 8.5 km / 3 signals = 2,833.3 m average spacing (rounded to whole metres).
    assert distances == pytest.approx([0.0, 2833.0, 5667.0], abs=0.1)
    # 2,833 m at 60 km/h = 170.0 s, wrapped into the 90 s cycle.
    assert resp.green_wave_schedule[1].offset_seconds == pytest.approx(80.0, abs=0.1)
    assert resp.green_wave_schedule[2].offset_seconds == pytest.approx(70.0, abs=0.1)


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
    # Friday (day 5) pre-dawn is the quietest slice of the week. Passenger
    # demand must fall with vehicle demand (a 10x vehicle drop cannot leave
    # 30 passengers in every vehicle).
    for hour in range(2, 6):
        weekly_demands[5][hour] = 500.0
        weekly_passengers[5][hour] = 1200.0

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


def test_workzone_extreme_demand_stays_physically_bounded():
    req = WorkZoneRequest(
        corridor_id="corridor_26july",
        closed_lanes=[1, 2, 3],
        duration_hours=12,
        day_of_week=4,
    )
    # A deliberately absurd 20,000 PCE/h demand for 12 hours.
    resp = optimize_workzone_schedule(
        request=req,
        hourly_demands=[20000.0] * 24,
        hourly_passengers=[60000.0] * 24,
        hourly_heavy_ratios=[0.20] * 24,
        corridor_speed_limit=80.0,
        upstream_exit_distance_m=600.0,
    )

    assert resp.workzone_capacity > 0.0
    assert resp.heavy_vehicle_percentage == pytest.approx(20.0)
    for hour in resp.hourly_curves:
        assert hour.queue_length_m <= 600.0
        assert hour.queue_veh >= 0.0
        assert 0.0 <= hour.delay_sec_per_veh <= 600.0
        assert 0.0 <= hour.person_hours_delay < 1_000_000.0
        assert hour.level_of_service in {"A", "B", "C", "D", "E", "F"}
    for window in resp.optimal_windows + [resp.worst_window]:
        assert window.total_person_hours_delay < 1_000_000.0
        assert window.max_queue_length_m <= 600.0
        assert window.avg_demand_pce == pytest.approx(20000.0)
        assert window.avg_capacity_pce > 0.0
        assert window.heavy_vehicle_percentage == pytest.approx(20.0)


def test_reversible_extreme_flows_stay_bounded():
    resp = evaluate_reversible_corridor(
        ReversibleRequest(
            corridor_id="corridor_26july",
            inbound_flow=9000.0,
            outbound_flow=7000.0,
            corridor_length_km=8.5,
            emergency_mode=True,
            intersections_count=3,
        )
    )
    for config in (resp.standard_4_4, resp.reversible_5_3):
        assert 0.0 <= config.inbound_delay_sec <= 600.0
        assert 0.0 <= config.outbound_safety_margin_pct <= 100.0
        assert config.inbound_speed_kmh >= 12.0
        assert config.inbound_travel_time_min > 0.0
    assert 0.0 <= resp.travel_time_saved_pct <= 100.0
    assert 0.0 <= resp.delay_reduction_pct <= 100.0
    assert 0.0 <= resp.pre_arrival_flush_time_sec <= 240.0
    # Three outbound lanes cannot absorb 7,000 veh/h.
    assert resp.reversible_5_3.outbound_vc_ratio > 1.0
    assert resp.reversible_5_3.is_viable is False
    assert resp.recommended_mode == "STANDARD_4_4"


def test_seeder_lane_counts_sum_to_corridor_total():
    from sqlmodel import SQLModel, Session, create_engine, select
    from sqlmodel.pool import StaticPool
    from backend.app.core.demand_profile import band_for_hour
    from backend.app.models.domain import HourlyTelemetry, SeedState
    from backend.app.services.synthetic_seeder import (
        CORRIDOR_METADATA,
        SEED_STATE_KEY,
        SEED_VERSION,
        seed_corridors_and_telemetry,
    )

    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        seed_corridors_and_telemetry(session)
        assert session.get(SeedState, SEED_STATE_KEY).value == SEED_VERSION
        for meta in CORRIDOR_METADATA:
            records = session.exec(
                select(HourlyTelemetry).where(
                    HourlyTelemetry.corridor_id == meta["id"]
                )
            ).all()
            assert len(records) == 7 * 24 * 4
            by_hour: dict[tuple[int, int], list[HourlyTelemetry]] = {}
            for record in records:
                by_hour.setdefault(
                    (record.day_of_week, record.hour), []
                ).append(record)
            assert len(by_hour) == 7 * 24

            for (day, hour), lane_records in by_hour.items():
                assert len(lane_records) == 4
                total_vehicles = sum(
                    record.count_cars
                    + record.count_microbus
                    + record.count_buses
                    + record.count_trucks
                    + record.count_motorcycles
                    for record in lane_records
                )
                assert total_vehicles > 0
                realised_pce = sum(record.pce_flow for record in lane_records)
                low, high = band_for_hour(hour)
                assert low <= realised_pce <= high, (
                    f"{meta['id']} day {day} hour {hour}: "
                    f"{realised_pce} outside {low}-{high}"
                )

        # A second call must not duplicate or overwrite the calibrated baseline.
        seed_corridors_and_telemetry(session)
        assert len(session.exec(select(HourlyTelemetry)).all()) == 2016


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


def test_oversaturated_intersection_clamping():
    """Verify that severe oversaturation (v/c > 1.0) does NOT explode to 159,307s or 8,370m."""
    req = IntersectionRequest(
        main_flow=4500,
        cross_flow=2500,
        turning_pct=35,
        heavy_pct=25,
        uturn_distance_m=800,
        engine_mode="analytical",
    )
    res = simulate_intersections(req)
    for alt in res.alternatives:
        # HCM 15-minute incremental delay clamping ensures realistic upper bound <= 240s
        assert 5.0 <= alt.average_delay_sec <= 240.0
        # 95th percentile queue length bounded <= 950m
        assert 10.0 <= alt.queue_95th_m <= 950.0


def test_weather_protocol_engine():
    """Verify AASHTO Stopping Sight Distance vs Fog visibility, deficit, and police convoy pacing."""
    req = WeatherRequest(
        corridor_id="corridor_26july",
        visibility_m=50.0,
        current_speed_limit_kmh=90.0,
        road_condition="fog_slick",
        gradient_pct=0.0,
        traffic_flow_pce=3500.0,
    )
    res = evaluate_weather_protocol(req)
    # SSD at 90 km/h is around 110m, with 50m visibility there must be a deficit
    assert res.current_stopping_sight_distance_m > 100.0
    assert res.stopping_distance_deficit_m > 40.0
    assert res.safe_advisory_speed_kmh < 65.0
    # Safe SSD must be within visibility
    assert res.safe_stopping_sight_distance_m <= res.visibility_m + 2.0
    # Low visibility triggers police convoy pacing SOP
    assert res.pacing_convoy_required is True
    assert res.convoy_speed_kmh <= 40.0
    assert res.risk_level in ["HIGH", "CRITICAL"]


def test_checkpoint_optimizer_engine():
    """Verify M/M/c queuing, average delay, queue tail, and 180s green bypass trigger."""
    # Scenario 1: Moderate flow, adequate open booths
    req_mod = CheckpointRequest(
        checkpoint_id="toll_km26",
        inbound_flow_veh_per_hour=1800,
        total_booths=8,
        open_booths=6,
        booth_type="mixed",
        service_rate_per_booth_vph=350,
        heavy_vehicle_share_pct=15,
        target_max_wait_sec=60,
    )
    res_mod = evaluate_checkpoint_optimizer(req_mod)
    assert res_mod.traffic_intensity_rho < 1.0
    assert res_mod.green_bypass_triggered is False

    # Scenario 2: Oversaturated rush, wait > 180s triggers emergency green bypass
    req_rush = CheckpointRequest(
        checkpoint_id="toll_km26",
        inbound_flow_veh_per_hour=3800,
        total_booths=8,
        open_booths=3,
        booth_type="manual",
        service_rate_per_booth_vph=220,
        heavy_vehicle_share_pct=25,
        target_max_wait_sec=60,
    )
    res_rush = evaluate_checkpoint_optimizer(req_rush)
    assert res_rush.traffic_intensity_rho > 1.0
    assert res_rush.avg_wait_time_sec >= 180.0
    assert res_rush.green_bypass_triggered is True
    assert res_rush.bypass_lanes_to_open >= 2


def test_diversion_balancer_engine():
    """Verify BPR link travel times, Wardrop equilibrium, and VMS optimal diversion split."""
    req = DiversionRequest(
        total_corridor_demand_vph=7500,
        primary_corridor_name="26th July Corridor",
        primary_free_flow_time_min=16.0,
        primary_capacity_vph=4500,
        alternate_corridor_name="Rod El-Farag Axis",
        alternate_free_flow_time_min=19.0,
        alternate_capacity_vph=6500,
        incident_delay_factor=1.8,
    )
    res = evaluate_diversion_balancer(req)
    # Status quo without diversion experiences large primary bottleneck delay
    assert res.do_nothing_primary_time_min > res.do_nothing_alternate_time_min
    # Wardrop equilibrium balances travel times
    assert res.recommended_diversion_pct > 25.0
    assert res.time_saved_per_vehicle_min > 2.0
    assert res.system_hours_saved_daily > 50.0
    assert res.vms_switch_active is True
    assert len(res.diversion_curve) == 36


def test_ramp_metering_engine():
    """Verify ALINEA feedback metering rate, cycle time, merge turbulence, and channelized barrier recovery."""
    req = RampMeteringRequest(
        corridor_id="corridor_26july",
        mainline_flow_pce=6200.0,
        ramp_demand_pce=1200.0,
        heavy_pct=18.0,
        control_mode="ALINEA_METERED",
    )
    res = evaluate_ramp_metering(req)
    assert res.mainline_flow_pce == 6200.0
    assert 300.0 <= res.metering_rate_pce_h <= 1800.0
    assert 2.0 <= res.signal_cycle_sec <= 12.0
    assert len(res.modes) == 3

    # Uncontrolled mode should have significant capacity loss
    uncontrolled = next(m for m in res.modes if m.mode_id == "UNCONTROLLED")
    assert uncontrolled.capacity_loss_pct > 15.0

    # ALINEA mode should yield positive throughput gain
    metered = next(m for m in res.modes if m.mode_id == "ALINEA_METERED")
    assert metered.throughput_gain_pct > 15.0
    assert metered.mainline_speed_kmh >= 65.0


def test_defect_roi_prioritizer_engine():
    """Verify spot-crawl capacity drop, 24-hour PHD integration, and 5-defect ROI ranking."""
    req = DefectRoiRequest(
        corridor_id="corridor_26july",
        defect_type="DAMAGED_EXPANSION_JOINT",
        crawl_speed_kmh=12.0,
        affected_lanes=2,
        repair_hours=4.0,
        speed_limit_kmh=80.0,
    )
    res = evaluate_defect_prioritization(req)
    assert res.active_defect_capacity_pce < 8000.0
    assert res.capacity_reduction_pct > 20.0
    assert res.daily_wasted_phd > 1000.0
    assert res.roi_phd_per_repair_hour > 0.0
    assert len(res.hourly_delay_curve) == 24
    assert len(res.corridor_defect_inventory) == 5

    # Defects must be sorted by ROI score descending
    ranks = [item.priority_rank for item in res.corridor_defect_inventory]
    assert ranks == [1, 2, 3, 4, 5]
    for i in range(len(res.corridor_defect_inventory) - 1):
        assert res.corridor_defect_inventory[i].roi_phd_per_repair_hour >= res.corridor_defect_inventory[i + 1].roi_phd_per_repair_hour


def test_surge_orchestration_engine():
    """Verify 180-minute timeline, peak v/c flattening, and clearance time reduction under staggered release."""
    req = SurgeOrchestratorRequest(
        corridor_id="corridor_26july",
        event_type="STADIUM_EGRESS",
        surge_vehicles=6000,
        base_corridor_flow_pce=3500.0,
        stagger_minutes=30,
        enable_express_chute=True,
    )
    res = evaluate_surge_orchestration(req)
    assert len(res.timeline) == 19  # 0 to 180 in step 10 min
    assert res.uncontrolled_peak_vc > res.staggered_peak_vc
    assert res.staggered_clearance_min < res.uncontrolled_clearance_min
    assert res.clearance_time_saved_min >= 15
    assert res.aggregate_delay_reduction_pct > 20.0
    assert len(res.gate_playbook_en) == 5
    assert len(res.gate_playbook_ar) == 5



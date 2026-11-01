"""
Integration tests for IT-DSS FastAPI REST API endpoints.
Tests corridor retrieval, telemetry queries, all 4 DSS POST engines, and CV ingestion.
"""

import sys
from pathlib import Path

_ROOT_DIR = Path(__file__).resolve().parent.parent.parent
if str(_ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(_ROOT_DIR))

import pytest
from fastapi.testclient import TestClient
from sqlmodel import SQLModel, create_engine, Session
from sqlmodel.pool import StaticPool

from backend.app.main import app, get_session
from backend.app.services.synthetic_seeder import seed_corridors_and_telemetry


@pytest.fixture(name="client")
def client_fixture():
    # In-memory SQLite database for testing
    test_engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(test_engine)

    with Session(test_engine) as session:
        seed_corridors_and_telemetry(session)

    def get_test_session():
        with Session(test_engine) as session:
            yield session

    app.dependency_overrides[get_session] = get_test_session
    client = TestClient(app)
    yield client
    app.dependency_overrides.clear()


def test_health_check(client):
    response = client.get("/api/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ONLINE"


def test_get_corridors(client):
    response = client.get("/api/corridors")
    assert response.status_code == 200
    corridors = response.json()
    assert len(corridors) == 3
    ids = [c["id"] for c in corridors]
    assert "corridor_26july" in ids
    assert "corridor_ring" in ids
    assert "corridor_salah_salem" in ids


def test_get_corridor_telemetry(client):
    response = client.get("/api/corridors/corridor_26july/telemetry?day_of_week=0")
    assert response.status_code == 200
    data = response.json()
    assert data["corridor_id"] == "corridor_26july"
    assert len(data["hourly_data"]) == 24
    assert len(data["hourly_data"][8]["lanes"]) == 4


def test_workzone_optimize_endpoint(client):
    payload = {
        "corridor_id": "corridor_26july",
        "closed_lanes": [1],
        "duration_hours": 4,
        "day_of_week": 0,
    }
    response = client.post("/api/dss/workzone-optimize", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["n_closed"] == 1
    assert len(data["optimal_windows"]) == 3
    assert data["sop"]["taper_length_m"] > 0
    assert len(data["weekly_optimal_windows"]) == 3
    assert data["weekly_worst_window"]["rank"] == 168
    assert data["weekly_optimal_windows"][0]["day_of_week"] is not None
    assert "day_of_week" in data["weekly_worst_window"]
    assert data["requested_window"] is None
    assert data["heavy_vehicle_percentage"] > 0.0
    for hour in data["hourly_curves"]:
        assert 0.0 <= hour["queue_length_m"] <= 600.0
        assert 0.0 <= hour["delay_sec_per_veh"] <= 600.0
        assert hour["person_hours_delay"] < 1_000_000.0
    for window in data["optimal_windows"]:
        assert window["avg_demand_pce"] > 0.0
        assert window["avg_capacity_pce"] > 0.0
        assert window["heavy_vehicle_percentage"] > 0.0
        assert window["max_queue_length_m"] <= 600.0


def test_workzone_requested_window_endpoint(client):
    payload = {
        "corridor_id": "corridor_26july",
        "closed_lanes": [1, 2],
        "duration_hours": 6,
        "day_of_week": 3,
        "target_start_hour": 9,
    }
    response = client.post("/api/dss/workzone-optimize", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["requested_window"]["start_hour"] == 9
    assert data["requested_window"]["day_of_week"] == 3
    assert data["requested_window"]["rank"] == 0


def test_sumo_workzone_uses_seeded_telemetry_demand(client):
    telemetry = client.get(
        "/api/corridors/corridor_26july/telemetry?day_of_week=0"
    ).json()
    peak = max(telemetry["hourly_data"], key=lambda item: item["total_pce"])

    response = client.post(
        "/api/dss/sumo/workzone-simulate",
        json={
            "corridor_id": "corridor_26july",
            "closed_lanes": [1],
            "day_of_week": 0,
            "target_start_hour": peak["hour"],
            "simulation_duration_sec": 10,
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["target_hour"] == peak["hour"]
    assert data["demand_pce"] == pytest.approx(peak["total_pce"], rel=1e-3)
    assert data["simulated_vehicles_count"] >= 0
    assert data["engine"].startswith("SUMO")


def test_intersection_simulate_endpoint(client):
    payload = {
        "main_flow": 3400.0,
        "cross_flow": 900.0,
        "turning_pct": 18.0,
        "heavy_pct": 12.0,
        "uturn_distance_m": 450.0,
    }
    response = client.post("/api/dss/intersection-simulate", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert len(data["alternatives"]) == 4
    assert data["recommended_option_id"] in ["UTURN", "SIGNAL", "ROUNDABOUT"]


def test_shockwave_predict_endpoint(client):
    payload = {
        "corridor_id": "corridor_26july",
        "hour": 8,
        "day_of_week": 0,
        "blocked_lanes": 2,
        "incident_type": "COLLISION",
        "weaving_index": 0.5,
    }
    response = client.post("/api/dss/shockwave-predict", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["backward_shockwave_speed_kmh"] >= 0
    assert data["backward_shockwave_speed_kmh"] <= 25.0
    assert len(data["queue_progression"]) > 0
    # A single day's four lanes must be aggregated, not all seven days.
    assert data["arrival_flow_pce"] < 20000.0
    assert data["arrival_speed_kmh"] < 120.0
    assert data["upstream_exit_distance_m"] == 600.0
    assert data["queue_progression"][-1]["queue_length_m"] <= 600.0
    assert data["jam_density_veh_km"] <= 1000.0
    assert data["arrival_density_veh_km"] < data["jam_density_veh_km"]
    for step in data["queue_progression"]:
        assert step["queue_length_m"] <= 600.0
        assert step["vehicles_in_queue"] >= 0
        assert 0.0 <= step["upstream_speed_kmh"] <= data["arrival_speed_kmh"]


def test_reversible_evaluate_endpoint(client):
    payload = {
        "corridor_id": "corridor_26july",
        "inbound_flow": 6800.0,
        "outbound_flow": 2100.0,
        "corridor_length_km": 8.5,
        "emergency_mode": False,
        "intersections_count": 4,
    }
    response = client.post("/api/dss/reversible-evaluate", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["recommended_mode"] == "REVERSIBLE_5_3"
    assert len(data["green_wave_schedule"]) == 4
    # 8.5 km corridor with 4 signals -> 2,125 m average spacing, not a fixed
    # 450 m. The offsets must be derived from that physical distance.
    assert data["green_wave_schedule"][1]["distance_from_start_m"] == pytest.approx(2125.0)
    assert data["green_wave_schedule"][1]["offset_seconds"] == pytest.approx(
        (2125.0 / (60.0 / 3.6)) % 90.0, abs=0.1
    )
    assert 0.0 <= data["pre_arrival_flush_time_sec"] <= 240.0
    assert 0.0 <= data["travel_time_saved_pct"] <= 100.0
    for config in (data["standard_4_4"], data["reversible_5_3"]):
        assert 0.0 <= config["inbound_delay_sec"] <= 600.0
        assert 0.0 <= config["outbound_safety_margin_pct"] <= 100.0
        assert config["inbound_speed_kmh"] >= 12.0


def test_cv_ingest_endpoint(client):
    payload = {
        "camera_id": "CAM_OCT_04",
        "corridor_id": "corridor_26july",
        "lanes": [
            {
                "lane_number": 1,
                "count_cars": 25,
                "count_microbus": 15,
                "count_buses": 4,
                "count_trucks": 8,
                "count_motorcycles": 5,
                "avg_speed_kmh": 52.0,
                "lane_weaving_index": 0.45,
            },
            {
                "lane_number": 2,
                "count_cars": 45,
                "count_microbus": 10,
                "count_buses": 2,
                "count_trucks": 2,
                "count_motorcycles": 3,
                "avg_speed_kmh": 68.0,
                "lane_weaving_index": 0.25,
            },
        ],
    }
    response = client.post("/api/cv/ingest", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "SUCCESS"
    assert data["processed_lanes"] == 2
    assert data["state_updated"] is True
    assert data["telemetry_day_of_week"] is not None
    assert data["telemetry_hour"] is not None

    # The live camera frame must be persisted into the current-hour telemetry.
    telemetry = client.get(
        f"/api/corridors/corridor_26july/telemetry?day_of_week={data['telemetry_day_of_week']}"
    )
    assert telemetry.status_code == 200
    hour_record = next(
        h for h in telemetry.json()["hourly_data"] if h["hour"] == data["telemetry_hour"]
    )
    lane1 = next(l for l in hour_record["lanes"] if l["lane_number"] == 1)
    lane2 = next(l for l in hour_record["lanes"] if l["lane_number"] == 2)
    assert lane1["count_cars"] == 25
    assert lane1["count_microbus"] == 15
    assert lane1["avg_speed_kmh"] == 52.0
    assert lane2["count_cars"] == 45
    assert lane2["avg_speed_kmh"] == 68.0
    assert lane1["pce_flow"] == pytest.approx(77.5)
    assert lane2["pce_flow"] == pytest.approx(70.2)


def test_realistic_hourly_telemetry_flow_envelope(client):
    """
    Verify that 24-hour demand does NOT monotonically climb to 60,000 PCE/h.
    Each hour h (0..23) must return realistic directional 4-lane flow rates:
    - Night (00:00 - 05:00): 900 to 1,800 PCE/h
    - Morning Peak (07:00 - 10:00): 6,200 to 7,400 PCE/h
    - Midday (11:00 - 13:00): 4,500 to 5,400 PCE/h
    - Afternoon Peak (14:00 - 18:00): 6,500 to 7,600 PCE/h
    - Evening (19:00 - 23:00): 3,200 to 5,200 PCE/h
    """
    res = client.get("/api/corridors/corridor_26july/telemetry?day_of_week=0")
    assert res.status_code == 200
    hourly = res.json()["hourly_data"]
    assert len(hourly) == 24

    for item in hourly:
        h = item["hour"]
        total_pce = item["total_pce"]

        # Critical check: Must never exceed 8,500 PCE/h (corridor physical capacity)
        assert total_pce <= 8500.0, f"Hour {h} total PCE {total_pce} exceeded corridor physical capacity!"

        if 0 <= h <= 5:
            assert 800 <= total_pce <= 2200, f"Night hour {h} flow {total_pce} outside expected envelope"
        elif 7 <= h <= 10:
            assert 5800 <= total_pce <= 7800, f"Morning peak hour {h} flow {total_pce} outside expected envelope"
        elif 11 <= h <= 13:
            assert 4200 <= total_pce <= 5800, f"Midday hour {h} flow {total_pce} outside expected envelope"
        elif 14 <= h <= 18:
            assert 6000 <= total_pce <= 8000, f"Afternoon peak hour {h} flow {total_pce} outside expected envelope"
        elif 19 <= h <= 23:
            assert 2800 <= total_pce <= 5500, f"Evening hour {h} flow {total_pce} outside expected envelope"


def test_weather_protocol_api(client):
    """Test POST /api/dss/weather-protocol endpoint."""
    payload = {
        "corridor_id": "corridor_26july",
        "visibility_m": 45.0,
        "current_speed_limit_kmh": 90.0,
        "road_condition": "wet",
        "gradient_pct": 1.0,
        "traffic_flow_pce": 4000.0,
    }
    res = client.post("/api/dss/weather-protocol", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert data["visibility_m"] == 45.0
    assert data["safe_advisory_speed_kmh"] <= 60.0
    assert data["pacing_convoy_required"] is True
    assert len(data["police_sop_actions_ar"]) > 0


def test_checkpoint_optimize_api(client):
    """Test POST /api/dss/checkpoint-optimize endpoint."""
    payload = {
        "checkpoint_id": "toll_km26",
        "inbound_flow_veh_per_hour": 2500,
        "total_booths": 8,
        "open_booths": 4,
        "booth_type": "mixed",
        "service_rate_per_booth_vph": 300,
        "heavy_vehicle_share_pct": 20,
        "target_max_wait_sec": 60,
    }
    res = client.post("/api/dss/checkpoint-optimize", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert data["total_booths"] == 8
    assert data["optimal_open_booths"] >= 4
    assert len(data["booth_allocation_ar"]) == 8


def test_diversion_balance_api(client):
    """Test POST /api/dss/diversion-balance endpoint."""
    payload = {
        "total_corridor_demand_vph": 8000,
        "primary_corridor_name": "26th July",
        "primary_free_flow_time_min": 15.0,
        "primary_capacity_vph": 4800,
        "alternate_corridor_name": "Rod El-Farag",
        "alternate_free_flow_time_min": 18.0,
        "alternate_capacity_vph": 6200,
        "incident_delay_factor": 2.0,
    }
    res = client.post("/api/dss/diversion-balance", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert data["time_saved_per_vehicle_min"] > 0
    assert data["vms_switch_active"] is True
    assert len(data["diversion_curve"]) == 36


def test_ramp_metering_api(client):
    """Test POST /api/dss/ramp-metering endpoint."""
    payload = {
        "corridor_id": "corridor_26july",
        "mainline_flow_pce": 5800.0,
        "ramp_demand_pce": 1100.0,
        "heavy_pct": 16.0,
        "control_mode": "ALINEA_METERED",
    }
    res = client.post("/api/dss/ramp-metering", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert data["mainline_flow_pce"] == 5800.0
    assert data["metering_rate_pce_h"] >= 300.0
    assert len(data["modes"]) == 3


def test_defect_prioritize_api(client):
    """Test POST /api/dss/defect-prioritize endpoint."""
    payload = {
        "corridor_id": "corridor_26july",
        "defect_type": "DAMAGED_EXPANSION_JOINT",
        "crawl_speed_kmh": 14.0,
        "affected_lanes": 2,
        "repair_hours": 4.0,
        "speed_limit_kmh": 80.0,
    }
    res = client.post("/api/dss/defect-prioritize", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert data["daily_wasted_phd"] > 0.0
    assert len(data["corridor_defect_inventory"]) == 5
    assert len(data["hourly_delay_curve"]) == 24


def test_surge_dispersal_api(client):
    """Test POST /api/dss/surge-dispersal endpoint."""
    payload = {
        "corridor_id": "corridor_26july",
        "event_type": "STADIUM_EGRESS",
        "surge_vehicles": 5000,
        "base_corridor_flow_pce": 3600.0,
        "stagger_minutes": 30,
        "enable_express_chute": True,
    }
    res = client.post("/api/dss/surge-dispersal", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert len(data["timeline"]) == 19
    assert data["clearance_time_saved_min"] >= 15
    assert len(data["gate_playbook_en"]) == 5



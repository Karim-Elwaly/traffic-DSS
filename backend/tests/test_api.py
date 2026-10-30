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
    # PCE uses the platform-wide weighting (cars 1.0, microbus 1.5, bus 2.0,
    # truck 2.5, motorcycle 0.4).
    assert lane1["pce_flow"] == pytest.approx(77.5)
    assert lane2["pce_flow"] == pytest.approx(70.2)

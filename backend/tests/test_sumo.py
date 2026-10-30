"""
Unit and integration tests for SUMO (Simulation of Urban MObility) and TraCI integration.
Verifies network loading, dynamic demand XML synthesis, microscopic simulation execution,
and API contracts.
"""

import sys
from pathlib import Path

_ROOT_DIR = Path(__file__).resolve().parent.parent.parent
if str(_ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(_ROOT_DIR))

import pytest
from fastapi.testclient import TestClient
from backend.app.main import app
from backend.app.models.schemas import IntersectionRequest
from backend.app.sumo.generator import generate_demand_xml, get_vehicle_type_distribution
from backend.app.sumo.runner import (
    execute_traci_micro_sim,
    get_sumo_environment_info,
    NETWORKS_DIR,
)
from backend.app.sumo.service import run_sumo_simulation, get_sumo_system_status


def test_sumo_network_files_exist():
    """Verify the intersection network XML files, highway network, and base config exist."""
    required_files = [
        "open_intersection.net.xml",
        "signal_intersection.net.xml",
        "uturn_corridor.net.xml",
        "roundabout.net.xml",
        "highway_4lane.net.xml",
        "base.sumocfg",
    ]
    for filename in required_files:
        net_path = NETWORKS_DIR / filename
        assert net_path.exists(), f"Network file {filename} is missing from {NETWORKS_DIR}"
        assert net_path.stat().st_size > 500, f"Network file {filename} is empty or corrupt"


def test_sumo_demand_generator_multi_class():
    """Verify dynamic routes and Egyptian vehicle class synthesis."""
    dist = get_vehicle_type_distribution(heavy_pct=15.0)
    vtypes = [v[0] for v in dist]
    assert "veh_car" in vtypes
    assert "veh_microbus" in vtypes
    assert "veh_truck" in vtypes
    assert "veh_bus" in vtypes

    # Generate XML for Protected U-Turn Corridor
    xml = generate_demand_xml(
        alt_id="UTURN",
        main_flow_vehh=3500.0,
        cross_flow_vehh=900.0,
        turning_pct=20.0,
        heavy_pct=15.0,
        duration_sec=60,
    )
    assert "<routes" in xml
    assert "</routes>" in xml
    assert 'vType id="veh_microbus"' in xml
    assert 'route id="r_w_e"' in xml
    assert 'route id="r_w_u"' in xml
    assert "<vehicle" in xml


def test_sumo_micro_simulation_all_alternatives():
    """Verify microscopic simulation execution across all 4 geometries."""
    alternatives = ["OPEN", "SIGNAL", "UTURN", "ROUNDABOUT"]
    for alt in alternatives:
        res = execute_traci_micro_sim(
            alt_id=alt,
            main_flow_vehh=3200.0,
            cross_flow_vehh=800.0,
            turning_pct=15.0,
            heavy_pct=10.0,
            uturn_dist_m=450.0,
            duration_sec=300,
        )
        assert res["average_delay_sec"] > 0.0
        # Free-flow geometries (open intersection and protected U-turn) can
        # legitimately have zero fully-stopped vehicles at moderate demand.
        assert res["queue_95th_m"] >= 0.0
        if alt in ("SIGNAL", "ROUNDABOUT"):
            assert res["queue_95th_m"] > 0.0
        assert res["simulated_vehicles_count"] > 0
        assert res["mean_speed_kmh"] > 0.0
        assert res["co2_emissions_kg_h"] > 0.0
        assert res["fuel_consumption_liters_h"] > 0.0
        assert "engine" in res


def test_sumo_service_digital_twin():
    """Verify SUMO service orchestrates 4-alternative comparison and recommendation."""
    req = IntersectionRequest(
        main_flow=4200.0,  # High mainline flow triggers U-turn recommendation
        cross_flow=1100.0,
        turning_pct=22.0,
        heavy_pct=14.0,
        uturn_distance_m=400.0,
        engine_mode="sumo",
        simulation_duration_sec=300,
    )
    resp = run_sumo_simulation(req)
    assert len(resp.alternatives) == 4
    assert resp.recommended_option_id == "UTURN"
    assert resp.recommendation_rationale_en != ""
    assert resp.recommendation_rationale_ar != ""

    # Ensure each alternative has populated SUMO microscopic metrics
    for alt in resp.alternatives:
        assert alt.sumo_metrics is not None
        assert alt.sumo_metrics.simulated_vehicles_count > 0
        assert alt.sumo_metrics.co2_emissions_kg_h > 0.0


def test_sumo_api_endpoints():
    """Verify FastAPI integration for SUMO status and simulation endpoints."""
    client = TestClient(app)

    # 1. GET /api/dss/sumo/status
    res_status = client.get("/api/dss/sumo/status")
    assert res_status.status_code == 200
    data_status = res_status.json()
    assert "networks_ready" in data_status
    assert len(data_status["networks_ready"]) == 5
    for net in (
        "open_intersection.net.xml",
        "signal_intersection.net.xml",
        "uturn_corridor.net.xml",
        "roundabout.net.xml",
        "highway_4lane.net.xml",
    ):
        assert net in data_status["networks_ready"]

    # 2. POST /api/dss/intersection-simulate with engine_mode='sumo'
    payload = {
        "main_flow": 3000.0,
        "cross_flow": 800.0,
        "turning_pct": 18.0,
        "heavy_pct": 10.0,
        "uturn_distance_m": 450.0,
        "engine_mode": "sumo",
        "simulation_duration_sec": 300,
    }
    res_sim = client.post("/api/dss/intersection-simulate", json=payload)
    assert res_sim.status_code == 200
    data_sim = res_sim.json()
    assert len(data_sim["alternatives"]) == 4
    assert data_sim["alternatives"][0]["sumo_metrics"] is not None
    assert data_sim["engine_used"].startswith("SUMO")

    # 3. POST /api/dss/sumo/intersection-simulate
    res_direct = client.post("/api/dss/sumo/intersection-simulate", json=payload)
    assert res_direct.status_code == 200
    assert res_direct.json()["recommended_option_id"] in ("UTURN", "SIGNAL", "ROUNDABOUT")

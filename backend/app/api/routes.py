"""
API Routes for the Intelligent Traffic Decision Support System (IT-DSS).
Exposes REST endpoints for corridors, telemetry, all 4 DSS engines, and CV ingestion.
"""

import sys
from pathlib import Path

_ROOT_DIR = Path(__file__).resolve().parent.parent.parent.parent
if str(_ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(_ROOT_DIR))

from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select

from backend.app.database import get_session
from backend.app.models.domain import Corridor, HourlyTelemetry
from backend.app.models.schemas import (
    CorridorSummary,
    CorridorTelemetryResponse,
    HourlyCorridorTelemetry,
    LaneTelemetryItem,
    WorkZoneRequest,
    WorkZoneResponse,
    IntersectionRequest,
    IntersectionResponse,
    ShockwaveRequest,
    ShockwaveResponse,
    ReversibleRequest,
    ReversibleResponse,
    CVIngestRequest,
    CVIngestResponse,
)
from backend.app.core.workzone_engine import optimize_workzone_schedule
from backend.app.core.intersection_engine import simulate_intersections
from backend.app.core.shockwave_engine import predict_incident_shockwave
from backend.app.core.reversible_engine import evaluate_reversible_corridor
from backend.app.services.cv_ingestion import process_cv_feed
from backend.app.sumo.service import run_sumo_simulation, get_sumo_system_status
from backend.app.sumo.runner import execute_traci_workzone_sim, launch_sumo_gui

router = APIRouter(prefix="/api", tags=["IT-DSS Core"])


# ---------------------------------------------------------------------------
# Health Check
# ---------------------------------------------------------------------------
@router.get("/health")
def health_check():
    return {
        "status": "ONLINE",
        "service": "Intelligent Traffic Decision Support System (IT-DSS)",
        "version": "1.0.0-production",
        "engines": ["HCM-WorkZone", "Webster-Intersection", "LWR-Shockwave", "Dynamic-Reversible"],
    }


# ---------------------------------------------------------------------------
# Corridors & Telemetry
# ---------------------------------------------------------------------------
@router.get("/corridors", response_model=List[CorridorSummary])
def list_corridors(session: Session = Depends(get_session)):
    corridors = session.exec(select(Corridor)).all()
    return [
        CorridorSummary(
            id=c.id,
            name_en=c.name_en,
            name_ar=c.name_ar,
            num_lanes=c.num_lanes,
            speed_limit_kmh=c.speed_limit_kmh,
            upstream_exit_distance_m=c.upstream_exit_distance_m,
            base_capacity_per_lane=c.base_capacity_per_lane,
            description_en=c.description_en,
            description_ar=c.description_ar,
        )
        for c in corridors
    ]


@router.get("/corridors/{corridor_id}/telemetry", response_model=CorridorTelemetryResponse)
def get_corridor_telemetry(
    corridor_id: str,
    day_of_week: int = Query(default=0, ge=0, le=6),
    session: Session = Depends(get_session),
):
    corridor = session.get(Corridor, corridor_id)
    if not corridor:
        raise HTTPException(status_code=404, detail=f"Corridor '{corridor_id}' not found.")

    statement = (
        select(HourlyTelemetry)
        .where(HourlyTelemetry.corridor_id == corridor_id)
        .where(HourlyTelemetry.day_of_week == day_of_week)
        .order_by(HourlyTelemetry.hour, HourlyTelemetry.lane_number)
    )
    records = session.exec(statement).all()

    # Aggregate by hour
    hourly_data: List[HourlyCorridorTelemetry] = []
    for h in range(24):
        hour_lanes = [r for r in records if r.hour == h]
        if not hour_lanes:
            continue

        tot_pce = sum(r.pce_flow for r in hour_lanes)
        tot_pax = sum(r.passenger_flow for r in hour_lanes)
        avg_speed = sum(r.avg_speed_kmh for r in hour_lanes) / max(1, len(hour_lanes))
        avg_weaving = sum(r.lane_weaving_index for r in hour_lanes) / max(1, len(hour_lanes))

        tot_veh = sum(
            r.count_cars + r.count_microbus + r.count_buses + r.count_trucks + r.count_motorcycles
            for r in hour_lanes
        )
        tot_heavy = sum(r.count_buses + r.count_trucks for r in hour_lanes)
        heavy_pct = round((tot_heavy / max(1, tot_veh)) * 100.0, 1)

        lane_items = [
            LaneTelemetryItem(
                lane_number=r.lane_number,
                count_cars=r.count_cars,
                count_microbus=r.count_microbus,
                count_buses=r.count_buses,
                count_trucks=r.count_trucks,
                count_motorcycles=r.count_motorcycles,
                avg_speed_kmh=r.avg_speed_kmh,
                lane_weaving_index=r.lane_weaving_index,
                pce_flow=r.pce_flow,
                passenger_flow=r.passenger_flow,
            )
            for r in hour_lanes
        ]

        hourly_data.append(
            HourlyCorridorTelemetry(
                hour=h,
                total_pce=round(tot_pce, 1),
                total_passengers=round(tot_pax, 1),
                avg_speed_kmh=round(avg_speed, 1),
                avg_weaving_index=round(avg_weaving, 2),
                heavy_vehicle_percentage=heavy_pct,
                lanes=lane_items,
            )
        )

    return CorridorTelemetryResponse(
        corridor_id=corridor.id,
        corridor_name_en=corridor.name_en,
        corridor_name_ar=corridor.name_ar,
        day_of_week=day_of_week,
        hourly_data=hourly_data,
    )


# ---------------------------------------------------------------------------
# Module 1: Work-Zone & Lane Closure Advisor
# ---------------------------------------------------------------------------
@router.post("/dss/workzone-optimize", response_model=WorkZoneResponse)
def optimize_workzone(
    payload: WorkZoneRequest,
    session: Session = Depends(get_session),
):
    corridor = session.get(Corridor, payload.corridor_id)
    if not corridor:
        raise HTTPException(status_code=404, detail=f"Corridor '{payload.corridor_id}' not found.")

    # Load the full 7-day profile once so the optimizer can rank all 168 hourly
    # start positions, not just the selected analysis day.
    statement = (
        select(HourlyTelemetry)
        .where(HourlyTelemetry.corridor_id == payload.corridor_id)
        .order_by(HourlyTelemetry.day_of_week, HourlyTelemetry.hour, HourlyTelemetry.lane_number)
    )
    records = session.exec(statement).all()

    aggregates = {
        (day, hour): {"pce": 0.0, "pax": 0.0, "vehicles": 0.0, "heavy": 0.0}
        for day in range(7)
        for hour in range(24)
    }
    for record in records:
        bucket = aggregates[(record.day_of_week, record.hour)]
        bucket["pce"] += record.pce_flow
        bucket["pax"] += record.passenger_flow
        bucket["vehicles"] += (
            record.count_cars
            + record.count_microbus
            + record.count_buses
            + record.count_trucks
            + record.count_motorcycles
        )
        bucket["heavy"] += record.count_buses + record.count_trucks

    weekly_demands: List[List[float]] = []
    weekly_passengers: List[List[float]] = []
    weekly_heavy_ratios: List[List[float]] = []

    for day in range(7):
        day_pce: List[float] = []
        day_pax: List[float] = []
        day_hv: List[float] = []
        for hour in range(24):
            bucket = aggregates[(day, hour)]
            if bucket["vehicles"] <= 0:
                raise HTTPException(
                    status_code=404,
                    detail=(
                        f"Missing telemetry for corridor '{payload.corridor_id}' "
                        f"on day {day} at hour {hour}."
                    ),
                )
            day_pce.append(bucket["pce"])
            day_pax.append(bucket["pax"])
            day_hv.append(bucket["heavy"] / max(1.0, bucket["vehicles"]))
        weekly_demands.append(day_pce)
        weekly_passengers.append(day_pax)
        weekly_heavy_ratios.append(day_hv)

    selected_day = payload.day_of_week
    response = optimize_workzone_schedule(
        request=payload,
        hourly_demands=weekly_demands[selected_day],
        hourly_passengers=weekly_passengers[selected_day],
        hourly_heavy_ratios=weekly_heavy_ratios[selected_day],
        corridor_speed_limit=corridor.speed_limit_kmh,
        upstream_exit_distance_m=corridor.upstream_exit_distance_m,
        base_capacity_per_lane=corridor.base_capacity_per_lane,
        weekly_demands=weekly_demands,
        weekly_passengers=weekly_passengers,
        weekly_heavy_ratios=weekly_heavy_ratios,
    )

    if payload.engine_mode == "sumo":
        target_hr = payload.target_start_hour if payload.target_start_hour is not None else (
            response.optimal_windows[0].start_hour if response.optimal_windows else 2
        )
        sim_demand = weekly_demands[selected_day][target_hr] if 0 <= target_hr < 24 else 2500.0
        duration = getattr(payload, "simulation_duration_sec", 60)
        heavy_share = (
            weekly_heavy_ratios[selected_day][target_hr] * 100.0
            if 0 <= target_hr < 24
            else 12.0
        )
        try:
            wz_metrics = execute_traci_workzone_sim(
                closed_lanes=payload.closed_lanes,
                demand_pce=sim_demand,
                speed_limit_kmh=corridor.speed_limit_kmh,
                duration_sec=duration,
                heavy_pct=heavy_share,
            )
            response.sumo_metrics = wz_metrics
        except Exception as err:
            logger.warning(f"SUMO workzone simulation error: {err}")

    return response


@router.post("/dss/sumo/workzone-simulate")
def simulate_workzone_sumo(payload: WorkZoneRequest, session: Session = Depends(get_session)):
    corridor = session.get(Corridor, payload.corridor_id)
    if not corridor:
        raise HTTPException(status_code=404, detail=f"Corridor '{payload.corridor_id}' not found.")

    # Resolve demand from the same seeded telemetry that drives the analytical
    # engine. When no target hour is supplied, stress-test the day's peak hour.
    records = session.exec(
        select(HourlyTelemetry)
        .where(HourlyTelemetry.corridor_id == payload.corridor_id)
        .where(HourlyTelemetry.day_of_week == payload.day_of_week)
    ).all()
    hourly_pce: dict[int, float] = {h: 0.0 for h in range(24)}
    hourly_vehicles: dict[int, float] = {h: 0.0 for h in range(24)}
    hourly_heavy: dict[int, float] = {h: 0.0 for h in range(24)}
    for record in records:
        hourly_pce[record.hour] += record.pce_flow
        hourly_vehicles[record.hour] += (
            record.count_cars
            + record.count_microbus
            + record.count_buses
            + record.count_trucks
            + record.count_motorcycles
        )
        hourly_heavy[record.hour] += record.count_buses + record.count_trucks

    populated = {h: value for h, value in hourly_pce.items() if value > 0.0}
    if not populated:
        raise HTTPException(
            status_code=404,
            detail=(
                f"No telemetry for corridor '{payload.corridor_id}' on day "
                f"{payload.day_of_week}."
            ),
        )
    if payload.target_start_hour is not None:
        target_hr = payload.target_start_hour
    else:
        target_hr = max(populated, key=lambda hour: populated[hour])
    if target_hr not in populated:
        raise HTTPException(
            status_code=404,
            detail=(
                f"No telemetry for corridor '{payload.corridor_id}' on day "
                f"{payload.day_of_week} at hour {target_hr}."
            ),
        )
    demand_pce = populated[target_hr]
    heavy_pct = (
        100.0 * hourly_heavy[target_hr] / hourly_vehicles[target_hr]
        if hourly_vehicles[target_hr] > 0
        else 0.0
    )

    metrics = execute_traci_workzone_sim(
        closed_lanes=payload.closed_lanes,
        demand_pce=demand_pce,
        speed_limit_kmh=corridor.speed_limit_kmh,
        duration_sec=getattr(payload, "simulation_duration_sec", 60),
        heavy_pct=heavy_pct,
    )
    metrics["demand_pce"] = round(demand_pce, 1)
    metrics["target_hour"] = target_hr
    metrics["day_of_week"] = payload.day_of_week
    return metrics


# ---------------------------------------------------------------------------
# Module 2: Intersection Signal Warrant & What-If
# ---------------------------------------------------------------------------
@router.post("/dss/intersection-simulate", response_model=IntersectionResponse)
def simulate_intersection_alternatives(payload: IntersectionRequest):
    if payload.engine_mode == "sumo":
        try:
            return run_sumo_simulation(payload)
        except Exception as e:
            import traceback
            err_msg = traceback.format_exc()
            with open("sumo_error.log", "w", encoding="utf-8") as f:
                f.write(err_msg)
            raise HTTPException(status_code=500, detail=str(e))
    return simulate_intersections(payload)


@router.get("/dss/sumo/status")
def get_sumo_status():
    return get_sumo_system_status()


@router.post("/dss/sumo/launch-gui")
def trigger_sumo_gui(
    scenario: str = Query("intersection", description="'intersection' | 'workzone'"),
    alt_id: str = Query("SIGNAL", description="'OPEN' | 'SIGNAL' | 'UTURN' | 'ROUNDABOUT'"),
):
    try:
        return launch_sumo_gui(scenario_type=scenario, alt_id=alt_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/dss/sumo/intersection-simulate", response_model=IntersectionResponse)
def simulate_with_sumo_endpoint(payload: IntersectionRequest):
    payload.engine_mode = "sumo"
    return run_sumo_simulation(payload)


# ---------------------------------------------------------------------------
# Module 3: Incident Shockwave & Micro-Friction Predictor
# ---------------------------------------------------------------------------
@router.post("/dss/shockwave-predict", response_model=ShockwaveResponse)
def predict_shockwave(
    payload: ShockwaveRequest,
    session: Session = Depends(get_session),
):
    corridor = session.get(Corridor, payload.corridor_id)
    if not corridor:
        raise HTTPException(status_code=404, detail=f"Corridor '{payload.corridor_id}' not found.")

    statement = (
        select(HourlyTelemetry)
        .where(HourlyTelemetry.corridor_id == payload.corridor_id)
        .where(HourlyTelemetry.day_of_week == payload.day_of_week)
        .where(HourlyTelemetry.hour == payload.hour)
    )
    records = session.exec(statement).all()

    if not records:
        raise HTTPException(
            status_code=404,
            detail=(
                f"No telemetry for corridor '{payload.corridor_id}' on day "
                f"{payload.day_of_week} at hour {payload.hour}."
            ),
        )

    arrival_flow = sum(r.pce_flow for r in records)
    arrival_speed = sum(r.avg_speed_kmh for r in records) / max(1, len(records))
    vehicle_count = sum(
        r.count_cars
        + r.count_microbus
        + r.count_buses
        + r.count_trucks
        + r.count_motorcycles
        for r in records
    )
    avg_pce = arrival_flow / max(1.0, float(vehicle_count))

    response = predict_incident_shockwave(
        request=payload,
        arrival_flow_pce=arrival_flow,
        arrival_speed_kmh=arrival_speed,
        upstream_exit_distance_m=corridor.upstream_exit_distance_m,
        base_capacity_per_lane=corridor.base_capacity_per_lane,
        avg_pce=avg_pce,
    )

    if payload.engine_mode == "sumo":
        closed_indices = list(range(1, payload.blocked_lanes + 1))
        duration = getattr(payload, "simulation_duration_sec", 60)
        try:
            sumo_res = execute_traci_workzone_sim(
                closed_lanes=closed_indices,
                demand_pce=arrival_flow,
                speed_limit_kmh=corridor.speed_limit_kmh,
                duration_sec=duration,
            )
            response.sumo_metrics = sumo_res
            response.engine_used = "SUMO / TraCI (C++ Highway Core)"
        except Exception as err:
            logger.warning(f"SUMO incident simulation error: {err}")

    return response


# ---------------------------------------------------------------------------
# Module 4: Dynamic Reversible Lanes & Green Wave
# ---------------------------------------------------------------------------
@router.post("/dss/reversible-evaluate", response_model=ReversibleResponse)
def evaluate_reversible(payload: ReversibleRequest):
    return evaluate_reversible_corridor(payload)


# ---------------------------------------------------------------------------
# Edge Computer Vision (YOLO + ByteTrack) Ingestion Webhook
# ---------------------------------------------------------------------------
@router.post("/cv/ingest", response_model=CVIngestResponse)
def ingest_cv_telemetry(
    payload: CVIngestRequest,
    session: Session = Depends(get_session),
):
    result = process_cv_feed(payload, session)
    if result.status == "ERROR":
        raise HTTPException(status_code=404, detail=result.message)
    return result

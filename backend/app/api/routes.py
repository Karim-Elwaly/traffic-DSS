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

router = APIRouter(prefix="/api", tags=["IT-DSS Core"])


def get_db():
    from backend.app.main import get_session
    with get_session() as session:
        yield session


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
def list_corridors(session: Session = Depends(get_db)):
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
    session: Session = Depends(get_db),
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
    session: Session = Depends(get_db),
):
    corridor = session.get(Corridor, payload.corridor_id)
    if not corridor:
        raise HTTPException(status_code=404, detail=f"Corridor '{payload.corridor_id}' not found.")

    statement = (
        select(HourlyTelemetry)
        .where(HourlyTelemetry.corridor_id == payload.corridor_id)
        .where(HourlyTelemetry.day_of_week == payload.day_of_week)
        .order_by(HourlyTelemetry.hour, HourlyTelemetry.lane_number)
    )
    records = session.exec(statement).all()

    hourly_demands: List[float] = []
    hourly_passengers: List[float] = []
    hourly_heavy_ratios: List[float] = []

    for h in range(24):
        hour_lanes = [r for r in records if r.hour == h]
        if hour_lanes:
            h_pce = sum(r.pce_flow for r in hour_lanes)
            h_pax = sum(r.passenger_flow for r in hour_lanes)
            tot_v = sum(
                r.count_cars + r.count_microbus + r.count_buses + r.count_trucks + r.count_motorcycles
                for r in hour_lanes
            )
            tot_hv = sum(r.count_buses + r.count_trucks for r in hour_lanes)
            hv_ratio = tot_hv / max(1, tot_v)
        else:
            # Fallback default values
            h_pce = 4500.0
            h_pax = 12000.0
            hv_ratio = 0.12

        hourly_demands.append(h_pce)
        hourly_passengers.append(h_pax)
        hourly_heavy_ratios.append(hv_ratio)

    response = optimize_workzone_schedule(
        request=payload,
        hourly_demands=hourly_demands,
        hourly_passengers=hourly_passengers,
        hourly_heavy_ratios=hourly_heavy_ratios,
        corridor_speed_limit=corridor.speed_limit_kmh,
        upstream_exit_distance_m=corridor.upstream_exit_distance_m,
        base_capacity_per_lane=corridor.base_capacity_per_lane,
    )
    return response


# ---------------------------------------------------------------------------
# Module 2: Intersection Signal Warrant & What-If
# ---------------------------------------------------------------------------
@router.post("/dss/intersection-simulate", response_model=IntersectionResponse)
def simulate_intersection_alternatives(payload: IntersectionRequest):
    return simulate_intersections(payload)


# ---------------------------------------------------------------------------
# Module 3: Incident Shockwave & Micro-Friction Predictor
# ---------------------------------------------------------------------------
@router.post("/dss/shockwave-predict", response_model=ShockwaveResponse)
def predict_shockwave(
    payload: ShockwaveRequest,
    session: Session = Depends(get_db),
):
    corridor = session.get(Corridor, payload.corridor_id)
    if not corridor:
        raise HTTPException(status_code=404, detail=f"Corridor '{payload.corridor_id}' not found.")

    statement = (
        select(HourlyTelemetry)
        .where(HourlyTelemetry.corridor_id == payload.corridor_id)
        .where(HourlyTelemetry.hour == payload.hour)
    )
    records = session.exec(statement).all()

    if records:
        arrival_flow = sum(r.pce_flow for r in records)
        arrival_speed = sum(r.avg_speed_kmh for r in records) / max(1, len(records))
    else:
        arrival_flow = 5800.0
        arrival_speed = corridor.speed_limit_kmh * 0.75

    return predict_incident_shockwave(
        request=payload,
        arrival_flow_pce=arrival_flow,
        arrival_speed_kmh=arrival_speed,
        upstream_exit_distance_m=corridor.upstream_exit_distance_m,
        base_capacity_per_lane=corridor.base_capacity_per_lane,
    )


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
    session: Session = Depends(get_db),
):
    return process_cv_feed(payload, session)

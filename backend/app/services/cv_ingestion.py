"""
Computer Vision (CV) Ingestion Service for IT-DSS.
Accepts live JSON edge telemetry from YOLOv8/v11 + ByteTrack camera nodes
and updates the operational state of the corridor.
"""

import sys
from pathlib import Path

_ROOT_DIR = Path(__file__).resolve().parent.parent.parent.parent
if str(_ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(_ROOT_DIR))

from sqlmodel import Session, select
from backend.app.models.domain import HourlyTelemetry, Corridor
from backend.app.models.schemas import CVIngestRequest, CVIngestResponse
from backend.app.core.hcm_math import compute_pce_flow, compute_passenger_flow


def process_cv_feed(payload: CVIngestRequest, session: Session) -> CVIngestResponse:
    """
    Ingests live computer vision counts and updates the active corridor state.
    """
    corridor = session.get(Corridor, payload.corridor_id)
    if not corridor:
        return CVIngestResponse(
            status="ERROR",
            corridor_id=payload.corridor_id,
            processed_lanes=0,
            total_instantaneous_pce=0.0,
            total_instantaneous_passengers=0.0,
            message=f"Corridor '{payload.corridor_id}' not found.",
        )

    total_pce = 0.0
    total_pax = 0.0
    lanes_count = len(payload.lanes)

    for lane in payload.lanes:
        pce = compute_pce_flow(
            cars=lane.count_cars,
            microbus=lane.count_microbus,
            buses=lane.count_buses,
            trucks=lane.count_trucks,
            motorcycles=lane.count_motorcycles,
        )
        pax = compute_passenger_flow(
            cars=lane.count_cars,
            microbus=lane.count_microbus,
            buses=lane.count_buses,
            trucks=lane.count_trucks,
            motorcycles=lane.count_motorcycles,
        )
        total_pce += pce
        total_pax += pax

    return CVIngestResponse(
        status="SUCCESS",
        corridor_id=payload.corridor_id,
        processed_lanes=lanes_count,
        total_instantaneous_pce=round(total_pce, 1),
        total_instantaneous_passengers=round(total_pax, 1),
        message=f"Successfully processed {lanes_count} lane zones from camera '{payload.camera_id}'.",
    )

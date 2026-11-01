"""
Computer Vision (CV) Ingestion Service for IT-DSS.
Accepts live JSON edge telemetry from YOLOv8/v11 + ByteTrack camera nodes,
updates the current live corridor state, and returns instantaneous PCE and
human passenger throughput.
"""

import sys
from pathlib import Path

_ROOT_DIR = Path(__file__).resolve().parent.parent.parent.parent
if str(_ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(_ROOT_DIR))

from datetime import datetime, timezone
import math
from sqlmodel import Session, select
from backend.app.models.domain import HourlyTelemetry, Corridor
from backend.app.models.schemas import CVIngestRequest, CVIngestResponse
from backend.app.core.hcm_math import compute_pce_flow, compute_passenger_flow


def _current_day_of_week(now: datetime) -> int:
    """Maps Python weekday (Monday=0) to the project's Sunday=0 convention."""
    return (now.weekday() + 1) % 7


def _resolve_frame_time(timestamp_epoch: float | None) -> datetime:
    """
    Resolves the edge camera timestamp to a timezone-aware UTC datetime.

    The original service always used ``datetime.now()``, which silently
    re-assigned delayed or replayed camera frames to the current hour and
    corrupted the live baseline. An invalid or non-finite epoch falls back to
    wall-clock time rather than crashing the ingest webhook.
    """
    if timestamp_epoch is None:
        return datetime.now(timezone.utc)
    try:
        epoch = float(timestamp_epoch)
        if not math.isfinite(epoch) or epoch <= 0.0:
            return datetime.now(timezone.utc)
        # Accept both seconds and milliseconds since the Unix epoch.
        if epoch > 1e11:
            epoch /= 1000.0
        return datetime.fromtimestamp(epoch, tz=timezone.utc)
    except (OverflowError, OSError, ValueError, TypeError):
        return datetime.now(timezone.utc)


def process_cv_feed(payload: CVIngestRequest, session: Session) -> CVIngestResponse:
    """
    Ingests live computer vision counts and updates the current hour/lane
    telemetry state so every DSS module immediately sees the latest field data.
    """
    corridor = session.get(Corridor, payload.corridor_id)
    if not corridor:
        return CVIngestResponse(
            status="ERROR",
            corridor_id=payload.corridor_id,
            processed_lanes=0,
            total_instantaneous_pce=0.0,
            total_instantaneous_passengers=0.0,
            state_updated=False,
            message=f"Corridor '{payload.corridor_id}' not found.",
        )

    now = _resolve_frame_time(payload.timestamp_epoch)
    day_of_week = _current_day_of_week(now)
    hour = now.hour

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

        statement = (
            select(HourlyTelemetry)
            .where(HourlyTelemetry.corridor_id == payload.corridor_id)
            .where(HourlyTelemetry.day_of_week == day_of_week)
            .where(HourlyTelemetry.hour == hour)
            .where(HourlyTelemetry.lane_number == lane.lane_number)
        )
        record = session.exec(statement).first()

        if record is None:
            record = HourlyTelemetry(
                corridor_id=payload.corridor_id,
                day_of_week=day_of_week,
                hour=hour,
                lane_number=lane.lane_number,
            )

        record.count_cars = lane.count_cars
        record.count_microbus = lane.count_microbus
        record.count_buses = lane.count_buses
        record.count_trucks = lane.count_trucks
        record.count_motorcycles = lane.count_motorcycles
        record.avg_speed_kmh = lane.avg_speed_kmh
        record.lane_weaving_index = lane.lane_weaving_index
        record.pce_flow = round(pce, 1)
        record.passenger_flow = round(pax, 1)
        record.timestamp = now
        session.add(record)

    session.commit()

    return CVIngestResponse(
        status="SUCCESS",
        corridor_id=payload.corridor_id,
        processed_lanes=lanes_count,
        total_instantaneous_pce=round(total_pce, 1),
        total_instantaneous_passengers=round(total_pax, 1),
        state_updated=True,
        telemetry_day_of_week=day_of_week,
        telemetry_hour=hour,
        message=(
            f"Successfully processed {lanes_count} lane zones from camera '{payload.camera_id}' "
            f"and updated the live corridor state for day {day_of_week}, hour {hour:02d}:00."
        ),
    )

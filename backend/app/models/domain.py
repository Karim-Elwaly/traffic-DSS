"""
Domain models for the Intelligent Traffic Decision Support System (IT-DSS).
Uses SQLModel (SQLAlchemy + Pydantic) for zero-config SQLite persistence.
"""

from typing import Optional
from datetime import datetime, timezone
from sqlmodel import SQLModel, Field


class Corridor(SQLModel, table=True):
    """
    Arterial corridor definition (e.g., 26th of July, Ring Road, Salah Salem).
    All corridors have N=4 lanes per direction by default.
    """
    __tablename__ = "corridors"

    id: str = Field(primary_key=True, index=True)
    name_en: str
    name_ar: str
    num_lanes: int = Field(default=4)
    speed_limit_kmh: float = Field(default=80.0)
    upstream_exit_distance_m: float = Field(default=600.0)
    base_capacity_per_lane: float = Field(default=2000.0)  # PCE/h/lane
    description_en: Optional[str] = None
    description_ar: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class HourlyTelemetry(SQLModel, table=True):
    """
    Per-lane hourly historical/synthetic traffic baseline data.
    Stores counts for 5 vehicle classifications, average speed, lateral lane-weaving,
    and precomputed PCE and human passenger flows.
    """
    __tablename__ = "hourly_telemetry"

    id: Optional[int] = Field(default=None, primary_key=True)
    corridor_id: str = Field(foreign_key="corridors.id", index=True)
    day_of_week: int = Field(index=True)  # 0 = Sunday, 1 = Monday, ..., 6 = Saturday (or ISO 0=Monday..6=Sunday)
    hour: int = Field(index=True)         # 0 .. 23
    lane_number: int = Field(index=True)  # 1 (rightmost heavy) to 4 (leftmost fast)

    # Class-specific counts
    count_cars: int = Field(default=0)
    count_microbus: int = Field(default=0)
    count_buses: int = Field(default=0)
    count_trucks: int = Field(default=0)
    count_motorcycles: int = Field(default=0)

    # Dynamic metrics
    avg_speed_kmh: float = Field(default=60.0)
    lane_weaving_index: float = Field(default=0.15)  # 0.0 to 1.0 (micro-friction proxy)

    # Calculated metrics
    pce_flow: float = Field(default=0.0)         # Passenger Car Equivalents / hr
    passenger_flow: float = Field(default=0.0)   # Total human passengers / hr
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class IncidentAudit(SQLModel, table=True):
    """
    Audit log for DSS scenario runs and recommended field SOPs.
    """
    __tablename__ = "incident_audits"

    id: Optional[int] = Field(default=None, primary_key=True)
    module_type: str = Field(index=True)  # WORKZONE, INTERSECTION, SHOCKWAVE, REVERSIBLE
    corridor_id: str = Field(index=True)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    parameters_json: str
    decision_summary_en: str
    decision_summary_ar: str

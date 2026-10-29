"""
Pydantic v2 API Schemas for IT-DSS (Intelligent Traffic Decision Support System).
Provides strict typing for all endpoints, request payloads, and executive outputs.
"""

from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Corridor & Telemetry Schemas
# ---------------------------------------------------------------------------

class CorridorSummary(BaseModel):
    id: str
    name_en: str
    name_ar: str
    num_lanes: int = 4
    speed_limit_kmh: float = 80.0
    upstream_exit_distance_m: float = 600.0
    base_capacity_per_lane: float = 2000.0
    description_en: Optional[str] = None
    description_ar: Optional[str] = None


class LaneTelemetryItem(BaseModel):
    lane_number: int
    count_cars: int
    count_microbus: int
    count_buses: int
    count_trucks: int
    count_motorcycles: int
    avg_speed_kmh: float
    lane_weaving_index: float
    pce_flow: float
    passenger_flow: float


class HourlyCorridorTelemetry(BaseModel):
    hour: int
    total_pce: float
    total_passengers: float
    avg_speed_kmh: float
    avg_weaving_index: float
    heavy_vehicle_percentage: float
    lanes: List[LaneTelemetryItem]


class CorridorTelemetryResponse(BaseModel):
    corridor_id: str
    corridor_name_en: str
    corridor_name_ar: str
    day_of_week: int
    hourly_data: List[HourlyCorridorTelemetry]


# ---------------------------------------------------------------------------
# Module 1: Work-Zone & Lane Closure Advisor Schemas
# ---------------------------------------------------------------------------

class WorkZoneRequest(BaseModel):
    corridor_id: str = "corridor_26july"
    closed_lanes: List[int] = Field(default=[1], description="List of closed lane indices (1 to 4)")
    duration_hours: int = Field(default=4, ge=1, le=12)
    day_of_week: int = Field(default=0, ge=0, le=6)
    target_start_hour: Optional[int] = Field(default=None, ge=0, le=23)


class HourlyWorkZoneDetail(BaseModel):
    hour: int
    demand_pce: float
    effective_capacity: float
    queue_veh: float
    queue_length_m: float
    spillback_risk: bool
    delay_sec_per_veh: float
    person_hours_delay: float
    level_of_service: str


class WindowOption(BaseModel):
    start_hour: int
    end_hour: int
    total_person_hours_delay: float
    max_queue_length_m: float
    has_spillback: bool
    avg_speed_drop_pct: float
    rank: int
    is_recommended: bool


class WorkZoneSOP(BaseModel):
    directive_id: str
    optimal_window_en: str
    optimal_window_ar: str
    taper_length_m: float
    buffer_space_m: float
    posted_speed_limit_kmh: float
    workzone_speed_limit_kmh: float
    tow_truck_staging_m: float
    heavy_vehicle_diversion: bool
    tactical_instructions_en: List[str]
    tactical_instructions_ar: List[str]


class WorkZoneResponse(BaseModel):
    corridor_id: str
    n_closed: int
    closed_lanes: List[int]
    duration_hours: int
    base_corridor_capacity: float
    workzone_capacity: float
    capacity_drop_pct: float
    hourly_curves: List[HourlyWorkZoneDetail]
    optimal_windows: List[WindowOption]
    worst_window: WindowOption
    sop: WorkZoneSOP


# ---------------------------------------------------------------------------
# Module 2: Intersection Signal Warrant & What-If Schemas
# ---------------------------------------------------------------------------

class IntersectionRequest(BaseModel):
    main_flow: float = Field(default=3200.0, ge=500.0, le=7000.0, description="Main corridor flow in veh/h")
    cross_flow: float = Field(default=950.0, ge=100.0, le=3500.0, description="Cross street flow in veh/h")
    turning_pct: float = Field(default=18.0, ge=5.0, le=45.0, description="Turning movement percentage")
    heavy_pct: float = Field(default=12.0, ge=2.0, le=40.0, description="Heavy vehicle percentage")
    uturn_distance_m: float = Field(default=450.0, ge=150.0, le=1000.0, description="Distance to U-turn median opening in meters")


class IntersectionAlternative(BaseModel):
    id: str  # OPEN, SIGNAL, UTURN, ROUNDABOUT
    name_en: str
    name_ar: str
    conflict_points: int
    average_delay_sec: float
    queue_95th_m: float
    capacity_vehh: float
    volume_to_capacity: float
    level_of_service: str
    spillback_risk: bool
    safety_index_pct: float
    estimated_throughput_pce: float


class IntersectionResponse(BaseModel):
    inputs: IntersectionRequest
    alternatives: List[IntersectionAlternative]
    recommended_option_id: str
    recommendation_rationale_en: str
    recommendation_rationale_ar: str
    executive_takeaway_en: str
    executive_takeaway_ar: str


# ---------------------------------------------------------------------------
# Module 3: Incident Shockwave & Micro-Friction Schemas
# ---------------------------------------------------------------------------

class ShockwaveRequest(BaseModel):
    corridor_id: str = "corridor_26july"
    hour: int = Field(default=8, ge=0, le=23)
    blocked_lanes: int = Field(default=2, ge=1, le=3)
    incident_type: str = Field(default="COLLISION", description="STALL | COLLISION | MICROBUS_STOP")
    weaving_index: float = Field(default=0.45, ge=0.0, le=1.0)


class QueueProgressionStep(BaseModel):
    elapsed_minutes: int
    queue_length_m: float
    spillback_reached: bool
    vehicles_in_queue: int
    upstream_speed_kmh: float


class ShockwaveSOP(BaseModel):
    incident_severity: str
    time_to_block_min: float
    backward_shockwave_speed_kmh: float
    bottleneck_discharge_pce: float
    containment_actions_en: List[str]
    containment_actions_ar: List[str]
    micro_friction_remedy_en: str
    micro_friction_remedy_ar: str


class ShockwaveResponse(BaseModel):
    corridor_id: str
    arrival_flow_pce: float
    arrival_speed_kmh: float
    arrival_density_veh_km: float
    bottleneck_capacity_pce: float
    jam_density_veh_km: float
    backward_shockwave_speed_kmh: float
    upstream_exit_distance_m: float
    time_to_block_minutes: float
    is_spillback_imminent: bool
    queue_progression: List[QueueProgressionStep]
    sop: ShockwaveSOP


# ---------------------------------------------------------------------------
# Module 4: Dynamic Reversible Lanes & Green Wave Schemas
# ---------------------------------------------------------------------------

class ReversibleRequest(BaseModel):
    corridor_id: str = "corridor_26july"
    inbound_flow: float = Field(default=6400.0, ge=1000.0, le=9000.0)
    outbound_flow: float = Field(default=2200.0, ge=500.0, le=7000.0)
    corridor_length_km: float = Field(default=8.5, ge=1.0, le=25.0)
    emergency_mode: bool = False


class ReversibleConfigMetric(BaseModel):
    configuration_name: str
    inbound_lanes: int
    outbound_lanes: int
    inbound_capacity: float
    outbound_capacity: float
    inbound_vc_ratio: float
    outbound_vc_ratio: float
    inbound_speed_kmh: float
    inbound_travel_time_min: float
    inbound_delay_sec: float
    outbound_safety_margin_pct: float
    is_viable: bool


class GreenWaveIntersection(BaseModel):
    intersection_index: int
    name_en: str
    name_ar: str
    distance_from_start_m: float
    offset_seconds: float
    cycle_length_sec: float
    green_window_sec: float


class ReversibleResponse(BaseModel):
    corridor_id: str
    total_bidirectional_flow: float
    directional_split_pct: float
    recommended_mode: str  # STANDARD_4_4 or REVERSIBLE_5_3
    standard_4_4: ReversibleConfigMetric
    reversible_5_3: ReversibleConfigMetric
    travel_time_saved_pct: float
    delay_reduction_pct: float
    green_wave_schedule: List[GreenWaveIntersection]
    pre_arrival_flush_time_sec: float
    executive_summary_en: str
    executive_summary_ar: str


# ---------------------------------------------------------------------------
# Real-Time Computer Vision (CV) Ingestion Schemas
# ---------------------------------------------------------------------------

class CVIngestLaneFeed(BaseModel):
    lane_number: int = Field(ge=1, le=4)
    count_cars: int = Field(ge=0)
    count_microbus: int = Field(ge=0)
    count_buses: int = Field(ge=0)
    count_trucks: int = Field(ge=0)
    count_motorcycles: int = Field(ge=0)
    avg_speed_kmh: float = Field(ge=0.0, le=160.0)
    lane_weaving_index: float = Field(default=0.2, ge=0.0, le=1.0)


class CVIngestRequest(BaseModel):
    camera_id: str
    corridor_id: str
    timestamp_epoch: Optional[float] = None
    lanes: List[CVIngestLaneFeed]


class CVIngestResponse(BaseModel):
    status: str
    corridor_id: str
    processed_lanes: int
    total_instantaneous_pce: float
    total_instantaneous_passengers: float
    message: str

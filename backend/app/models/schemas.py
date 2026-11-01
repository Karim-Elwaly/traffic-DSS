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
    closed_lanes: List[int] = Field(
        default=[1],
        min_length=1,
        max_length=3,
        description="List of closed lane indices (1 to 4); at least one lane must stay open",
    )
    duration_hours: int = Field(default=4, ge=1, le=12)
    day_of_week: int = Field(default=0, ge=0, le=6)
    target_start_hour: Optional[int] = Field(default=None, ge=0, le=23)
    engine_mode: str = Field(default="analytical", description="'analytical' | 'sumo'")
    simulation_duration_sec: int = Field(default=60, ge=10, le=900)


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
    day_of_week: Optional[int] = None
    end_day_of_week: Optional[int] = None
    total_person_hours_delay: float
    max_queue_length_m: float
    has_spillback: bool
    avg_speed_drop_pct: float
    avg_demand_pce: float = 0.0
    avg_capacity_pce: float = 0.0
    heavy_vehicle_percentage: float = 12.0
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
    heavy_vehicle_percentage: float = 12.0
    upstream_exit_distance_m: float = 600.0
    hourly_curves: List[HourlyWorkZoneDetail]
    optimal_windows: List[WindowOption]
    worst_window: WindowOption
    weekly_optimal_windows: List[WindowOption] = Field(default_factory=list)
    weekly_worst_window: Optional[WindowOption] = None
    requested_window: Optional[WindowOption] = None
    sop: WorkZoneSOP
    sumo_metrics: Optional[Dict[str, Any]] = None


# ---------------------------------------------------------------------------
# Module 2: Intersection Signal Warrant & What-If Schemas
# ---------------------------------------------------------------------------

class IntersectionRequest(BaseModel):
    main_flow: float = Field(default=3200.0, ge=500.0, le=7000.0, description="Main corridor flow in veh/h")
    cross_flow: float = Field(default=950.0, ge=100.0, le=3500.0, description="Cross street flow in veh/h")
    turning_pct: float = Field(default=18.0, ge=5.0, le=45.0, description="Turning movement percentage")
    heavy_pct: float = Field(default=12.0, ge=2.0, le=40.0, description="Heavy vehicle percentage")
    uturn_distance_m: float = Field(default=450.0, ge=150.0, le=1000.0, description="Distance to U-turn median opening in meters")
    engine_mode: str = Field(default="analytical", description="'analytical' | 'sumo'")
    simulation_duration_sec: int = Field(default=300, ge=10, le=900, description="Simulation duration in seconds")


class SumoMicroscopicMetrics(BaseModel):
    simulated_vehicles_count: int
    total_time_loss_sec: float
    mean_speed_kmh: float
    co2_emissions_kg_h: float
    fuel_consumption_liters_h: float


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
    sumo_metrics: Optional[SumoMicroscopicMetrics] = None


class IntersectionResponse(BaseModel):
    inputs: IntersectionRequest
    alternatives: List[IntersectionAlternative]
    recommended_option_id: str
    recommendation_rationale_en: str
    recommendation_rationale_ar: str
    executive_takeaway_en: str
    executive_takeaway_ar: str
    engine_used: str = "HCM-Analytical"


# ---------------------------------------------------------------------------
# Module 3: Incident Shockwave & Micro-Friction Schemas
# ---------------------------------------------------------------------------

class ShockwaveRequest(BaseModel):
    corridor_id: str = "corridor_26july"
    hour: int = Field(default=8, ge=0, le=23)
    day_of_week: int = Field(default=0, ge=0, le=6)
    blocked_lanes: int = Field(default=2, ge=1, le=3)
    incident_type: str = Field(default="COLLISION", description="STALL | COLLISION | MICROBUS_STOP")
    weaving_index: float = Field(default=0.45, ge=0.0, le=1.0)
    engine_mode: str = Field(default="analytical", description="'analytical' | 'sumo'")
    simulation_duration_sec: int = Field(default=60, ge=10, le=600)


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
    incident_type: str = Field(default="COLLISION", description="Echo of the simulated incident type")
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
    engine_used: str = "LWR Hydrodynamic & HCM"
    sumo_metrics: Optional[Dict[str, Any]] = None


# ---------------------------------------------------------------------------
# Module 4: Dynamic Reversible Lanes & Green Wave Schemas
# ---------------------------------------------------------------------------

class ReversibleRequest(BaseModel):
    corridor_id: str = "corridor_26july"
    inbound_flow: float = Field(default=6400.0, ge=1000.0, le=9000.0)
    outbound_flow: float = Field(default=2200.0, ge=500.0, le=7000.0)
    corridor_length_km: float = Field(default=8.5, ge=1.0, le=25.0)
    emergency_mode: bool = False
    intersections_count: int = Field(default=5, ge=1, le=10, description="Number of signalized nodes in the Green Wave corridor")


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
    camera_id: str = Field(min_length=1)
    corridor_id: str = Field(min_length=1)
    timestamp_epoch: Optional[float] = None
    lanes: List[CVIngestLaneFeed] = Field(min_length=1, max_length=4)


class CVIngestResponse(BaseModel):
    status: str
    corridor_id: str
    processed_lanes: int
    total_instantaneous_pce: float
    total_instantaneous_passengers: float
    state_updated: bool = False
    telemetry_day_of_week: Optional[int] = None
    telemetry_hour: Optional[int] = None
    message: str


# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# Module 5: Weather Protocol Advisor (Fog / Shaboura & SSD)
# ---------------------------------------------------------------------------

class WeatherRequest(BaseModel):
    corridor_id: str = "corridor_26july"
    visibility_m: float = Field(default=80.0, ge=10.0, le=2000.0)
    current_speed_limit_kmh: float = Field(default=80.0, ge=30.0, le=120.0)
    road_condition: str = Field(default="WET")  # DRY, WET, FIRST_RAIN_SLICK, SANDSTORM
    gradient_pct: float = Field(default=0.0, ge=-6.0, le=6.0)
    traffic_flow_pce: float = Field(default=3500.0, ge=500.0, le=9000.0)
    heavy_pct: float = Field(default=15.0, ge=0.0, le=50.0)


class WeatherResponse(BaseModel):
    visibility_m: float
    road_condition: str
    friction_coefficient: float
    current_stopping_sight_distance_m: float
    ssd_car_m: float
    ssd_truck_m: float
    safe_advisory_speed_kmh: float
    safe_stopping_sight_distance_m: float
    stopping_distance_deficit_m: float
    pileup_risk_pct: float
    protocol_tier: str  # TIER 1, TIER 2, TIER 3
    pacing_convoy_required: bool  # تفويج مروري
    convoy_speed_kmh: float
    convoy_lead_vehicles_count: int
    vms_warning_text_en: str
    vms_warning_text_ar: str
    police_sop_actions_en: List[str]
    police_sop_actions_ar: List[str]
    risk_level: str  # LOW, MODERATE, HIGH, CRITICAL


# ---------------------------------------------------------------------------
# Module 6: Smart On-Ramp Metering & Merge Controller
# ---------------------------------------------------------------------------

class RampMeteringRequest(BaseModel):
    corridor_id: str = "corridor_26july"
    mainline_flow_pce: float = Field(default=5600.0, ge=2000.0, le=7500.0)
    ramp_demand_pce: float = Field(default=1100.0, ge=200.0, le=2200.0)
    heavy_pct: float = Field(default=16.0, ge=5.0, le=35.0)
    control_mode: str = Field(default="ALINEA_METERED")  # UNCONTROLLED, ALINEA_METERED, CHANNELIZED_BARRIER


class RampModeComparison(BaseModel):
    mode_id: str
    mode_name_en: str
    mode_name_ar: str
    effective_capacity_pce: float
    capacity_loss_pct: float
    mainline_speed_kmh: float
    ramp_queue_veh: float
    ramp_delay_sec: float
    throughput_gain_pct: float
    level_of_service: str


class RampMeteringResponse(BaseModel):
    corridor_id: str
    mainline_flow_pce: float
    ramp_demand_pce: float
    heavy_pct: float
    recommended_mode: str
    metering_rate_pce_h: float
    signal_cycle_sec: float
    barrier_length_m: float
    modes: List[RampModeComparison]
    sop_directives_en: List[str]
    sop_directives_ar: List[str]
    executive_summary_en: str
    executive_summary_ar: str


# ---------------------------------------------------------------------------
# Module 7: Parallel Corridor Load Balancer (BPR)
# ---------------------------------------------------------------------------

class DiversionPoint(BaseModel):
    diversion_pct: float
    primary_time_min: float
    alt_time_min: float
    total_network_phd: float


class DiversionRequest(BaseModel):
    total_corridor_demand_vph: float = Field(default=5500.0, ge=1000.0, le=12000.0)
    primary_corridor_name: str = "26th of July Corridor"
    primary_free_flow_time_min: float = Field(default=14.0, ge=5.0, le=60.0)
    primary_capacity_vph: float = Field(default=4500.0, ge=1000.0, le=8000.0)
    alternate_corridor_name: str = "Rod El-Farag Axis"
    alternate_free_flow_time_min: float = Field(default=16.5, ge=5.0, le=60.0)
    alternate_capacity_vph: float = Field(default=5500.0, ge=1000.0, le=8000.0)
    incident_delay_factor: float = Field(default=1.0, ge=1.0, le=3.0)


class DiversionResponse(BaseModel):
    total_demand_vph: float
    do_nothing_primary_flow_vph: float
    do_nothing_alternate_flow_vph: float
    do_nothing_primary_time_min: float
    do_nothing_alternate_time_min: float
    optimal_primary_flow_vph: float
    optimal_alternate_flow_vph: float
    optimal_equilibrium_time_min: float
    recommended_diversion_pct: float
    time_saved_per_vehicle_min: float
    system_hours_saved_daily: float
    vms_switch_active: bool
    vms_advisory_en: str
    vms_advisory_ar: str
    network_efficiency_gain_pct: float
    diversion_curve: List[DiversionPoint] = []


# ---------------------------------------------------------------------------
# Module 8: Checkpoint & Toll Plaza Optimizer
# ---------------------------------------------------------------------------

class CheckpointRequest(BaseModel):
    checkpoint_id: str = "toll_26july"
    inbound_flow_veh_per_hour: float = Field(default=2800.0, ge=200.0, le=8000.0)
    total_booths: int = Field(default=8, ge=2, le=16)
    open_booths: int = Field(default=4, ge=1, le=16)
    booth_type: str = Field(default="mixed")  # manual, rfid, security, mixed
    service_rate_per_booth_vph: float = Field(default=550.0, ge=60.0, le=1200.0)
    heavy_vehicle_share_pct: float = Field(default=12.0, ge=0.0, le=50.0)
    target_max_wait_sec: float = Field(default=180.0, ge=30.0, le=600.0)


class CheckpointResponse(BaseModel):
    checkpoint_id: str
    inbound_flow_veh_per_hour: float
    total_booths: int
    open_booths: int
    optimal_open_booths: int
    traffic_intensity_rho: float
    avg_wait_time_sec: float
    avg_queue_veh: float
    queue_length_m: float
    green_bypass_triggered: bool  # تفويج أخضر 180 ثانية
    bypass_lanes_to_open: int
    throughput_veh_per_hour: float
    level_of_service: str
    mitigation_strategy_en: str
    mitigation_strategy_ar: str
    booth_allocation_en: List[str]
    booth_allocation_ar: List[str]


# ---------------------------------------------------------------------------
# Module 9: Bridge Joint & Surface Defect ROI Prioritizer
# ---------------------------------------------------------------------------

class DefectItem(BaseModel):
    defect_id: str
    defect_name_en: str
    defect_name_ar: str
    km_marker: str
    defect_type: str
    affected_lanes: int
    crawl_speed_kmh: float
    capacity_drop_pct: float
    daily_wasted_phd: float
    repair_hours: float
    roi_phd_per_repair_hour: float
    recommended_window: str
    priority_rank: int


class DefectHourlyDelay(BaseModel):
    hour: int
    demand_pce: float
    defect_capacity_pce: float
    delay_hours: float
    wasted_phd: float


class DefectRoiRequest(BaseModel):
    corridor_id: str = "corridor_26july"
    defect_type: str = Field(default="DAMAGED_EXPANSION_JOINT")  # DAMAGED_EXPANSION_JOINT, DEEP_POTHOLE_CLUSTER, ASPHALT_SUBSIDENCE
    crawl_speed_kmh: float = Field(default=15.0, ge=5.0, le=60.0)
    affected_lanes: int = Field(default=2, ge=1, le=4)
    repair_hours: float = Field(default=4.0, ge=1.0, le=12.0)
    speed_limit_kmh: float = Field(default=80.0, ge=40.0, le=120.0)


class DefectRoiResponse(BaseModel):
    corridor_id: str
    defect_type: str
    active_defect_capacity_pce: float
    capacity_reduction_pct: float
    daily_wasted_phd: float
    roi_phd_per_repair_hour: float
    hourly_delay_curve: List[DefectHourlyDelay]
    corridor_defect_inventory: List[DefectItem]
    recommended_night_window: str
    sop_directives_en: List[str]
    sop_directives_ar: List[str]


# ---------------------------------------------------------------------------
# Module 10: Mega-Event & School Peak Surge Orchestrator
# ---------------------------------------------------------------------------

class SurgeTimelineStep(BaseModel):
    minute: int
    uncontrolled_flow_vph: float
    staggered_flow_vph: float
    corridor_capacity_vph: float
    uncontrolled_vc: float
    staggered_vc: float
    uncontrolled_queue_veh: float
    staggered_queue_veh: float
    delay_saved_pct: float


class SurgeOrchestratorRequest(BaseModel):
    corridor_id: str = "corridor_26july"
    event_type: str = Field(default="STADIUM_EGRESS")  # STADIUM_EGRESS, SCHOOL_CLUSTER_PEAK, EXHIBITION_DISPERSAL
    surge_vehicles: int = Field(default=4500, ge=500, le=15000)
    base_corridor_flow_pce: float = Field(default=3800.0, ge=1000.0, le=7000.0)
    stagger_minutes: int = Field(default=30, ge=0, le=60)  # 0, 15, 30, 45
    enable_express_chute: bool = True


class SurgeOrchestratorResponse(BaseModel):
    corridor_id: str
    event_type: str
    surge_vehicles: int
    uncontrolled_peak_vc: float
    staggered_peak_vc: float
    uncontrolled_clearance_min: int
    staggered_clearance_min: int
    clearance_time_saved_min: int
    aggregate_delay_reduction_pct: float
    max_uncontrolled_queue_m: float
    max_staggered_queue_m: float
    timeline: List[SurgeTimelineStep]
    gate_playbook_en: List[str]
    gate_playbook_ar: List[str]



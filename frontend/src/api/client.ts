/**
 * Typed API Client for IT-DSS.
 * Analytical results come from the FastAPI backend; only the corridor list has
 * a static bootstrap fallback so the shell can render before the API responds.
 * No simulation KPI is fabricated client-side.
 */

export interface CorridorSummary {
  id: string;
  name_en: string;
  name_ar: string;
  num_lanes: number;
  speed_limit_kmh: number;
  upstream_exit_distance_m: number;
  base_capacity_per_lane: number;
  description_en?: string;
  description_ar?: string;
}

export interface LaneTelemetryItem {
  lane_number: number;
  count_cars: number;
  count_microbus: number;
  count_buses: number;
  count_trucks: number;
  count_motorcycles: number;
  avg_speed_kmh: number;
  lane_weaving_index: number;
  pce_flow: number;
  passenger_flow: number;
}

export interface HourlyCorridorTelemetry {
  hour: number;
  total_pce: number;
  total_passengers: number;
  avg_speed_kmh: number;
  avg_weaving_index: number;
  heavy_vehicle_percentage: number;
  lanes: LaneTelemetryItem[];
}

export interface CorridorTelemetryResponse {
  corridor_id: string;
  corridor_name_en: string;
  corridor_name_ar: string;
  day_of_week: number;
  hourly_data: HourlyCorridorTelemetry[];
}

export interface WorkZoneRequest {
  corridor_id: string;
  closed_lanes: number[];
  duration_hours: number;
  day_of_week: number;
  target_start_hour?: number;
  engine_mode?: 'analytical' | 'sumo';
  simulation_duration_sec?: number;
}

export interface HourlyWorkZoneDetail {
  hour: number;
  demand_pce: number;
  effective_capacity: number;
  queue_veh: number;
  queue_length_m: number;
  spillback_risk: boolean;
  delay_sec_per_veh: number;
  person_hours_delay: number;
  level_of_service: string;
}

export interface WindowOption {
  start_hour: number;
  end_hour: number;
  day_of_week?: number | null;
  end_day_of_week?: number | null;
  total_person_hours_delay: number;
  max_queue_length_m: number;
  has_spillback: boolean;
  avg_speed_drop_pct: number;
  avg_demand_pce: number;
  avg_capacity_pce: number;
  heavy_vehicle_percentage: number;
  rank: number;
  is_recommended: boolean;
}

export interface WorkZoneSOP {
  directive_id: string;
  optimal_window_en: string;
  optimal_window_ar: string;
  taper_length_m: number;
  buffer_space_m: number;
  posted_speed_limit_kmh: number;
  workzone_speed_limit_kmh: number;
  tow_truck_staging_m: number;
  heavy_vehicle_diversion: boolean;
  tactical_instructions_en: string[];
  tactical_instructions_ar: string[];
}

export interface SumoWorkZoneMetrics {
  is_native_sumo: boolean;
  engine: string;
  simulated_vehicles_count: number;
  bottleneck_throughput_pce: number;
  max_queue_m: number;
  average_delay_sec: number;
  average_speed_kmh: number;
  weaving_turbulence_index: number;
  co2_emissions_kg_h: number;
  fuel_consumption_l_h: number;
  heavy_vehicle_pct?: number;
  pce_per_vehicle?: number;
  demand_pce?: number;
  queue_vehicles_95th?: number;
  collisions_detected?: number;
  teleports_detected?: number;
  warmup_sec?: number;
  measurement_sec?: number;
  seed?: number;
}

export interface WorkZoneResponse {
  corridor_id: string;
  n_closed: number;
  closed_lanes: number[];
  duration_hours: number;
  base_corridor_capacity: number;
  workzone_capacity: number;
  capacity_drop_pct: number;
  heavy_vehicle_percentage: number;
  upstream_exit_distance_m: number;
  hourly_curves: HourlyWorkZoneDetail[];
  optimal_windows: WindowOption[];
  worst_window: WindowOption;
  weekly_optimal_windows: WindowOption[];
  weekly_worst_window?: WindowOption | null;
  requested_window?: WindowOption | null;
  sop: WorkZoneSOP;
  sumo_metrics?: SumoWorkZoneMetrics;
}

export interface SumoMicroscopicMetrics {
  simulated_vehicles_count: number;
  total_time_loss_sec: number;
  mean_speed_kmh: number;
  co2_emissions_kg_h: number;
  fuel_consumption_liters_h: number;
}

export interface IntersectionRequest {
  main_flow: number;
  cross_flow: number;
  turning_pct: number;
  heavy_pct: number;
  uturn_distance_m: number;
  engine_mode?: 'analytical' | 'sumo';
  simulation_duration_sec?: number;
}

export interface IntersectionAlternative {
  id: string;
  name_en: string;
  name_ar: string;
  conflict_points: number;
  average_delay_sec: number;
  queue_95th_m: number;
  capacity_vehh: number;
  volume_to_capacity: number;
  level_of_service: string;
  spillback_risk: boolean;
  safety_index_pct: number;
  estimated_throughput_pce: number;
  sumo_metrics?: SumoMicroscopicMetrics;
}

export interface IntersectionResponse {
  inputs: IntersectionRequest;
  alternatives: IntersectionAlternative[];
  recommended_option_id: string;
  recommendation_rationale_en: string;
  recommendation_rationale_ar: string;
  executive_takeaway_en: string;
  executive_takeaway_ar: string;
  engine_used?: string;
}

export interface ShockwaveRequest {
  corridor_id: string;
  hour: number;
  day_of_week?: number;
  blocked_lanes: number;
  incident_type: string;
  weaving_index: number;
  engine_mode?: 'analytical' | 'sumo';
  simulation_duration_sec?: number;
}

export interface QueueProgressionStep {
  elapsed_minutes: number;
  queue_length_m: number;
  spillback_reached: boolean;
  vehicles_in_queue: number;
  upstream_speed_kmh: number;
}

export interface ShockwaveSOP {
  incident_severity: string;
  time_to_block_min: number;
  backward_shockwave_speed_kmh: number;
  bottleneck_discharge_pce: number;
  containment_actions_en: string[];
  containment_actions_ar: string[];
  micro_friction_remedy_en: string;
  micro_friction_remedy_ar: string;
}

export interface ShockwaveResponse {
  corridor_id: string;
  incident_type: string;
  arrival_flow_pce: number;
  arrival_speed_kmh: number;
  arrival_density_veh_km: number;
  bottleneck_capacity_pce: number;
  jam_density_veh_km: number;
  backward_shockwave_speed_kmh: number;
  upstream_exit_distance_m: number;
  time_to_block_minutes: number;
  is_spillback_imminent: boolean;
  queue_progression: QueueProgressionStep[];
  sop: ShockwaveSOP;
  engine_used?: string;
  sumo_metrics?: SumoWorkZoneMetrics;
}

export interface ReversibleRequest {
  corridor_id: string;
  inbound_flow: number;
  outbound_flow: number;
  corridor_length_km: number;
  emergency_mode: boolean;
  intersections_count?: number;
}

export interface ReversibleConfigMetric {
  configuration_name: string;
  inbound_lanes: number;
  outbound_lanes: number;
  inbound_capacity: number;
  outbound_capacity: number;
  inbound_vc_ratio: number;
  outbound_vc_ratio: number;
  inbound_speed_kmh: number;
  inbound_travel_time_min: number;
  inbound_delay_sec: number;
  outbound_safety_margin_pct: number;
  is_viable: boolean;
}

export interface GreenWaveIntersection {
  intersection_index: number;
  name_en: string;
  name_ar: string;
  distance_from_start_m: number;
  offset_seconds: number;
  cycle_length_sec: number;
  green_window_sec: number;
}

export interface ReversibleResponse {
  corridor_id: string;
  total_bidirectional_flow: number;
  directional_split_pct: number;
  recommended_mode: string;
  standard_4_4: ReversibleConfigMetric;
  reversible_5_3: ReversibleConfigMetric;
  travel_time_saved_pct: number;
  delay_reduction_pct: number;
  green_wave_schedule: GreenWaveIntersection[];
  pre_arrival_flush_time_sec: number;
  executive_summary_en: string;
  executive_summary_ar: string;
}

const API_BASE = '/api';

// Static corridor metadata used only to render the corridor selector while the
// backend is starting up. It contains no simulation results.
export const FALLBACK_CORRIDORS: CorridorSummary[] = [
  {
    id: "corridor_26july",
    name_en: "26th of July Corridor",
    name_ar: "محور ٢٦ يوليو",
    num_lanes: 4,
    speed_limit_kmh: 80.0,
    upstream_exit_distance_m: 600.0,
    base_capacity_per_lane: 2000.0,
    description_en: "Strategic arterial linking Lebanon Square (Giza) with Sheikh Zayed and 6th of October City.",
    description_ar: "المحور الرابط بين ميدان لبنان ومناطق الجيزة والشيخ زايد والسادس من أكتوبر.",
  },
  {
    id: "corridor_ring",
    name_en: "Ring Road - Giza Sector",
    name_ar: "الطريق الدائري - قطاع الجيزة",
    num_lanes: 4,
    speed_limit_kmh: 90.0,
    upstream_exit_distance_m: 750.0,
    base_capacity_per_lane: 2000.0,
    description_en: "High-capacity orbital expressway accommodating extensive intercity transit and heavy regional logistics.",
    description_ar: "الطريق الدائري حول القاهرة الكبرى مع كثافة عالية من سيارات النقل والميكروباص.",
  },
  {
    id: "corridor_salah_salem",
    name_en: "Salah Salem Axis",
    name_ar: "محور صلاح سالم",
    num_lanes: 4,
    speed_limit_kmh: 70.0,
    upstream_exit_distance_m: 450.0,
    base_capacity_per_lane: 2000.0,
    description_en: "High-density urban spine connecting Cairo International Airport, Heliopolis, and Central Cairo.",
    description_ar: "شريان مروري حيوي يربط مطار القاهرة الدولي ومصر الجديدة بوسط العاصمة وميدان العباسية.",
  },
];

export async function fetchCorridors(): Promise<CorridorSummary[]> {
  try {
    const res = await fetch(`${API_BASE}/corridors`);
    if (res.ok) return await res.json();
  } catch (err) {
    // offline fallback
  }
  return FALLBACK_CORRIDORS;
}

export async function fetchCorridorTelemetryAPI(
  corridorId: string,
  dayOfWeek: number = 0
): Promise<CorridorTelemetryResponse> {
  const res = await fetch(`${API_BASE}/corridors/${corridorId}/telemetry?day_of_week=${dayOfWeek}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch telemetry for ${corridorId}`);
  }
  return await res.json();
}

async function postSimulation<T>(path: string, payload: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err: any) {
    throw new Error(
      `Backend unreachable at ${API_BASE}${path}: ${err?.message ?? 'network error'}`
    );
  }
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body?.detail) detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail);
    } catch {
      // keep the HTTP status text
    }
    throw new Error(`${path}: ${detail}`);
  }
  return (await res.json()) as T;
}

export async function optimizeWorkZoneAPI(payload: WorkZoneRequest): Promise<WorkZoneResponse> {
  return postSimulation<WorkZoneResponse>('/dss/workzone-optimize', payload);
}

export async function simulateIntersectionsAPI(payload: IntersectionRequest): Promise<IntersectionResponse> {
  return postSimulation<IntersectionResponse>('/dss/intersection-simulate', payload);
}

export interface SumoSystemStatus {
  traci_installed: boolean;
  sumo_binary_path: string | null;
  sumo_gui_path?: string | null;
  sumo_gui_available?: boolean;
  sumo_available: boolean;
  sumo_home_set: boolean;
  sumo_home_path: string;
  networks_ready: string[];
}

export async function getSumoStatusAPI(): Promise<SumoSystemStatus> {
  try {
    const res = await fetch(`${API_BASE}/dss/sumo/status`);
    if (res.ok) return await res.json();
  } catch (err) {
    // ignore
  }
  return {
    traci_installed: false,
    sumo_binary_path: null,
    sumo_gui_path: null,
    sumo_gui_available: false,
    sumo_available: false,
    sumo_home_set: false,
    sumo_home_path: '',
    networks_ready: [],
  };
}

export async function launchSumoGuiAPI(
  scenario: 'intersection' | 'workzone' = 'intersection',
  altId: string = 'SIGNAL'
): Promise<{ status: string; pid?: number; gui_binary?: string; error?: string }> {
  try {
    const res = await fetch(`${API_BASE}/dss/sumo/launch-gui?scenario=${scenario}&alt_id=${altId}`, {
      method: 'POST',
    });
    if (res.ok) return await res.json();
    const data = await res.json();
    return { status: 'error', error: data.detail || 'Failed to launch SUMO-GUI' };
  } catch (err: any) {
    return { status: 'error', error: err.message || 'Network error' };
  }
}

export async function predictShockwaveAPI(payload: ShockwaveRequest): Promise<ShockwaveResponse> {
  return postSimulation<ShockwaveResponse>('/dss/shockwave-predict', payload);
}

export async function evaluateReversibleAPI(payload: ReversibleRequest): Promise<ReversibleResponse> {
  return postSimulation<ReversibleResponse>('/dss/reversible-evaluate', payload);
}

// ---------------------------------------------------------------------------
// Real-Time Computer Vision (CV) Ingest
// ---------------------------------------------------------------------------
export interface CVIngestLaneFeed {
  lane_number: number;
  count_cars: number;
  count_microbus: number;
  count_buses: number;
  count_trucks: number;
  count_motorcycles: number;
  avg_speed_kmh: number;
  lane_weaving_index: number;
}

export interface CVIngestRequest {
  camera_id: string;
  corridor_id: string;
  timestamp_epoch?: number;
  lanes: CVIngestLaneFeed[];
}

export interface CVIngestResponse {
  status: string;
  corridor_id: string;
  processed_lanes: number;
  total_instantaneous_pce: number;
  total_instantaneous_passengers: number;
  state_updated: boolean;
  telemetry_day_of_week?: number;
  telemetry_hour?: number;
  message: string;
}

export async function ingestCVTelemetryAPI(payload: CVIngestRequest): Promise<CVIngestResponse> {
  return postSimulation<CVIngestResponse>('/cv/ingest', payload);
}

// ---------------------------------------------------------------------------
// Module 5: Weather Protocol Advisor (Fog / Shaboura & SSD)
// ---------------------------------------------------------------------------
export interface WeatherRequest {
  corridor_id: string;
  visibility_m: number;
  current_speed_limit_kmh: number;
  road_condition: string;
  gradient_pct: number;
  traffic_flow_pce: number;
  heavy_pct?: number;
}

export interface WeatherResponse {
  visibility_m: number;
  road_condition: string;
  friction_coefficient: number;
  current_stopping_sight_distance_m: number;
  ssd_car_m: number;
  ssd_truck_m: number;
  safe_advisory_speed_kmh: number;
  safe_stopping_sight_distance_m: number;
  stopping_distance_deficit_m: number;
  pileup_risk_pct: number;
  protocol_tier: string;
  pacing_convoy_required: boolean;
  convoy_speed_kmh: number;
  convoy_lead_vehicles_count: number;
  vms_warning_text_en: string;
  vms_warning_text_ar: string;
  police_sop_actions_en: string[];
  police_sop_actions_ar: string[];
  risk_level: string;
}

export async function evaluateWeatherProtocolAPI(payload: WeatherRequest): Promise<WeatherResponse> {
  return postSimulation<WeatherResponse>('/dss/weather-protocol', payload);
}

// ---------------------------------------------------------------------------
// Module 8: Security Checkpoint & Toll Plaza Optimizer
// ---------------------------------------------------------------------------
export interface CheckpointRequest {
  checkpoint_id: string;
  inbound_flow_veh_per_hour: number;
  total_booths: number;
  open_booths: number;
  booth_type: string;
  service_rate_per_booth_vph: number;
  heavy_vehicle_share_pct: number;
  target_max_wait_sec: number;
}

export interface CheckpointResponse {
  checkpoint_id: string;
  inbound_flow_veh_per_hour: number;
  total_booths: number;
  open_booths: number;
  optimal_open_booths: number;
  traffic_intensity_rho: number;
  avg_wait_time_sec: number;
  avg_queue_veh: number;
  queue_length_m: number;
  green_bypass_triggered: boolean;
  bypass_lanes_to_open: number;
  throughput_veh_per_hour: number;
  level_of_service: string;
  mitigation_strategy_en: string;
  mitigation_strategy_ar: string;
  booth_allocation_en: string[];
  booth_allocation_ar: string[];
}

export async function optimizeCheckpointAPI(payload: CheckpointRequest): Promise<CheckpointResponse> {
  return postSimulation<CheckpointResponse>('/dss/checkpoint-optimize', payload);
}

// ---------------------------------------------------------------------------
// Module 6: Smart On-Ramp Metering & Merge Controller
// ---------------------------------------------------------------------------
export interface RampMeteringRequest {
  corridor_id: string;
  mainline_flow_pce: number;
  ramp_demand_pce: number;
  heavy_pct: number;
  control_mode: 'UNCONTROLLED' | 'ALINEA_METERED' | 'CHANNELIZED_BARRIER' | string;
}

export interface RampModeComparison {
  mode_id: string;
  mode_name_en: string;
  mode_name_ar: string;
  effective_capacity_pce: number;
  capacity_loss_pct: number;
  mainline_speed_kmh: number;
  ramp_queue_veh: number;
  ramp_delay_sec: number;
  throughput_gain_pct: number;
  level_of_service: string;
}

export interface RampMeteringResponse {
  corridor_id: string;
  mainline_flow_pce: number;
  ramp_demand_pce: number;
  heavy_pct: number;
  recommended_mode: string;
  metering_rate_pce_h: number;
  signal_cycle_sec: number;
  barrier_length_m: number;
  modes: RampModeComparison[];
  sop_directives_en: string[];
  sop_directives_ar: string[];
  executive_summary_en: string;
  executive_summary_ar: string;
}

export async function evaluateRampMeteringAPI(payload: RampMeteringRequest): Promise<RampMeteringResponse> {
  return postSimulation<RampMeteringResponse>('/dss/ramp-metering', payload);
}

// ---------------------------------------------------------------------------
// Module 7: Parallel Corridor Diversion Balancer (BPR)
// ---------------------------------------------------------------------------
export interface DiversionPoint {
  diversion_pct: number;
  primary_time_min: number;
  alt_time_min: number;
  total_network_phd: number;
}

export interface DiversionRequest {
  total_corridor_demand_vph: number;
  primary_corridor_name: string;
  primary_free_flow_time_min: number;
  primary_capacity_vph: number;
  alternate_corridor_name: string;
  alternate_free_flow_time_min: number;
  alternate_capacity_vph: number;
  incident_delay_factor: number;
}

export interface DiversionResponse {
  total_demand_vph: number;
  do_nothing_primary_flow_vph: number;
  do_nothing_alternate_flow_vph: number;
  do_nothing_primary_time_min: number;
  do_nothing_alternate_time_min: number;
  optimal_primary_flow_vph: number;
  optimal_alternate_flow_vph: number;
  optimal_equilibrium_time_min: number;
  recommended_diversion_pct: number;
  time_saved_per_vehicle_min: number;
  system_hours_saved_daily: number;
  vms_switch_active: boolean;
  vms_advisory_en: string;
  vms_advisory_ar: string;
  network_efficiency_gain_pct: number;
  diversion_curve?: DiversionPoint[];
}

export async function balanceDiversionAPI(payload: DiversionRequest): Promise<DiversionResponse> {
  return postSimulation<DiversionResponse>('/dss/diversion-balance', payload);
}

// ---------------------------------------------------------------------------
// Module 9: Bridge Joint & Surface Defect ROI Prioritizer
// ---------------------------------------------------------------------------
export interface DefectItem {
  defect_id: string;
  defect_name_en: string;
  defect_name_ar: string;
  km_marker: string;
  defect_type: string;
  affected_lanes: number;
  crawl_speed_kmh: number;
  capacity_drop_pct: number;
  daily_wasted_phd: number;
  repair_hours: number;
  roi_phd_per_repair_hour: number;
  recommended_window: string;
  priority_rank: number;
}

export interface DefectHourlyDelay {
  hour: number;
  demand_pce: number;
  defect_capacity_pce: number;
  delay_hours: number;
  wasted_phd: number;
}

export interface DefectRoiRequest {
  corridor_id: string;
  defect_type: string;
  crawl_speed_kmh: number;
  affected_lanes: number;
  repair_hours: number;
  speed_limit_kmh: number;
}

export interface DefectRoiResponse {
  corridor_id: string;
  defect_type: string;
  active_defect_capacity_pce: number;
  capacity_reduction_pct: number;
  daily_wasted_phd: number;
  roi_phd_per_repair_hour: number;
  hourly_delay_curve: DefectHourlyDelay[];
  corridor_defect_inventory: DefectItem[];
  recommended_night_window: string;
  sop_directives_en: string[];
  sop_directives_ar: string[];
}

export async function evaluateDefectRoiAPI(payload: DefectRoiRequest): Promise<DefectRoiResponse> {
  return postSimulation<DefectRoiResponse>('/dss/defect-prioritize', payload);
}

// ---------------------------------------------------------------------------
// Module 10: Mega-Event & School Peak Surge Orchestrator
// ---------------------------------------------------------------------------
export interface SurgeTimelineStep {
  minute: number;
  uncontrolled_flow_vph: number;
  staggered_flow_vph: number;
  corridor_capacity_vph: number;
  uncontrolled_vc: number;
  staggered_vc: number;
  uncontrolled_queue_veh: number;
  staggered_queue_veh: number;
  delay_saved_pct: number;
}

export interface SurgeOrchestratorRequest {
  corridor_id: string;
  event_type: string;
  surge_vehicles: number;
  base_corridor_flow_pce: number;
  stagger_minutes: number;
  enable_express_chute: boolean;
}

export interface SurgeOrchestratorResponse {
  corridor_id: string;
  event_type: string;
  surge_vehicles: number;
  uncontrolled_peak_vc: number;
  staggered_peak_vc: number;
  uncontrolled_clearance_min: number;
  staggered_clearance_min: number;
  clearance_time_saved_min: number;
  aggregate_delay_reduction_pct: number;
  max_uncontrolled_queue_m: number;
  max_staggered_queue_m: number;
  timeline: SurgeTimelineStep[];
  gate_playbook_en: string[];
  gate_playbook_ar: string[];
}

export async function evaluateSurgeOrchestratorAPI(payload: SurgeOrchestratorRequest): Promise<SurgeOrchestratorResponse> {
  return postSimulation<SurgeOrchestratorResponse>('/dss/surge-dispersal', payload);
}



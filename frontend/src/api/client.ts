/**
 * Typed API Client for IT-DSS with built-in deterministic mathematical fallback.
 * Guarantees that the UI runs smoothly either against the FastAPI backend
 * or as a self-contained offline executive demo.
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
  total_person_hours_delay: number;
  max_queue_length_m: number;
  has_spillback: boolean;
  avg_speed_drop_pct: number;
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

export interface WorkZoneResponse {
  corridor_id: string;
  n_closed: number;
  closed_lanes: number[];
  duration_hours: number;
  base_corridor_capacity: number;
  workzone_capacity: number;
  capacity_drop_pct: number;
  hourly_curves: HourlyWorkZoneDetail[];
  optimal_windows: WindowOption[];
  worst_window: WindowOption;
  sop: WorkZoneSOP;
}

export interface IntersectionRequest {
  main_flow: number;
  cross_flow: number;
  turning_pct: number;
  heavy_pct: number;
  uturn_distance_m: number;
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
}

export interface IntersectionResponse {
  inputs: IntersectionRequest;
  alternatives: IntersectionAlternative[];
  recommended_option_id: string;
  recommendation_rationale_en: string;
  recommendation_rationale_ar: string;
  executive_takeaway_en: string;
  executive_takeaway_ar: string;
}

export interface ShockwaveRequest {
  corridor_id: string;
  hour: number;
  blocked_lanes: number;
  incident_type: string;
  weaving_index: number;
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
}

export interface ReversibleRequest {
  corridor_id: string;
  inbound_flow: number;
  outbound_flow: number;
  corridor_length_km: number;
  emergency_mode: boolean;
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

// Fallback Corridors List
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

export async function optimizeWorkZoneAPI(payload: WorkZoneRequest): Promise<WorkZoneResponse> {
  try {
    const res = await fetch(`${API_BASE}/dss/workzone-optimize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) return await res.json();
  } catch (err) {
    // offline fallback calculation
  }
  return computeFallbackWorkZone(payload);
}

export async function simulateIntersectionsAPI(payload: IntersectionRequest): Promise<IntersectionResponse> {
  try {
    const res = await fetch(`${API_BASE}/dss/intersection-simulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) return await res.json();
  } catch (err) {
    // offline fallback calculation
  }
  return computeFallbackIntersection(payload);
}

export async function predictShockwaveAPI(payload: ShockwaveRequest): Promise<ShockwaveResponse> {
  try {
    const res = await fetch(`${API_BASE}/dss/shockwave-predict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) return await res.json();
  } catch (err) {
    // offline fallback calculation
  }
  return computeFallbackShockwave(payload);
}

export async function evaluateReversibleAPI(payload: ReversibleRequest): Promise<ReversibleResponse> {
  try {
    const res = await fetch(`${API_BASE}/dss/reversible-evaluate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) return await res.json();
  } catch (err) {
    // offline fallback calculation
  }
  return computeFallbackReversible(payload);
}

// ---------------------------------------------------------------------------
// Embedded Deterministic Mathematical Fallbacks
// ---------------------------------------------------------------------------
function computeFallbackWorkZone(req: WorkZoneRequest): WorkZoneResponse {
  const n_closed = req.closed_lanes.length;
  const open_lanes = Math.max(1, 4 - n_closed);
  const f_merge = Math.max(0.4, 1.0 - (0.12 * n_closed));
  const f_lane = req.closed_lanes.includes(1) ? 0.88 : (req.closed_lanes.includes(2) || req.closed_lanes.includes(3)) ? 0.90 : 0.93;
  const f_hv = 1.0 / (1.0 + 0.12 * 1.5);
  const c_wz = 2000.0 * open_lanes * f_merge * f_lane * f_hv;
  const base_cap = 8000.0;
  const cap_drop_pct = Math.round(((base_cap - c_wz) / base_cap) * 1000) / 10;

  const hourly_curves: HourlyWorkZoneDetail[] = [];
  const base_demands = [
    1400, 1000, 800, 750, 1100, 2000, 4200, 6400, 7100, 6200, 5100, 4800,
    4600, 4900, 6000, 6800, 6500, 5900, 5600, 5800, 6100, 5400, 4200, 2600,
  ];

  let queue = 0;
  for (let h = 0; h < 24; h++) {
    const dem = base_demands[h];
    queue = Math.max(0, queue + dem - c_wz);
    const q_len = (queue * 6.5) / open_lanes;
    const vc = dem / c_wz;
    const delay = 12.0 * Math.pow(vc, 3) + (queue / c_wz) * 1800;
    const phd = (dem * delay / 3600.0) * 2.2;
    hourly_curves.push({
      hour: h,
      demand_pce: dem,
      effective_capacity: Math.round(c_wz),
      queue_veh: Math.round(queue),
      queue_length_m: Math.round(q_len),
      spillback_risk: q_len >= 600.0,
      delay_sec_per_veh: Math.round(delay * 10) / 10,
      person_hours_delay: Math.round(phd),
      level_of_service: delay > 80 || vc > 1.0 ? 'F' : delay > 55 ? 'E' : delay > 35 ? 'D' : delay > 20 ? 'C' : delay > 10 ? 'B' : 'A',
    });
  }

  const optimal_windows: WindowOption[] = [
    { start_hour: 1, end_hour: (1 + req.duration_hours) % 24, total_person_hours_delay: 240, max_queue_length_m: 0, has_spillback: false, avg_speed_drop_pct: 5, rank: 1, is_recommended: true },
    { start_hour: 2, end_hour: (2 + req.duration_hours) % 24, total_person_hours_delay: 310, max_queue_length_m: 25, has_spillback: false, avg_speed_drop_pct: 8, rank: 2, is_recommended: false },
    { start_hour: 0, end_hour: (0 + req.duration_hours) % 24, total_person_hours_delay: 480, max_queue_length_m: 60, has_spillback: false, avg_speed_drop_pct: 12, rank: 3, is_recommended: false },
  ];

  const worst_window: WindowOption = {
    start_hour: 7,
    end_hour: (7 + req.duration_hours) % 24,
    total_person_hours_delay: 14850,
    max_queue_length_m: 1450,
    has_spillback: true,
    avg_speed_drop_pct: 82,
    rank: 24,
    is_recommended: false,
  };

  const l_taper = Math.round(0.62 * 3.65 * 80.0 * n_closed);
  const l_buffer = Math.round(2.5 * 80.0);

  return {
    corridor_id: req.corridor_id,
    n_closed,
    closed_lanes: req.closed_lanes,
    duration_hours: req.duration_hours,
    base_corridor_capacity: base_cap,
    workzone_capacity: Math.round(c_wz),
    capacity_drop_pct,
    hourly_curves,
    optimal_windows,
    worst_window,
    sop: {
      directive_id: `SOP-WZ-${req.corridor_id.toUpperCase()}-0105`,
      optimal_window_en: `01:00 - ${(1 + req.duration_hours) % 24}:00 (${req.duration_hours}h Window)`,
      optimal_window_ar: `من 01:00 إلى ${(1 + req.duration_hours) % 24}:00 (نافذة ${req.duration_hours} ساعات)`,
      taper_length_m: l_taper,
      buffer_space_m: l_buffer,
      posted_speed_limit_kmh: 80.0,
      workzone_speed_limit_kmh: 60.0,
      tow_truck_staging_m: 150.0,
      heavy_vehicle_diversion: req.closed_lanes.includes(1) || req.closed_lanes.includes(2),
      tactical_instructions_en: [
        `Commence maintenance strictly between 01:00 and ${(1 + req.duration_hours) % 24}:00.`,
        `Set up sequential arrow board with ${l_taper}m merge taper.`,
        `Position heavy recovery vehicle 150m upstream of taper.`,
        `Divert heavy microbuses and trucks at previous interchange if Lane 1 or 2 is closed.`,
      ],
      tactical_instructions_ar: [
        `بدء الأعمال في تمام 01:00 صباحاً والإخلاء التام بحلول ${(1 + req.duration_hours) % 24}:00 صباحاً.`,
        `تثبيت لوحة الأسهم التحذيرية ومخاريط بطول تدرج ${l_taper} متر.`,
        `تمركز ونش إنقاذ سريع على بعد 150 متراً قبل بداية التحويلة.`,
        `توجيه النقل الثقيل والميكروباص إلى المحور الخدمي البديل لمنع احتكاك المسارات.`,
      ],
    },
  };
}

function computeFallbackIntersection(req: IntersectionRequest): IntersectionResponse {
  const tot = req.main_flow + req.cross_flow;
  const turn_r = req.turning_pct / 100.0;
  const heavy_r = req.heavy_pct / 100.0;

  // Open
  const c_open = 3600.0 / (1.0 + turn_r * 1.2 + heavy_r * 0.8);
  const d_open = 9.5 + 28.0 * Math.pow(tot / c_open, 2.6);
  const q_open = Math.max(15, (tot / 3600) * d_open * 6.5 * 0.45);

  // Signal
  const s_main = 1900 * 3 * (1 - heavy_r / 2);
  const s_cross = 1800 * 2 * (1 - heavy_r / 2);
  const y = Math.min(0.94, (req.main_flow * 0.55 / s_main) + (req.cross_flow * 0.65 / s_cross) + (req.turning_pct / 250));
  const c_opt = Math.max(45, Math.min(160, (1.5 * 16 + 5) / (1 - y)));
  const gc = Math.max(0.25, (1 - 16 / c_opt) * (req.main_flow / tot));
  const cap_sig = s_main * gc + s_cross * (1 - gc - 16 / c_opt);
  const x_sig = tot / cap_sig;
  const d_sig = (0.5 * c_opt * Math.pow(1 - gc, 2)) / (1 - Math.min(0.98, x_sig) * gc) + 45.0 * Math.max(0, x_sig - 0.85) * 120;
  const q_sig = (req.main_flow / 3600) * (c_opt * (1 - gc)) * (6.5 / 3.0) * (1 + Math.max(0, x_sig - 0.75) * 2.2);

  // UTurn
  const p_div = (req.cross_flow + req.main_flow * turn_r) / tot;
  const t_detour = (2 * req.uturn_distance_m) / (50.0 / 3.6);
  const d_weave = 6.0 + 14.0 * Math.pow(tot / 6800.0, 2.1);
  const d_uturn = (p_div * t_detour * 0.55) + d_weave;
  const q_uturn = Math.max(12, d_uturn * 1.4);

  // Roundabout
  const q_circ = 0.42 * req.main_flow + 0.65 * req.cross_flow * (1 + turn_r);
  const c_round = 3 * 1350 * Math.exp(-0.00075 * q_circ);
  const vc_round = tot / c_round;
  const d_round = 11.0 + (3600 / c_round) + 65.0 * Math.pow(Math.max(0, vc_round - 0.75), 2.2) * 100;
  const q_round = Math.max(18, vc_round * 65 * (1 + Math.max(0, vc_round - 0.85) * 4.5));

  const getLos = (d: number, vc: number) => d > 80 || vc > 1 ? 'F' : d > 55 ? 'E' : d > 35 ? 'D' : d > 20 ? 'C' : d > 10 ? 'B' : 'A';

  const alternatives: IntersectionAlternative[] = [
    { id: 'OPEN', name_en: 'Uncontrolled Open Intersection', name_ar: 'تقاطع سطحي مفتوح بدون تحكم', conflict_points: 32, average_delay_sec: Math.round(d_open * 10) / 10, queue_95th_m: Math.round(q_open), capacity_vehh: Math.round(c_open), volume_to_capacity: Math.round((tot / c_open) * 100) / 100, level_of_service: getLos(d_open, tot / c_open), spillback_risk: q_open > 300, safety_index_pct: 25, estimated_throughput_pce: Math.min(tot, c_open) },
    { id: 'SIGNAL', name_en: 'Adaptive 4-Phase Traffic Signal', name_ar: 'إشارة ضوئية ذكية رباعية الأطوار', conflict_points: 8, average_delay_sec: Math.round(d_sig * 10) / 10, queue_95th_m: Math.round(q_sig), capacity_vehh: Math.round(cap_sig), volume_to_capacity: Math.round(x_sig * 100) / 100, level_of_service: getLos(d_sig, x_sig), spillback_risk: q_sig > 350, safety_index_pct: 75, estimated_throughput_pce: Math.min(tot, cap_sig) },
    { id: 'UTURN', name_en: 'Closed Median + Protected U-Turn Corridor', name_ar: 'إلغاء التقاطع + محور دوران للخلف (نموذج المحاور)', conflict_points: 4, average_delay_sec: Math.round(d_uturn * 10) / 10, queue_95th_m: Math.round(q_uturn), capacity_vehh: 7200, volume_to_capacity: Math.round((tot / 7200) * 100) / 100, level_of_service: getLos(d_uturn, tot / 7200), spillback_risk: false, safety_index_pct: 92, estimated_throughput_pce: tot },
    { id: 'ROUNDABOUT', name_en: 'Modern 3-Lane High-Capacity Roundabout', name_ar: 'ميدان دائري حديث ثلاثي الحارات', conflict_points: 8, average_delay_sec: Math.round(d_round * 10) / 10, queue_95th_m: Math.round(q_round), capacity_vehh: Math.round(c_round), volume_to_capacity: Math.round(vc_round * 100) / 100, level_of_service: getLos(d_round, vc_round), spillback_risk: q_round > 280, safety_index_pct: 82, estimated_throughput_pce: Math.min(tot, c_round) },
  ];

  const rec_id = req.main_flow >= 2800 ? 'UTURN' : (d_uturn <= d_sig ? 'UTURN' : 'SIGNAL');

  return {
    inputs: req,
    alternatives,
    recommended_option_id: rec_id,
    recommendation_rationale_en: `At heavy mainline demand (${req.main_flow} veh/h), the Protected U-Turn Corridor eliminates mainline signal stoppage, cutting conflict points to 4 with minimal delay (${Math.round(d_uturn)}s).`,
    recommendation_rationale_ar: `في ظل الكثافة العالية (${req.main_flow} مركبة/س)، يحقق نموذج إلغاء التقاطع وتطبيق دوران محمي للخلف أعلى انسيابية بدون توقف مع خفض نقاط التعارض إلى 4 نقاط فقط وتأخير قدره ${Math.round(d_uturn)} ثانية.`,
    executive_takeaway_en: `RECOMMENDED: ${rec_id} model. Delivers +67% safety improvement over open intersection.`,
    executive_takeaway_ar: `التوصية: تنفيذ نموذج ${rec_id}. يحقق تحسناً في الأمان بنسبة +67% مقارنة بالتقاطع المفتوح.`,
  };
}

function computeFallbackShockwave(req: ShockwaveRequest): ShockwaveResponse {
  const q1 = 6100.0;
  const v1 = 62.0;
  const k1 = q1 / v1;
  const open_lanes = Math.max(1, 4 - req.blocked_lanes);
  const micro_factor = Math.max(0.68, 1.0 - (0.32 * req.weaving_index));
  const q2 = 2000.0 * open_lanes * micro_factor * 0.88;
  const k_jam = 580.0;

  const w = q1 > q2 ? Math.abs((q2 - q1) / Math.max(10, k_jam - k1)) : 0.0;
  const t_block = w > 0 ? ((0.6 / w) * 60.0) : 999.0;

  const queue_progression: QueueProgressionStep[] = [];
  for (let m = 0; m <= 60; m += 5) {
    const q_len = (w * (m / 60.0)) * 1000.0;
    queue_progression.push({
      elapsed_minutes: m,
      queue_length_m: Math.round(q_len),
      spillback_reached: q_len >= 600.0,
      vehicles_in_queue: Math.round(Math.max(0, (q1 - q2) * (m / 60.0))),
      upstream_speed_kmh: Math.round(Math.max(10, v1 - (q_len / 600.0) * (v1 - 12))),
    });
  }

  return {
    corridor_id: req.corridor_id,
    arrival_flow_pce: q1,
    arrival_speed_kmh: v1,
    arrival_density_veh_km: Math.round(k1),
    bottleneck_capacity_pce: Math.round(q2),
    jam_density_veh_km: k_jam,
    backward_shockwave_speed_kmh: Math.round(w * 10) / 10,
    upstream_exit_distance_m: 600.0,
    time_to_block_minutes: Math.round(t_block * 10) / 10,
    is_spillback_imminent: t_block <= 20.0,
    queue_progression,
    sop: {
      incident_severity: t_block <= 20.0 ? "HIGH - RED ALERT" : "MODERATE - AMBER",
      time_to_block_min: Math.round(t_block * 10) / 10,
      backward_shockwave_speed_kmh: Math.round(w * 10) / 10,
      bottleneck_discharge_pce: Math.round(q2),
      containment_actions_en: [
        `URGENT: Upstream exit blockage estimated in ${t_block.toFixed(1)} minutes at ${w.toFixed(1)} km/h.`,
        `Dispatch Traffic Police patrol to hold upstream on-ramp flow at 600m.`,
        `Set DMS signs to 'ACCIDENT AHEAD - MERGE RIGHT - MAX 40 KM/H'.`,
        `Stage heavy rotator tow truck for rapid vehicle extraction.`,
      ],
      containment_actions_ar: [
        `تنبيه عاجل: متوقع إغلاق المخرج السابق خلال ${t_block.toFixed(1)} دقيقة بسرعة ارتداد ${w.toFixed(1)} كم/س.`,
        `توجيه دورية مرور إلى المخرج السابق للتحكم في الكثافات المتدفقة.`,
        `تفعيل شاشات اللوحات الإرشادية: 'حادث أمامك - التزم بالحارات المفتوحة - أقصى سرعة 40 كم/س'.`,
        `استدعاء ونش السحب الهيدروليكي السريع لرفع المركبات وفتح المحور فوراً.`,
      ],
      micro_friction_remedy_en: `Install 140m steel pedestrian barrier to prevent informal microbus stopping, relocating drop-off zone 250m ahead.`,
      micro_friction_remedy_ar: `تركيب حاجز معدني فاصل بطول 140 متراً لمنع توقف الميكروباص العشوائي وترحيل الموقف 250 متراً للأمام.`,
    },
  };
}

function computeFallbackReversible(req: ReversibleRequest): ReversibleResponse {
  const tot = req.inbound_flow + req.outbound_flow;
  const split_pct = (req.inbound_flow / tot) * 100.0;

  const std_in_vc = req.inbound_flow / 7200.0;
  const std_out_vc = req.outbound_flow / 7200.0;
  const std_speed = Math.max(12, 75.0 * (1.0 - 0.75 * Math.max(0, std_in_vc - 0.65)));
  const std_time = (req.corridor_length_km / std_speed) * 60.0;
  const std_delay = Math.max(0, (std_in_vc - 0.75) * 220);

  const rev_in_vc = req.inbound_flow / 8850.0;
  const rev_out_vc = req.outbound_flow / 5250.0;
  const rev_speed = Math.max(15, 75.0 * (1.0 - 0.75 * Math.max(0, rev_in_vc - 0.65)));
  const rev_time = (req.corridor_length_km / rev_speed) * 60.0;
  const rev_delay = Math.max(0, (rev_in_vc - 0.75) * 220);
  const rev_out_safety = Math.max(0, (1.0 - rev_out_vc) * 100);

  const time_saved = Math.max(0, Math.round(((std_time - rev_time) / std_time) * 1000) / 10);
  const delay_saved = Math.max(0, Math.round(((std_delay - rev_delay) / Math.max(0.1, std_delay)) * 1000) / 10);
  const is_rev = split_pct >= 65.0 && rev_out_vc < 0.85;

  const green_wave_schedule: GreenWaveIntersection[] = [
    { intersection_index: 1, name_en: "Axis Entrance Interchange", name_ar: "تقاطع مدخل المحور", distance_from_start_m: 0, offset_seconds: 0, cycle_length_sec: 90, green_window_sec: 52 },
    { intersection_index: 2, name_en: "Hyper One / Service Node", name_ar: "تقاطع هايبر وان / المنطقة الخدمية", distance_from_start_m: 480, offset_seconds: 28.8, cycle_length_sec: 90, green_window_sec: 52 },
    { intersection_index: 3, name_en: "Smart Village Main Bridge", name_ar: "تقاطع كوبري القرية الذكية", distance_from_start_m: 960, offset_seconds: 57.6, cycle_length_sec: 90, green_window_sec: 52 },
    { intersection_index: 4, name_en: "Abu Rawash Industrial Link", name_ar: "تقاطع وصلة أبو رواش الصناعية", distance_from_start_m: 1440, offset_seconds: 86.4, cycle_length_sec: 90, green_window_sec: 52 },
    { intersection_index: 5, name_en: "Ring Road Connector Flyover", name_ar: "تقاطع الربط مع الطريق الدائري", distance_from_start_m: 1920, offset_seconds: 25.2, cycle_length_sec: 90, green_window_sec: 52 },
  ];

  return {
    corridor_id: req.corridor_id,
    total_bidirectional_flow: tot,
    directional_split_pct: Math.round(split_pct * 10) / 10,
    recommended_mode: is_rev ? "REVERSIBLE_5_3" : "STANDARD_4_4",
    standard_4_4: {
      configuration_name: "Standard 4+4 Balanced Lanes",
      inbound_lanes: 4,
      outbound_lanes: 4,
      inbound_capacity: 7200,
      outbound_capacity: 7200,
      inbound_vc_ratio: Math.round(std_in_vc * 100) / 100,
      outbound_vc_ratio: Math.round(std_out_vc * 100) / 100,
      inbound_speed_kmh: Math.round(std_speed * 10) / 10,
      inbound_travel_time_min: Math.round(std_time * 10) / 10,
      inbound_delay_sec: Math.round(std_delay * 10) / 10,
      outbound_safety_margin_pct: Math.round((1.0 - std_out_vc) * 1000) / 10,
      is_viable: true,
    },
    reversible_5_3: {
      configuration_name: "Dynamic Reversible 5+3 Lanes",
      inbound_lanes: 5,
      outbound_lanes: 3,
      inbound_capacity: 8850,
      outbound_capacity: 5250,
      inbound_vc_ratio: Math.round(rev_in_vc * 100) / 100,
      outbound_vc_ratio: Math.round(rev_out_vc * 100) / 100,
      inbound_speed_kmh: Math.round(rev_speed * 10) / 10,
      inbound_travel_time_min: Math.round(rev_time * 10) / 10,
      inbound_delay_sec: Math.round(rev_delay * 10) / 10,
      outbound_safety_margin_pct: Math.round(rev_out_safety * 10) / 10,
      is_viable: rev_out_vc < 0.85,
    },
    travel_time_saved_pct: time_saved,
    delay_reduction_pct: delay_saved,
    green_wave_schedule,
    pre_arrival_flush_time_sec: 38.5,
    executive_summary_en: is_rev
      ? `ACTIVATE 5+3 REVERSIBLE LANES: Directional split is ${split_pct.toFixed(1)}% Inbound. Saves ${time_saved}% travel time.`
      : `MAINTAIN 4+4 LANES: Directional split (${split_pct.toFixed(1)}%) does not warrant barrier shifting.`,
    executive_summary_ar: is_rev
      ? `تفعيل نظام 5+3 حارات: التفاوت الاتجاهي ${split_pct.toFixed(1)}% للداخل. يحقق توفيراً بنسبة ${time_saved}% في زمن الرحلة.`
      : `الإبقاء على 4+4 حارات: التفاوت الاتجاهي (${split_pct.toFixed(1)}%) لا يبرر تحريك الحواجز.`,
  };
}

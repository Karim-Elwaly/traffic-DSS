import React, { useEffect, useRef, useState } from 'react';
import {
  Play,
  Pause,
  RefreshCw,
  GitCompare,
  Eye,
  Flame,
  CheckCircle2,
  Gauge,
  Activity,
  Radio,
} from 'lucide-react';
import {
  VehicleClassSpec,
  exponential,
  idmAcceleration,
  losFromDelay,
  makeRng,
  pickColor,
  sampleVehicleClass,
  websterTiming,
} from '../../simulation/microsim';

type Language = 'en' | 'ar';
export type AlternativeId = 'OPEN' | 'SIGNAL' | 'UTURN' | 'ROUNDABOUT';
type SignalStream = 'east' | 'west' | 'south' | 'north';
type UturnStream = 'east' | 'west' | 'side' | 'loop';
type Phase = 'MAIN_GREEN' | 'MAIN_YELLOW' | 'ALL_RED' | 'CROSS_GREEN' | 'CROSS_YELLOW' | 'ALL_RED_2';
type Los = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';

export interface IntersectionCanvasProps {
  mainFlow: number;
  crossFlow: number;
  language?: Language;
  turningPct?: number;
  heavyPct?: number;
  uturnDistanceM?: number;
  /** Full list of analytical alternatives from DSS optimizer. */
  alternatives?: Array<{
    id: string;
    name_en: string;
    name_ar: string;
    level_of_service: string;
    average_delay_sec: number;
    queue_95th_m: number;
    conflict_points: number;
    volume_to_capacity: number;
    safety_index_pct: number;
    estimated_throughput_pce: number;
  }>;
  /** Analytical HCM/Webster planning values for the same scenario. */
  signalPlanningDelaySec?: number;
  signalPlanningQueueM?: number;
  uturnPlanningDelaySec?: number;
  uturnPlanningQueueM?: number;
}

interface SimVehicle {
  id: number;
  x: number;
  y: number;
  angle: number;
  speed: number;
  accel?: number;
  spec: VehicleClassSpec;
  color: string;
  lengthPx: number;
  widthPx: number;
  stream: SignalStream | UturnStream;
  lane: number;
  departTime: number;
  stoppedTime: number;
  braking: boolean;
  passedStop: boolean;
  movement: 'through' | 'right';
  turnProgress?: number;
  turnPath?: {
    p0: { x: number; y: number };
    p1: { x: number; y: number };
    p2: { x: number; y: number };
    p3: { x: number; y: number };
  };
  turnDestination?: SignalStream;
  turnDestinationLane?: number;
  turnOnRed?: boolean;
  turnWait?: number;
  laneCooldown?: number;
  willUturn?: boolean;
  pathProgress?: number;
  loopFromY?: number;
  loopToY?: number;
}

interface LiveMetrics {
  phase: Phase;
  countdown: number;
  cycleSec: number;
  signalQueueVeh: number;
  signalQueueM: number;
  signalDelay: number;
  signalSpeed: number;
  signalThroughput: number;
  signalLos: Los;
  uturnActive: number;
  uturnQueueM: number;
  uturnDelay: number;
  uturnSpeed: number;
  uturnLos: Los;
  /** True until at least one full signal cycle has elapsed. */
  warmup: boolean;
  /** True until the U-turn stream has accumulated a stable sample. */
  uturnWarmup: boolean;
}

const W = 640;
const H = 360;
const PX_PER_M = 4; // 1 m = 4 px; the canvas is a schematic ~160 m window
const MAIN_SPEED_PX = ((60 / 3.6) * PX_PER_M);
const CROSS_SPEED_PX = ((50 / 3.6) * PX_PER_M);
const TURN_SPEED_PX = ((22 / 3.6) * PX_PER_M);

const SIGNAL_LANE_Y: Record<SignalStream, [number, number]> = {
  east: [225, 195],
  west: [135, 165],
  south: [275, 305],
  north: [365, 335],
};

const STOP_LINE: Record<SignalStream, { axis: 'x' | 'y'; value: number; dir: 1 | -1 }> = {
  east: { axis: 'x', value: 258, dir: 1 },
  west: { axis: 'x', value: 382, dir: -1 },
  south: { axis: 'y', value: 118, dir: 1 },
  north: { axis: 'y', value: 242, dir: -1 },
};

const ENTRY: Record<SignalStream, { x: number; y: number }> = {
  east: { x: -30, y: 0 },
  west: { x: W + 30, y: 0 },
  south: { x: 0, y: -30 },
  north: { x: 0, y: H + 30 },
};

const initialLive: LiveMetrics = {
  phase: 'MAIN_GREEN',
  countdown: 0,
  cycleSec: 0,
  signalQueueVeh: 0,
  signalQueueM: 0,
  signalDelay: 0,
  signalSpeed: 0,
  signalThroughput: 0,
  signalLos: 'A',
  uturnActive: 0,
  uturnQueueM: 0,
  uturnDelay: 0,
  uturnSpeed: 0,
  uturnLos: 'A',
  warmup: true,
  uturnWarmup: true,
};

function bezier(
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
  t: number
) {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const mt3 = mt2 * mt;
  const t2 = t * t;
  const t3 = t2 * t;
  const x = mt3 * p0.x + 3 * mt2 * t * p1.x + 3 * mt * t2 * p2.x + t3 * p3.x;
  const y = mt3 * p0.y + 3 * mt2 * t * p1.y + 3 * mt * t2 * p2.y + t3 * p3.y;
  const dx = 3 * mt2 * (p1.x - p0.x) + 6 * mt * t * (p2.x - p1.x) + 3 * t2 * (p3.x - p2.x);
  const dy = 3 * mt2 * (p1.y - p0.y) + 6 * mt * t * (p2.y - p1.y) + 3 * t2 * (p3.y - p2.y);
  return { x, y, angle: Math.atan2(dy, dx) };
}

export const IntersectionCanvas: React.FC<IntersectionCanvasProps> = ({
  mainFlow,
  crossFlow,
  language = 'en',
  turningPct = 18,
  heavyPct = 12,
  uturnDistanceM = 450,
  alternatives,
  signalPlanningDelaySec,
  signalPlanningQueueM,
  uturnPlanningDelaySec,
  uturnPlanningQueueM,
}) => {
  const isAr = language === 'ar';
  const signalCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const uturnCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const [leftAlt, setLeftAlt] = useState<AlternativeId>('SIGNAL');
  const [rightAlt, setRightAlt] = useState<AlternativeId>('UTURN');
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [showRadar, setShowRadar] = useState(false);

  const [isPlaying, setIsPlaying] = useState(true);
  const [simSpeed, setSimSpeed] = useState<1 | 2 | 4>(2);
  const [showConflicts, setShowConflicts] = useState(true);
  const [enableHeadlights, setEnableHeadlights] = useState(true);
  const [live, setLive] = useState<LiveMetrics>(initialLive);
  const [resetToken, setResetToken] = useState(0);

  const leftAltRef = useRef<AlternativeId>('SIGNAL');
  const rightAltRef = useRef<AlternativeId>('UTURN');
  const showHeatmapRef = useRef(false);
  const showRadarRef = useRef(false);
  const isPlayingRef = useRef(true);
  const simSpeedRef = useRef<1 | 2 | 4>(2);
  const showConflictsRef = useRef(true);
  const enableHeadlightsRef = useRef(true);

  useEffect(() => {
    leftAltRef.current = leftAlt;
  }, [leftAlt]);
  useEffect(() => {
    rightAltRef.current = rightAlt;
  }, [rightAlt]);
  useEffect(() => {
    showHeatmapRef.current = showHeatmap;
  }, [showHeatmap]);
  useEffect(() => {
    showRadarRef.current = showRadar;
  }, [showRadar]);
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);
  useEffect(() => {
    simSpeedRef.current = simSpeed;
  }, [simSpeed]);
  useEffect(() => {
    showConflictsRef.current = showConflicts;
  }, [showConflicts]);
  useEffect(() => {
    enableHeadlightsRef.current = enableHeadlights;
  }, [enableHeadlights]);

  // The live canvas must consume exactly the same demand as the analytical
  // table and the UI sliders. A hidden density multiplier disconnected the two.
  const effectiveMainFlow = mainFlow;
  const effectiveCrossFlow = crossFlow;

  // -------------------------------------------------------------------------
  // Main simulation loop. Re-initialised only when the scenario inputs or the
  // reset token change, so pausing / speed changes never restart the traffic.
  // -------------------------------------------------------------------------
  useEffect(() => {
    const sigCanvas = signalCanvasRef.current;
    const uturnCanvas = uturnCanvasRef.current;
    if (!sigCanvas || !uturnCanvas) return;
    const sigCtx = sigCanvas.getContext('2d');
    const uturnCtx = uturnCanvas.getContext('2d');
    if (!sigCtx || !uturnCtx) return;

    const rng = makeRng(0xc0ffee + Math.round(effectiveMainFlow) + Math.round(effectiveCrossFlow) * 3 + resetToken);
    const timing = websterTiming(effectiveMainFlow, effectiveCrossFlow, turningPct, heavyPct);

    const signalVehicles: SimVehicle[] = [];
    const uturnVehicles: SimVehicle[] = [];
    const completedSignal: Array<{ time: number; delay: number }> = [];
    const completedUturn: Array<{ time: number; delay: number }> = [];
    let nextVehId = 1;
    let simTime = 0;
    let lastTime = performance.now();
    let lastLiveAt = 0;

    // ---------------------------------------------------------------------
    // Demand: Poisson arrivals split equally between the two directions.
    // ---------------------------------------------------------------------
    const streamRate = (flow: number) => Math.max(0.0001, flow / 2 / 3600);
    const nextArrival: Record<SignalStream, number> = {
      east: exponential(rng, 1 / streamRate(effectiveMainFlow)),
      west: exponential(rng, 1 / streamRate(effectiveMainFlow)),
      south: exponential(rng, 1 / streamRate(effectiveCrossFlow)),
      north: exponential(rng, 1 / streamRate(effectiveCrossFlow)),
    };
    const uturnRateMain = streamRate(effectiveMainFlow);
    const uturnRateSide = streamRate(effectiveCrossFlow);
    let nextUturn: Record<UturnStream, number> = {
      east: exponential(rng, 1 / uturnRateMain),
      west: exponential(rng, 1 / uturnRateMain),
      side: exponential(rng, 1 / uturnRateSide),
      loop: Infinity,
    };

    const createVehicle = (
      stream: SignalStream | UturnStream,
      lane: number,
      x: number,
      y: number,
      angle: number,
      speed: number
    ): SimVehicle => {
      const spec = sampleVehicleClass(rng, heavyPct);
      return {
        id: nextVehId++,
        x,
        y,
        angle,
        speed,
        spec,
        color: pickColor(rng, spec),
        lengthPx: Math.max(15, spec.lengthM * PX_PER_M),
        widthPx: Math.max(7, spec.widthM * PX_PER_M),
        stream,
        lane,
        departTime: simTime,
        stoppedTime: 0,
        braking: false,
        passedStop: false,
        movement: 'through',
        willUturn: stream === 'east' && rng() < Math.max(0.05, turningPct / 100),
      };
    };

    const rightTurnTarget: Record<
      SignalStream,
      { destination: SignalStream; lane: number }
    > = {
      east: { destination: 'south', lane: 1 },
      west: { destination: 'north', lane: 1 },
      south: { destination: 'west', lane: 1 },
      north: { destination: 'east', lane: 1 },
    };

    // Geometric merge points are derived from the receiving lane in
    // rightTurnMergeClear; right-turn-on-red is only allowed when that lane is
    // clear of conflicting cross traffic.
    const rightTurnMergeClear = (v: SimVehicle): boolean => {
      const destination = v.turnDestination;
      const lane = v.turnDestinationLane;
      if (!destination || !lane) return true;
      const laneIndex = Math.max(0, Math.min(1, lane - 1));
      const merge =
        destination === 'south'
          ? { x: SIGNAL_LANE_Y.south[laneIndex], y: 274 }
          : destination === 'north'
          ? { x: SIGNAL_LANE_Y.north[laneIndex], y: 86 }
          : destination === 'west'
          ? { x: 230, y: SIGNAL_LANE_Y.west[laneIndex] }
          : { x: 420, y: SIGNAL_LANE_Y.east[laneIndex] };
      for (const other of signalVehicles) {
        if (other.id === v.id) continue;
        if (other.stream !== destination || other.lane !== lane || other.movement === 'right') {
          continue;
        }
        // Only vehicles approaching the merge point within ~80 m conflict.
        let conflict = false;
        if (destination === 'south') {
          conflict = Math.abs(other.x - merge.x) < 40 && other.y < merge.y + 10 && other.y > merge.y - 320;
        } else if (destination === 'north') {
          conflict = Math.abs(other.x - merge.x) < 40 && other.y > merge.y - 10 && other.y < merge.y + 320;
        } else if (destination === 'east') {
          conflict = Math.abs(other.y - merge.y) < 40 && other.x < merge.x + 10 && other.x > merge.x - 320;
        } else {
          conflict = Math.abs(other.y - merge.y) < 40 && other.x > merge.x - 10 && other.x < merge.x + 320;
        }
        if (conflict) return false;
      }
      return true;
    };

    const rearMost = (
      array: SimVehicle[],
      stream: SignalStream | UturnStream,
      lane: number
    ): SimVehicle | undefined => {
      const list = array.filter((v) => v.stream === stream && v.lane === lane);
      if (list.length === 0) return undefined;
      if (stream === 'east' || stream === 'south' || stream === 'side') {
        return list.reduce((min, v) => {
          const a = stream === 'east' ? v.x : v.y;
          const b = stream === 'east' ? min.x : min.y;
          return a < b ? v : min;
        });
      }
      return list.reduce((max, v) => {
        const a = stream === 'west' ? v.x : v.y;
        const b = stream === 'west' ? max.x : max.y;
        return a > b ? v : max;
      });
    };

    const insertSignalVehicle = (stream: SignalStream) => {
      const spec = sampleVehicleClass(rng, heavyPct);
      const wantsRightTurn = rng() < Math.min(0.35, Math.max(0.05, turningPct / 100));
      let lane = wantsRightTurn ? 1 : rng() < 0.5 ? 1 : 2;
      if (!wantsRightTurn && (spec.kind === 'truck' || spec.kind === 'bus') && rng() < 0.7) {
        lane = 1;
      }
      const laneY = SIGNAL_LANE_Y[stream][lane - 1];
      const entry = ENTRY[stream];
      const tail = rearMost(signalVehicles, stream, lane);
      const gapPx = 2.5 * PX_PER_M;
      let x = stream === 'east' || stream === 'west' ? entry.x : laneY;
      let y = stream === 'south' || stream === 'north' ? entry.y : laneY;

      if (tail) {
        const spacing = (tail.lengthPx + spec.lengthM * PX_PER_M) / 2 + gapPx;
        let candidateX = x;
        let candidateY = y;
        if (stream === 'east') candidateX = tail.x - spacing;
        else if (stream === 'west') candidateX = tail.x + spacing;
        else if (stream === 'south') candidateY = tail.y - spacing;
        else candidateY = tail.y + spacing;
        // If the queue tail is already visible, enter at the off-screen
        // boundary instead of popping into existence mid-approach. Only use
        // the queue-following spawn when it stays outside the viewport.
        const insideView =
          stream === 'east'
            ? candidateX >= 0
            : stream === 'west'
            ? candidateX <= W
            : stream === 'south'
            ? candidateY >= 0
            : candidateY <= H;
        if (!insideView) {
          x = candidateX;
          y = candidateY;
        }
      }
      const maxStorage = 460;
      if (stream === 'east' && x < -maxStorage) return;
      if (stream === 'west' && x > W + maxStorage) return;
      if (stream === 'south' && y < -maxStorage) return;
      if (stream === 'north' && y > H + maxStorage) return;

      const angle = stream === 'east' ? 0 : stream === 'west' ? Math.PI : stream === 'south' ? Math.PI / 2 : -Math.PI / 2;
      const speed = stream === 'east' || stream === 'west' ? MAIN_SPEED_PX : CROSS_SPEED_PX;
      const vehicle = createVehicle(stream, lane, x, y, angle, speed * 0.9);
      vehicle.spec = spec;
      vehicle.lengthPx = Math.max(15, spec.lengthM * PX_PER_M);
      vehicle.widthPx = Math.max(7, spec.widthM * PX_PER_M);
      if (wantsRightTurn) {
        vehicle.movement = 'right';
        vehicle.turnDestination = rightTurnTarget[stream].destination;
        // Heavy vehicles need a wider swept path: they complete the turn in
        // the inner lane, while cars use the curb lane.
        const heavy = spec.kind === 'bus' || spec.kind === 'truck';
        vehicle.turnDestinationLane = heavy ? 2 : rightTurnTarget[stream].lane;
      }
      signalVehicles.push(vehicle);
    };

    const insertUturnVehicle = (stream: UturnStream) => {
      if (stream === 'east' || stream === 'west') {
        let lane = rng() < 0.5 ? 1 : 2;
        const spec = sampleVehicleClass(rng, heavyPct);
        if ((spec.kind === 'truck' || spec.kind === 'bus') && rng() < 0.7) lane = 1;
        const laneY = stream === 'east' ? [225, 200][lane - 1] : [135, 160][lane - 1];
        const tail = rearMost(uturnVehicles, stream, lane);
        const candidateX = stream === 'east' ? (tail ? tail.x - 40 : -30) : tail ? tail.x + 40 : W + 30;
        const insideView = stream === 'east' ? candidateX >= 0 : candidateX <= W;
        const x = insideView ? (stream === 'east' ? -30 : W + 30) : candidateX;
        const vehicle = createVehicle(stream, lane, x, laneY, stream === 'east' ? 0 : Math.PI, MAIN_SPEED_PX);
        vehicle.spec = spec;
        vehicle.lengthPx = Math.max(15, spec.lengthM * PX_PER_M);
        vehicle.widthPx = Math.max(7, spec.widthM * PX_PER_M);
        uturnVehicles.push(vehicle);
      } else {
        uturnVehicles.push(createVehicle('side', 1, 185, -30, Math.PI / 2, CROSS_SPEED_PX * 0.85));
      }
    };

    // ---------------------------------------------------------------------
    // Signal phases: Webster green splits with realistic yellow + all-red.
    // ---------------------------------------------------------------------
    const phases: Array<{ name: Phase; duration: number }> = [
      { name: 'MAIN_GREEN', duration: timing.mainGreenSec },
      { name: 'MAIN_YELLOW', duration: timing.yellowSec },
      { name: 'ALL_RED', duration: timing.allRedSec },
      { name: 'CROSS_GREEN', duration: timing.crossGreenSec },
      { name: 'CROSS_YELLOW', duration: timing.yellowSec },
      { name: 'ALL_RED_2', duration: timing.allRedSec },
    ];
    let phaseIndex = 0;
    let phaseElapsed = 0;
    const cycleSec = phases.reduce((s, p) => s + p.duration, 0);

    const signalStateFor = (stream: SignalStream): 'GREEN' | 'YELLOW' | 'RED' => {
      const main = stream === 'east' || stream === 'west';
      const p = phases[phaseIndex].name;
      if (main) {
        if (p === 'MAIN_GREEN') return 'GREEN';
        if (p === 'MAIN_YELLOW') return 'YELLOW';
        return 'RED';
      }
      if (p === 'CROSS_GREEN') return 'GREEN';
      if (p === 'CROSS_YELLOW') return 'YELLOW';
      return 'RED';
    };

    const advancePhase = (dt: number) => {
      phaseElapsed += dt;
      let guard = 0;
      while (phaseElapsed >= phases[phaseIndex].duration && guard < 8) {
        phaseElapsed -= phases[phaseIndex].duration;
        phaseIndex = (phaseIndex + 1) % phases.length;
        guard += 1;
      }
    };

    const distToStop = (v: SimVehicle): number => {
      const stop = STOP_LINE[v.stream as SignalStream];
      if (stop.axis === 'x') {
        return stop.dir === 1 ? stop.value - (v.x + v.lengthPx / 2) : v.x - v.lengthPx / 2 - stop.value;
      }
      return stop.dir === 1 ? stop.value - (v.y + v.lengthPx / 2) : v.y - v.lengthPx / 2 - stop.value;
    };

    const updatePassedStop = (v: SimVehicle) => {
      const stop = STOP_LINE[v.stream as SignalStream];
      if (stop.axis === 'x') {
        v.passedStop = stop.dir === 1 ? v.x + v.lengthPx / 2 >= stop.value : v.x - v.lengthPx / 2 <= stop.value;
      } else {
        v.passedStop = stop.dir === 1 ? v.y + v.lengthPx / 2 >= stop.value : v.y - v.lengthPx / 2 <= stop.value;
      }
    };

    const leaderGap = (v: SimVehicle): { gap: number; leaderSpeed: number } => {
      let gap = Infinity;
      let leaderSpeed = v.speed;
      for (const other of signalVehicles) {
        if (other.id === v.id || other.stream !== v.stream || other.lane !== v.lane) continue;
        const ahead =
          v.stream === 'east'
            ? other.x > v.x
            : v.stream === 'west'
            ? other.x < v.x
            : v.stream === 'south'
            ? other.y > v.y
            : other.y < v.y;
        if (!ahead) continue;
        const distance =
          v.stream === 'east' || v.stream === 'west'
            ? Math.abs(other.x - v.x)
            : Math.abs(other.y - v.y);
        const g = distance - (v.lengthPx + other.lengthPx) / 2;
        if (g < gap) {
          gap = g;
          leaderSpeed = other.speed;
        }
      }
      return { gap, leaderSpeed };
    };

    const laneChangeGap = (v: SimVehicle, targetLane: number) => {
      let ahead = Infinity;
      let behind = Infinity;
      for (const other of signalVehicles) {
        if (other.id === v.id || other.stream !== v.stream || other.lane !== targetLane) continue;
        const signed =
          v.stream === 'east'
            ? other.x - v.x
            : v.stream === 'west'
            ? v.x - other.x
            : v.stream === 'south'
            ? other.y - v.y
            : v.y - other.y;
        const clear = Math.abs(signed) - (v.lengthPx + other.lengthPx) / 2;
        if (signed >= 0) ahead = Math.min(ahead, clear);
        else behind = Math.min(behind, clear);
      }
      return { ahead, behind };
    };

    // A through vehicle stuck behind a right-turner (or a stopped queue) should
    // use the adjacent lane. Without this, lane 1 held nearly all of the queue:
    // right-turners waiting at the stop line blocked every through vehicle
    // behind them, halving the mainline's usable capacity.
    const trySignalLaneChange = (v: SimVehicle) => {
      if (v.movement !== 'through' || v.passedStop || v.lane !== 1) return;
      if ((v.laneCooldown ?? 0) > 0) return;
      const dist = distToStop(v);
      if (dist < 12 || dist > 180) return;
      const own = leaderGap(v);
      if (own.gap > 45 || own.leaderSpeed > 6) return;
      const target = laneChangeGap(v, 2);
      if (target.ahead < 18 || target.behind < 16) return;
      v.lane = 2;
      if (v.stream === 'east' || v.stream === 'west') {
        v.y = SIGNAL_LANE_Y[v.stream as SignalStream][1];
      } else {
        v.x = SIGNAL_LANE_Y[v.stream as SignalStream][1];
      }
      v.laneCooldown = 6;
    };

    const moveSignalVehicle = (v: SimVehicle, dt: number) => {
      v.laneCooldown = Math.max(0, (v.laneCooldown ?? 0) - dt);
      trySignalLaneChange(v);

      // Channelised right-turn slip lane. Right-turners leave the through lane
      // ~20 m before the stop line and wait in a curb-side auxiliary lane, so a
      // red-light right-turner never blocks the through movement behind it.
      if (v.movement === 'right' && !v.passedStop && v.lane === 1) {
        if (distToStop(v) < 80) {
          v.lane = 0;
          if (v.stream === 'east') v.y = SIGNAL_LANE_Y.east[0] + 12;
          else if (v.stream === 'west') v.y = SIGNAL_LANE_Y.west[0] - 12;
          else if (v.stream === 'south') v.x = SIGNAL_LANE_Y.south[0] - 12;
          else v.x = SIGNAL_LANE_Y.north[0] + 12;
        }
      }

      const stop = STOP_LINE[v.stream as SignalStream];
      const state = signalStateFor(v.stream as SignalStream);
      let desired = (v.stream === 'east' || v.stream === 'west' ? MAIN_SPEED_PX : CROSS_SPEED_PX) * v.spec.speedFactor;
      let { gap, leaderSpeed } = leaderGap(v);

      if (!v.passedStop) {
        const dist = distToStop(v);
        // Egyptian junctions permit a right turn on red after yielding. The
        // turner waits ~1 s at the stop line, then filters through only when
        // the receiving lane has no conflicting vehicle within ~80 m.
        if (v.movement === 'right' && (state === 'RED' || state === 'YELLOW') && dist < 8) {
          v.turnWait = (v.turnWait ?? 0) + dt;
          if ((v.turnWait ?? 0) > 1.0 && v.speed < 2 && rightTurnMergeClear(v)) {
            v.turnOnRed = true;
          }
        }
        let mustStop = state === 'RED' && !v.turnOnRed;
        if (state === 'YELLOW' && dist > 0 && !v.turnOnRed) {
          const b = v.spec.decel * PX_PER_M;
          const stopping = (v.speed * v.speed) / (2 * Math.max(1, b)) + v.speed * 0.8;
          if (dist > stopping + 6) mustStop = true;
        }
        if (mustStop && dist > 0.3) {
          const stopGap = Math.max(0.4, dist - 1.0);
          if (stopGap < gap) {
            gap = stopGap;
            leaderSpeed = 0;
          }
          desired = 0;
        }
        if (mustStop && dist <= 1.2 && v.speed < 8) {
          if (stop.axis === 'x') {
            v.x = stop.dir === 1 ? stop.value - v.lengthPx / 2 : stop.value + v.lengthPx / 2;
          } else {
            v.y = stop.dir === 1 ? stop.value - v.lengthPx / 2 : stop.value + v.lengthPx / 2;
          }
          v.speed = 0;
        }
      }

      if (v.movement === 'right' && !v.passedStop) {
        const dist = distToStop(v);
        if (dist < 60) desired = Math.min(desired, TURN_SPEED_PX * 1.5);
      }

      const accel = idmAcceleration(
        v.speed,
        Math.max(0, desired),
        Math.max(0.5, gap),
        leaderSpeed,
        v.spec,
        PX_PER_M
      );
      v.speed = Math.max(0, v.speed + accel * dt);

      // Right-turn trajectory: leave the approach, follow a cubic arc into the
      // receiving cross-street lane, then continue as normal through traffic.
      if (v.movement === 'right' && v.passedStop) {
        v.turnProgress = (v.turnProgress ?? 0) + (v.speed * dt) / 120;
        const progress = Math.min(1, v.turnProgress);
        if (!v.turnPath) {
          const laneIndex = Math.max(0, Math.min(1, (v.turnDestinationLane ?? 1) - 1));
          const wide = laneIndex === 1;
          let p1: { x: number; y: number };
          let p2: { x: number; y: number };
          let p3: { x: number; y: number };
          if (v.stream === 'east') {
            const tx = SIGNAL_LANE_Y.south[laneIndex];
            p1 = { x: v.x + (wide ? 38 : 25), y: v.y };
            p2 = { x: tx, y: v.y + (wide ? 34 : 20) };
            p3 = { x: tx, y: 274 };
          } else if (v.stream === 'west') {
            const tx = SIGNAL_LANE_Y.north[laneIndex];
            p1 = { x: v.x - (wide ? 38 : 25), y: v.y };
            p2 = { x: tx, y: v.y - (wide ? 34 : 20) };
            p3 = { x: tx, y: 86 };
          } else if (v.stream === 'south') {
            const ty = SIGNAL_LANE_Y.west[laneIndex];
            p1 = { x: v.x, y: v.y + (wide ? 38 : 25) };
            p2 = { x: v.x - (wide ? 34 : 20), y: ty };
            p3 = { x: 230, y: ty };
          } else {
            const ty = SIGNAL_LANE_Y.east[laneIndex];
            p1 = { x: v.x, y: v.y - (wide ? 38 : 25) };
            p2 = { x: v.x + (wide ? 34 : 20), y: ty };
            p3 = { x: 420, y: ty };
          }
          v.turnPath = { p0: { x: v.x, y: v.y }, p1, p2, p3 };
        }
        const pos = bezier(
          v.turnPath.p0,
          v.turnPath.p1,
          v.turnPath.p2,
          v.turnPath.p3,
          progress
        );
        v.x = pos.x;
        v.y = pos.y;
        v.angle = pos.angle;
        v.speed = Math.min(v.speed, TURN_SPEED_PX * 1.2);
        v.braking = true;
        if (v.speed < 1.0) v.stoppedTime += dt;

        if (progress >= 1) {
          const destination = v.turnDestination ?? 'south';
          const destinationLane = v.turnDestinationLane ?? 1;
          v.stream = destination;
          v.lane = destinationLane;
          v.movement = 'through';
          v.turnProgress = undefined;
          v.turnPath = undefined;
          v.turnDestination = undefined;
          v.turnDestinationLane = undefined;
          v.passedStop = true;
          if (destination === 'east' || destination === 'west') {
            v.y = SIGNAL_LANE_Y[destination][destinationLane - 1];
            v.x = destination === 'east' ? 420 : 230;
            v.angle = destination === 'east' ? 0 : Math.PI;
          } else {
            v.x = SIGNAL_LANE_Y[destination][destinationLane - 1];
            v.y = destination === 'south' ? 274 : 86;
            v.angle = destination === 'south' ? Math.PI / 2 : -Math.PI / 2;
          }
          v.speed = Math.max(TURN_SPEED_PX, v.speed);
        }
        return;
      }

      if (v.stream === 'east') {
        v.x += v.speed * dt;
        v.angle = 0;
      } else if (v.stream === 'west') {
        v.x -= v.speed * dt;
        v.angle = Math.PI;
      } else if (v.stream === 'south') {
        v.y += v.speed * dt;
        v.angle = Math.PI / 2;
      } else {
        v.y -= v.speed * dt;
        v.angle = -Math.PI / 2;
      }

      updatePassedStop(v);
      v.braking = accel < -0.5 || (v.speed < 2 && desired > 1);
      if (v.speed < 1.0) v.stoppedTime += dt;
    };

    const moveUturnVehicle = (v: SimVehicle, dt: number) => {
      if (v.stream === 'east') {
        let gap = Infinity;
        let leaderSpeed = v.speed;
        for (const o of uturnVehicles) {
          if (o.id === v.id || o.stream !== 'east' || o.lane !== v.lane || o.x <= v.x) continue;
          const g = o.x - v.x - (v.lengthPx + o.lengthPx) / 2;
          if (g < gap) {
            gap = g;
            leaderSpeed = o.speed;
          }
        }
        const accel = idmAcceleration(v.speed, MAIN_SPEED_PX * v.spec.speedFactor, Math.max(0.5, gap), leaderSpeed, v.spec, PX_PER_M);
        v.speed = Math.max(0, v.speed + accel * dt);
        v.x += v.speed * dt;
        v.angle = 0;
        if (v.willUturn && v.x >= 455) {
          v.stream = 'loop';
          v.pathProgress = 0;
          v.loopFromY = v.y;
          v.loopToY = v.lane === 1 ? 135 : 160;
        }
      } else if (v.stream === 'loop') {
        const detourScale = Math.max(0.4, Math.min(2.5, uturnDistanceM / 450));
        const progress = (v.pathProgress ?? 0) + (v.speed / (300 * detourScale)) * dt;
        v.pathProgress = progress;
        if (progress >= 1) {
          v.stream = 'west';
          v.x = 455;
          v.y = v.loopToY ?? 135;
          v.angle = Math.PI;
          v.speed = MAIN_SPEED_PX * 0.85;
        } else {
          const pos = bezier(
            { x: 460, y: v.loopFromY ?? 202 },
            { x: 535, y: v.loopFromY ?? 202 },
            { x: 535, y: v.loopToY ?? 162 },
            { x: 460, y: v.loopToY ?? 162 },
            progress
          );
          v.x = pos.x;
          v.y = pos.y;
          v.angle = pos.angle;
          v.speed = Math.max(6, v.speed * 0.985);
          v.braking = progress > 0.15 && progress < 0.85;
        }
      } else if (v.stream === 'west') {
        let gap = Infinity;
        let leaderSpeed = v.speed;
        for (const o of uturnVehicles) {
          if (o.id === v.id || o.stream !== 'west' || o.lane !== v.lane || o.x >= v.x) continue;
          const g = v.x - o.x - (v.lengthPx + o.lengthPx) / 2;
          if (g < gap) {
            gap = g;
            leaderSpeed = o.speed;
          }
        }
        const accel = idmAcceleration(v.speed, MAIN_SPEED_PX * v.spec.speedFactor, Math.max(0.5, gap), leaderSpeed, v.spec, PX_PER_M);
        v.speed = Math.max(0, v.speed + accel * dt);
        v.x -= v.speed * dt;
        v.angle = Math.PI;
      } else {
        // Right-in / right-out side street: southbound, then a right turn onto
        // the westbound carriageway.
        if ((v.pathProgress ?? 0) === 0 && v.y < 92) {
          v.y += v.speed * dt;
          v.angle = Math.PI / 2;
        } else {
          const progress = (v.pathProgress ?? 0) + (v.speed / 190) * dt;
          v.pathProgress = progress;
          if (progress >= 1) {
            v.stream = 'west';
            v.x = 190;
            v.y = 135;
            v.angle = Math.PI;
            v.speed = MAIN_SPEED_PX * 0.8;
          } else {
            const pos = bezier(
              { x: 185, y: 92 },
              { x: 205, y: 100 },
              { x: 212, y: 124 },
              { x: 190, y: 135 },
              progress
            );
            v.x = pos.x;
            v.y = pos.y;
            v.angle = pos.angle;
            v.speed = Math.max(12, v.speed * 0.99);
            v.braking = progress > 0.2;
          }
        }
      }
      v.braking = v.braking || v.speed < 2;
      if (v.speed < 1.0) v.stoppedTime += dt;
    };

    const step = (dt: number) => {
      simTime += dt;
      advancePhase(dt);

      // Poisson arrivals for the signalised intersection
      (['east', 'west', 'south', 'north'] as SignalStream[]).forEach((stream) => {
        const rate = streamRate(stream === 'east' || stream === 'west' ? effectiveMainFlow : effectiveCrossFlow);
        let guard = 0;
        while (simTime >= nextArrival[stream] && guard < 8) {
          insertSignalVehicle(stream);
          nextArrival[stream] += exponential(rng, 1 / rate);
          guard += 1;
        }
      });

      // Poisson arrivals for the protected U-turn corridor
      let guard = 0;
      while (simTime >= nextUturn.east && guard < 8) {
        insertUturnVehicle('east');
        nextUturn.east += exponential(rng, 1 / uturnRateMain);
        guard += 1;
      }
      guard = 0;
      while (simTime >= nextUturn.west && guard < 8) {
        insertUturnVehicle('west');
        nextUturn.west += exponential(rng, 1 / uturnRateMain);
        guard += 1;
      }
      guard = 0;
      while (simTime >= nextUturn.side && guard < 8) {
        insertUturnVehicle('side');
        nextUturn.side += exponential(rng, 1 / uturnRateSide);
        guard += 1;
      }

      for (const v of signalVehicles) moveSignalVehicle(v, dt);
      for (const v of uturnVehicles) moveUturnVehicle(v, dt);

      // Lane-level hard safety pass. Sort front-to-rear so the follower is
      // always placed behind the leader; sorting rear-to-front would push the
      // leading vehicle backwards (observed as cars jumping off the road).
      const safePass = (list: SimVehicle[], axis: 'x' | 'y', increasing: boolean) => {
        const sorted = [...list].sort((a, b) =>
          increasing ? b[axis] - a[axis] : a[axis] - b[axis]
        );
        for (let i = 0; i < sorted.length - 1; i += 1) {
          const leader = sorted[i];
          const follower = sorted[i + 1];
          const minGap = (leader.lengthPx + follower.lengthPx) / 2 + 2;
          const gap = Math.abs(leader[axis] - follower[axis]);
          if (gap < minGap) {
            if (increasing) {
              follower[axis] = leader[axis] - minGap;
            } else {
              follower[axis] = leader[axis] + minGap;
            }
            follower.speed = Math.min(follower.speed, leader.speed);
          }
        }
      };
      (['east', 'west', 'south', 'north'] as SignalStream[]).forEach((stream) => {
        for (let lane = 1; lane <= 2; lane += 1) {
          const list = signalVehicles.filter(
            (v) =>
              v.stream === stream &&
              v.lane === lane &&
              !(v.movement === 'right' && v.passedStop)
          );
          if (list.length > 1) {
            safePass(
              list,
              stream === 'east' || stream === 'west' ? 'x' : 'y',
              stream === 'east' || stream === 'south'
            );
          }
        }
        const slip = signalVehicles.filter(
          (v) => v.stream === stream && v.lane === 0 && !v.passedStop
        );
        if (slip.length > 1) {
          safePass(
            slip,
            stream === 'east' || stream === 'west' ? 'x' : 'y',
            stream === 'east' || stream === 'south'
          );
        }
      });
      for (let lane = 1; lane <= 2; lane += 1) {
        safePass(uturnVehicles.filter((v) => v.stream === 'east' && v.lane === lane), 'x', true);
        safePass(uturnVehicles.filter((v) => v.stream === 'west' && v.lane === lane), 'x', false);
      }

      // Remove completed vehicles and accumulate journey delay.
      const keepSignal: SimVehicle[] = [];
      for (const v of signalVehicles) {
        const done =
          (v.stream === 'east' && v.x > W + 60) ||
          (v.stream === 'west' && v.x < -60) ||
          (v.stream === 'south' && v.y > H + 60) ||
          (v.stream === 'north' && v.y < -60);
        if (done) {
          // The cross street runs vertically, so its free-flow distance is the
          // canvas height (plus off-screen margins), not the canvas width.
          const freeFlowDistance =
            v.stream === 'east' || v.stream === 'west' ? W + 90 : H + 90;
          const freeFlow =
            freeFlowDistance /
            (v.stream === 'east' || v.stream === 'west'
              ? MAIN_SPEED_PX
              : CROSS_SPEED_PX);
          completedSignal.push({
            time: simTime,
            delay: Math.max(0, simTime - v.departTime - freeFlow),
          });
        } else {
          keepSignal.push(v);
        }
      }
      signalVehicles.length = 0;
      signalVehicles.push(...keepSignal);

      const keepUturn: SimVehicle[] = [];
      for (const v of uturnVehicles) {
        const done = (v.stream === 'east' && v.x > W + 60) || (v.stream === 'west' && v.x < -60);
        if (done) {
          const freeFlow = (W + 90) / MAIN_SPEED_PX;
          completedUturn.push({
            time: simTime,
            delay: Math.max(0, simTime - v.departTime - freeFlow),
          });
        } else {
          keepUturn.push(v);
        }
      }
      uturnVehicles.length = 0;
      uturnVehicles.push(...keepUturn);

      // A signal cycle is ~92 s, so a 60 s sample is shorter than one cycle and
      // systematically over- or under-represents the red-phase arrivals. Keep
      // two full cycles so the measured delay is phase-unbiased.
      const cutoff = simTime - Math.max(65, cycleSec * 2);
      while (completedSignal.length > 0 && completedSignal[0].time < cutoff) completedSignal.shift();
      while (completedUturn.length > 0 && completedUturn[0].time < cutoff) completedUturn.shift();
    };

    const computeLive = (): LiveMetrics => {
      const phase = phases[phaseIndex];
      const countdown = Math.max(0, Math.ceil(phase.duration - phaseElapsed));

      let signalQueueVeh = 0;
      let signalQueueM = 0;
      let signalSpeedSum = 0;
      for (const v of signalVehicles) {
        signalSpeedSum += v.speed;
        if (!v.passedStop && v.speed < 2) {
          signalQueueVeh += 1;
          const stop = STOP_LINE[v.stream as SignalStream];
          const back =
            stop.axis === 'x'
              ? stop.dir === 1
                ? stop.value - (v.x - v.lengthPx / 2)
                : v.x + v.lengthPx / 2 - stop.value
              : stop.dir === 1
              ? stop.value - (v.y - v.lengthPx / 2)
              : v.y + v.lengthPx / 2 - stop.value;
          signalQueueM = Math.max(signalQueueM, Math.max(0, back / PX_PER_M));
        }
      }
      // The physical upstream storage on the approach is 950 m; a live queue
      // cannot exceed it.
      signalQueueM = Math.min(950, signalQueueM);

      const statsWindowSec = Math.max(65, cycleSec * 2);
      const windowSec = Math.max(10, Math.min(statsWindowSec, simTime));
      const signalThroughput =
        (completedSignal.filter((c) => c.time >= simTime - statsWindowSec).length * 3600) /
        windowSec;

      // Do not publish KPIs from the first cycle: the network starts empty and
      // the initial queue is a warm-up artifact, not a steady-state condition.
      const warmup = simTime < cycleSec || completedSignal.length < 20;

      const freeFlowToPosition = (v: SimVehicle): number => {
        if (v.stream === 'east') {
          return Math.max(0, v.x - ENTRY.east.x) / MAIN_SPEED_PX;
        }
        if (v.stream === 'west') {
          return Math.max(0, ENTRY.west.x - v.x) / MAIN_SPEED_PX;
        }
        if (v.stream === 'south') {
          return Math.max(0, v.y - ENTRY.south.y) / CROSS_SPEED_PX;
        }
        return Math.max(0, ENTRY.north.y - v.y) / CROSS_SPEED_PX;
      };

      const completedDelay = completedSignal.reduce((s, c) => s + c.delay, 0);
      const activeDelay = signalVehicles.reduce(
        (s, v) =>
          s + Math.max(0, simTime - v.departTime - freeFlowToPosition(v)),
        0
      );
      const delaySampleCount = completedSignal.length + signalVehicles.length;
      const signalDelay =
        delaySampleCount > 0
          ? (completedDelay + activeDelay) / delaySampleCount
          : 0;

      let uturnQueueM = 0;
      let uturnSpeedSum = 0;
      let uturnActive = 0;
      for (const v of uturnVehicles) {
        uturnSpeedSum += v.speed;
        if (v.stream === 'loop' || v.stream === 'side') uturnActive += 1;
        if (v.speed < 2) {
          // Measure the physical queue back from the U-turn opening (eastbound
          // approach), the side-street stop line, or the westbound merge. The
          // old `x - 180` formula invented ~270 m for one vehicle near the loop.
          let backPx = 0;
          if (v.stream === 'east') backPx = Math.max(0, 455 - v.x);
          else if (v.stream === 'west' && v.x > 455) backPx = v.x - 455;
          else if (v.stream === 'side') backPx = Math.max(0, 92 - v.y);
          uturnQueueM = Math.max(uturnQueueM, backPx / PX_PER_M);
        }
      }
      uturnQueueM = Math.min(950, uturnQueueM);
      const completedUturnDelay = completedUturn.reduce((s, c) => s + c.delay, 0);
      const uturnDelay =
        completedUturn.length > 0
          ? completedUturnDelay / completedUturn.length
          : uturnVehicles.length > 0
          ? uturnVehicles.reduce((s, v) => s + v.stoppedTime, 0) / uturnVehicles.length
          : 0;
      const uturnSpeed =
        uturnVehicles.length > 0
          ? (uturnSpeedSum / uturnVehicles.length / PX_PER_M) * 3.6
          : 0;
      const uturnWarmup = simTime < 30 || completedUturn.length < 20;
      const heavyRatio = Math.max(0, Math.min(0.5, heavyPct / 100));
      const uturnCapacity =
        (4 * 1900 + 1200) * Math.max(0.7, 1 - 0.5 * heavyRatio);
      const uturnVc =
        (effectiveMainFlow + effectiveCrossFlow) / Math.max(1, uturnCapacity);

      const signalLos: Los =
        timing.vcMain > 1.0 || timing.vcCross > 1.0
          ? 'F'
          : losFromDelay(signalDelay, true);
      const uturnLos: Los =
        uturnVc > 1.0 ? 'F' : losFromDelay(uturnDelay, false);

      return {
        phase: phase.name,
        countdown,
        cycleSec: Math.round(cycleSec),
        signalQueueVeh,
        signalQueueM: Math.round(signalQueueM),
        signalDelay: Math.round(signalDelay * 10) / 10,
        signalSpeed:
          signalVehicles.length > 0
            ? Math.round((signalSpeedSum / signalVehicles.length / PX_PER_M) * 3.6 * 10) / 10
            : 0,
        warmup,
        signalThroughput: Math.round(signalThroughput),
        signalLos,
        uturnActive,
        uturnQueueM: Math.round(uturnQueueM),
        uturnDelay: Math.round(uturnDelay * 10) / 10,
        uturnSpeed: Math.round(uturnSpeed * 10) / 10,
        uturnLos,
        uturnWarmup,
      };
    };

    // ---------------------------------------------------------------------
    // Rendering
    // ---------------------------------------------------------------------
    const renderVehicle = (ctx: CanvasRenderingContext2D, v: SimVehicle) => {
      ctx.save();
      ctx.translate(v.x, v.y);
      ctx.rotate(v.angle);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
      ctx.beginPath();
      ctx.roundRect(-v.lengthPx / 2 + 1.5, -v.widthPx / 2 + 1.5, v.lengthPx, v.widthPx, 2.5);
      ctx.fill();
      ctx.fillStyle = v.color;
      ctx.beginPath();
      ctx.roundRect(-v.lengthPx / 2, -v.widthPx / 2, v.lengthPx, v.widthPx, 3);
      ctx.fill();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
      ctx.beginPath();
      ctx.roundRect(-v.lengthPx * 0.25, -v.widthPx * 0.35, v.lengthPx * 0.5, v.widthPx * 0.7, 1.5);
      ctx.fill();
      ctx.fillStyle = '#090d16';
      ctx.fillRect(v.lengthPx * 0.08, -v.widthPx * 0.38, v.lengthPx * 0.24, v.widthPx * 0.76);
      ctx.fillRect(-v.lengthPx * 0.38, -v.widthPx * 0.35, v.lengthPx * 0.14, v.widthPx * 0.7);
      ctx.fillStyle = '#fef08a';
      ctx.fillRect(v.lengthPx / 2 - 1.5, -v.widthPx / 2 + 1, 2, 2.5);
      ctx.fillRect(v.lengthPx / 2 - 1.5, v.widthPx / 2 - 3.5, 2, 2.5);
      if (enableHeadlightsRef.current) {
        const grad = ctx.createRadialGradient(v.lengthPx / 2, 0, 2, v.lengthPx / 2 + 35, 0, 24);
        grad.addColorStop(0, 'rgba(254, 240, 138, 0.28)');
        grad.addColorStop(1, 'rgba(254, 240, 138, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(v.lengthPx / 2, -v.widthPx / 2);
        ctx.lineTo(v.lengthPx / 2 + 40, -18);
        ctx.lineTo(v.lengthPx / 2 + 40, 18);
        ctx.lineTo(v.lengthPx / 2, v.widthPx / 2);
        ctx.closePath();
        ctx.fill();
      }
      if (v.braking || (v.accel !== undefined && v.accel < -0.5) || v.speed < 2) {
        ctx.fillStyle = '#ff2222';
        ctx.shadowColor = '#ff0033';
        ctx.shadowBlur = 12; // Dynamic intense red brake-light glow
        ctx.fillRect(-v.lengthPx / 2 - 1, -v.widthPx / 2 + 1, 3, 2.5);
        ctx.fillRect(-v.lengthPx / 2 - 1, v.widthPx / 2 - 3.5, 3, 2.5);
        // Center High-Mounted Stop Lamp (CHMSL)
        ctx.fillRect(-v.lengthPx / 2 - 1, -0.75, 2.5, 1.5);
      }
      ctx.restore();
    };

    const drawSpeedHeatmap = (ctx: CanvasRenderingContext2D, vehs: SimVehicle[], isRoundabout = false) => {
      if (!showHeatmapRef.current) return;
      ctx.save();
      if (isRoundabout) {
        ctx.beginPath();
        ctx.arc(320, 180, 75, 0, Math.PI * 2);
        ctx.lineWidth = 42;
        ctx.strokeStyle = 'rgba(16, 185, 129, 0.22)';
        ctx.stroke();
        ctx.restore();
        return;
      }
      const eb = vehs.filter((v) => v.stream === 'east' && v.x < 260);
      const ebSpd = eb.length ? (eb.reduce((a, b) => a + b.speed, 0) / eb.length / PX_PER_M) * 3.6 : 60;
      ctx.fillStyle = ebSpd > 40 ? 'rgba(16, 185, 129, 0.22)' : ebSpd > 20 ? 'rgba(245, 158, 11, 0.28)' : 'rgba(239, 68, 68, 0.35)';
      ctx.fillRect(0, 180, 258, 60);

      const wb = vehs.filter((v) => v.stream === 'west' && v.x > 380);
      const wbSpd = wb.length ? (wb.reduce((a, b) => a + b.speed, 0) / wb.length / PX_PER_M) * 3.6 : 60;
      ctx.fillStyle = wbSpd > 40 ? 'rgba(16, 185, 129, 0.22)' : wbSpd > 20 ? 'rgba(245, 158, 11, 0.28)' : 'rgba(239, 68, 68, 0.35)';
      ctx.fillRect(382, 120, W - 382, 60);

      const sb = vehs.filter((v) => v.stream === 'south' && v.y < 120);
      const sbSpd = sb.length ? (sb.reduce((a, b) => a + b.speed, 0) / sb.length / PX_PER_M) * 3.6 : 50;
      ctx.fillStyle = sbSpd > 35 ? 'rgba(16, 185, 129, 0.22)' : sbSpd > 18 ? 'rgba(245, 158, 11, 0.28)' : 'rgba(239, 68, 68, 0.35)';
      ctx.fillRect(260, 0, 60, 118);

      const nb = vehs.filter((v) => v.stream === 'north' && v.y > 240);
      const nbSpd = nb.length ? (nb.reduce((a, b) => a + b.speed, 0) / nb.length / PX_PER_M) * 3.6 : 50;
      ctx.fillStyle = nbSpd > 35 ? 'rgba(16, 185, 129, 0.22)' : nbSpd > 18 ? 'rgba(245, 158, 11, 0.28)' : 'rgba(239, 68, 68, 0.35)';
      ctx.fillRect(320, 242, 60, H - 242);
      ctx.restore();
    };

    const drawVirtualRadars = (ctx: CanvasRenderingContext2D, upSpd: number, downSpd: number) => {
      if (!showRadarRef.current) return;
      ctx.save();
      ctx.strokeStyle = '#06b6d4';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(110, 110);
      ctx.lineTo(110, 250);
      ctx.stroke();
      ctx.font = 'bold 9px JetBrains Mono, monospace';

      const upTxt = `📡 RADAR-UP: ${Math.round(upSpd)} km/h`;
      const upW = Math.max(125, Math.ceil(ctx.measureText(upTxt).width) + 16);
      const upH = 20;
      const upX = 110 - upW / 2;
      const upY = 82;

      ctx.fillStyle = 'rgba(15, 23, 42, 0.95)';
      ctx.strokeStyle = '#06b6d4';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(upX, upY, upW, upH, 4);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#06b6d4';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(upTxt, 110, upY + upH / 2);

      ctx.strokeStyle = '#a855f7';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(530, 110);
      ctx.lineTo(530, 250);
      ctx.stroke();
      ctx.setLineDash([]);

      const downTxt = `📡 RADAR-DN: ${Math.round(downSpd)} km/h`;
      const downW = Math.max(125, Math.ceil(ctx.measureText(downTxt).width) + 16);
      const downH = 20;
      const downX = 530 - downW / 2;
      const downY = 82;

      ctx.fillStyle = 'rgba(15, 23, 42, 0.95)';
      ctx.strokeStyle = '#a855f7';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(downX, downY, downW, downH, 4);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#a855f7';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(downTxt, 530, downY + downH / 2);

      ctx.restore();
    };

    const drawSignalScene = (time: number, targetCtx: CanvasRenderingContext2D = sigCtx) => {
      const sigCtx = targetCtx;
      sigCtx.fillStyle = '#060a12';
      sigCtx.fillRect(0, 0, W, H);
      sigCtx.fillStyle = '#0c1322';
      sigCtx.fillRect(0, 0, W, H);
      sigCtx.fillStyle = '#141d2e';
      sigCtx.fillRect(0, 120, W, 120);
      sigCtx.fillRect(260, 0, 120, H);

      sigCtx.strokeStyle = '#334155';
      sigCtx.lineWidth = 3;
      sigCtx.beginPath();
      sigCtx.moveTo(0, 120);
      sigCtx.lineTo(260, 120);
      sigCtx.lineTo(260, 0);
      sigCtx.stroke();
      sigCtx.beginPath();
      sigCtx.moveTo(380, 0);
      sigCtx.lineTo(380, 120);
      sigCtx.lineTo(W, 120);
      sigCtx.stroke();
      sigCtx.beginPath();
      sigCtx.moveTo(0, 240);
      sigCtx.lineTo(260, 240);
      sigCtx.lineTo(260, H);
      sigCtx.stroke();
      sigCtx.beginPath();
      sigCtx.moveTo(380, H);
      sigCtx.lineTo(380, 240);
      sigCtx.lineTo(W, 240);
      sigCtx.stroke();

      sigCtx.fillStyle = '#0f172a';
      sigCtx.fillRect(260, 120, 120, 120);
      sigCtx.strokeStyle = 'rgba(234, 179, 8, 0.22)';
      sigCtx.lineWidth = 1.5;
      sigCtx.beginPath();
      for (let offset = -120; offset <= 120; offset += 18) {
        sigCtx.moveTo(260 + Math.max(0, offset), 120 + Math.max(0, -offset));
        sigCtx.lineTo(380 + Math.min(0, offset), 240 + Math.min(0, -offset));
        sigCtx.moveTo(260 + Math.max(0, offset), 240 - Math.max(0, -offset));
        sigCtx.lineTo(380 + Math.min(0, offset), 120 - Math.min(0, -offset));
      }
      sigCtx.stroke();

      // Centre lines and lane dividers
      sigCtx.strokeStyle = '#f59e0b';
      sigCtx.lineWidth = 1.5;
      sigCtx.setLineDash([]);
      sigCtx.beginPath();
      sigCtx.moveTo(0, 178);
      sigCtx.lineTo(250, 178);
      sigCtx.moveTo(0, 182);
      sigCtx.lineTo(250, 182);
      sigCtx.moveTo(390, 178);
      sigCtx.lineTo(W, 178);
      sigCtx.moveTo(390, 182);
      sigCtx.lineTo(W, 182);
      sigCtx.moveTo(318, 0);
      sigCtx.lineTo(318, 110);
      sigCtx.moveTo(322, 0);
      sigCtx.lineTo(322, 110);
      sigCtx.moveTo(318, 250);
      sigCtx.lineTo(318, H);
      sigCtx.moveTo(322, 250);
      sigCtx.lineTo(322, H);
      sigCtx.stroke();

      sigCtx.strokeStyle = '#64748b';
      sigCtx.lineWidth = 1.2;
      sigCtx.setLineDash([10, 8]);
      sigCtx.beginPath();
      sigCtx.moveTo(0, 150);
      sigCtx.lineTo(250, 150);
      sigCtx.moveTo(0, 210);
      sigCtx.lineTo(250, 210);
      sigCtx.moveTo(390, 150);
      sigCtx.lineTo(W, 150);
      sigCtx.moveTo(390, 210);
      sigCtx.lineTo(W, 210);
      sigCtx.moveTo(290, 0);
      sigCtx.lineTo(290, 110);
      sigCtx.moveTo(350, 0);
      sigCtx.lineTo(350, 110);
      sigCtx.moveTo(290, 250);
      sigCtx.lineTo(290, H);
      sigCtx.moveTo(350, 250);
      sigCtx.lineTo(350, H);
      sigCtx.stroke();
      sigCtx.setLineDash([]);

      // Stop bars
      sigCtx.strokeStyle = '#f8fafc';
      sigCtx.lineWidth = 3.5;
      sigCtx.beginPath();
      sigCtx.moveTo(258, 182);
      sigCtx.lineTo(258, 240);
      sigCtx.moveTo(382, 120);
      sigCtx.lineTo(382, 178);
      sigCtx.moveTo(260, 118);
      sigCtx.lineTo(318, 118);
      sigCtx.moveTo(322, 242);
      sigCtx.lineTo(380, 242);
      sigCtx.stroke();

      // Zebra crossings
      sigCtx.fillStyle = 'rgba(255, 255, 255, 0.45)';
      const drawZebra = (startX: number, startY: number, width: number, height: number, horizontal: boolean) => {
        if (horizontal) {
          for (let y = startY + 2; y < startY + height - 2; y += 7) sigCtx.fillRect(startX, y, width, 4);
        } else {
          for (let x = startX + 2; x < startX + width - 2; x += 7) sigCtx.fillRect(x, startY, 4, height);
        }
      };
      drawZebra(244, 122, 10, 116, true);
      drawZebra(386, 122, 10, 116, true);
      drawZebra(262, 104, 116, 10, false);
      drawZebra(262, 246, 116, 10, false);

      const drawSignalHead = (x: number, y: number, state: 'GREEN' | 'YELLOW' | 'RED') => {
        sigCtx.save();
        sigCtx.translate(x, y);
        sigCtx.fillStyle = '#090d16';
        sigCtx.strokeStyle = '#475569';
        sigCtx.lineWidth = 1;
        sigCtx.beginPath();
        sigCtx.roundRect(-6, -14, 12, 28, 3);
        sigCtx.fill();
        sigCtx.stroke();
        const lens = (cy: number, on: boolean, color: string, off: string) => {
          sigCtx.fillStyle = on ? color : off;
          if (on) {
            sigCtx.shadowColor = color;
            sigCtx.shadowBlur = 10;
          } else {
            sigCtx.shadowBlur = 0;
          }
          sigCtx.beginPath();
          sigCtx.arc(0, cy, 3, 0, Math.PI * 2);
          sigCtx.fill();
        };
        lens(-8, state === 'RED', '#ef4444', '#450a0a');
        lens(0, state === 'YELLOW', '#f59e0b', '#451a03');
        lens(8, state === 'GREEN', '#10b981', '#022c22');
        sigCtx.restore();
      };

      const mainState = signalStateFor('east');
      const crossState = signalStateFor('south');
      drawSignalHead(248, 252, mainState);
      drawSignalHead(392, 108, mainState);
      drawSignalHead(248, 108, crossState);
      drawSignalHead(392, 252, crossState);

      if (showConflictsRef.current) {
        const pulse = 0.5 + 0.5 * Math.sin(time * 0.006);
        const points = [
          [290, 150],
          [350, 150],
          [290, 210],
          [350, 210],
          [320, 150],
          [320, 210],
          [290, 180],
          [350, 180],
        ];
        points.forEach(([x, y]) => {
          sigCtx.save();
          sigCtx.strokeStyle = `rgba(239, 68, 68, ${0.4 + 0.5 * pulse})`;
          sigCtx.fillStyle = `rgba(239, 68, 68, ${0.2 + 0.2 * pulse})`;
          sigCtx.lineWidth = 1.5;
          sigCtx.beginPath();
          sigCtx.arc(x, y, 6 + 3 * pulse, 0, Math.PI * 2);
          sigCtx.fill();
          sigCtx.stroke();
          sigCtx.fillStyle = '#f87171';
          sigCtx.beginPath();
          sigCtx.arc(x, y, 2.5, 0, Math.PI * 2);
          sigCtx.fill();
          sigCtx.restore();
        });
      }

      drawSpeedHeatmap(sigCtx, signalVehicles);
      drawVirtualRadars(sigCtx, live.signalSpeed > 0 ? live.signalSpeed : 50, 30);
      signalVehicles.forEach((v) => renderVehicle(sigCtx, v));
    };

    const drawUturnScene = (time: number, targetCtx: CanvasRenderingContext2D = uturnCtx) => {
      const uturnCtx = targetCtx;
      uturnCtx.fillStyle = '#060a12';
      uturnCtx.fillRect(0, 0, W, H);
      uturnCtx.fillStyle = '#0c1322';
      uturnCtx.fillRect(0, 0, W, H);
      uturnCtx.fillStyle = '#141d2e';
      uturnCtx.fillRect(0, 110, W, 140);
      uturnCtx.fillRect(160, 0, 50, 120);

      uturnCtx.strokeStyle = '#334155';
      uturnCtx.lineWidth = 3;
      uturnCtx.beginPath();
      uturnCtx.moveTo(0, 110);
      uturnCtx.lineTo(160, 110);
      uturnCtx.lineTo(160, 0);
      uturnCtx.stroke();
      uturnCtx.beginPath();
      uturnCtx.moveTo(210, 0);
      uturnCtx.lineTo(210, 80);
      uturnCtx.quadraticCurveTo(210, 110, 260, 110);
      uturnCtx.lineTo(W, 110);
      uturnCtx.stroke();
      uturnCtx.beginPath();
      uturnCtx.moveTo(0, 250);
      uturnCtx.lineTo(W, 250);
      uturnCtx.stroke();

      // Median barrier with a protected U-turn opening
      uturnCtx.fillStyle = '#1e293b';
      uturnCtx.fillRect(0, 176, 450, 8);
      uturnCtx.fillRect(530, 176, W - 530, 8);
      uturnCtx.fillStyle = '#334155';
      uturnCtx.fillRect(0, 176, 450, 2);
      uturnCtx.fillRect(530, 176, W - 530, 2);
      uturnCtx.fillStyle = '#38bdf8';
      for (let x = 30; x < 440; x += 40) uturnCtx.fillRect(x, 179, 3, 2);
      for (let x = 550; x < W - 20; x += 40) uturnCtx.fillRect(x, 179, 3, 2);

      uturnCtx.fillStyle = '#0f172a';
      uturnCtx.beginPath();
      uturnCtx.arc(490, 180, 36, -Math.PI / 2, Math.PI / 2, false);
      uturnCtx.fill();
      uturnCtx.fillStyle = '#1e293b';
      uturnCtx.strokeStyle = '#475569';
      uturnCtx.lineWidth = 2;
      uturnCtx.beginPath();
      uturnCtx.arc(450, 180, 8, 0, Math.PI * 2);
      uturnCtx.fill();
      uturnCtx.stroke();
      uturnCtx.beginPath();
      uturnCtx.arc(530, 180, 8, 0, Math.PI * 2);
      uturnCtx.fill();
      uturnCtx.stroke();

      uturnCtx.strokeStyle = '#64748b';
      uturnCtx.lineWidth = 1.2;
      uturnCtx.setLineDash([10, 8]);
      uturnCtx.beginPath();
      uturnCtx.moveTo(0, 145);
      uturnCtx.lineTo(W, 145);
      uturnCtx.moveTo(0, 215);
      uturnCtx.lineTo(W, 215);
      uturnCtx.stroke();
      uturnCtx.setLineDash([]);

      uturnCtx.strokeStyle = '#38bdf8';
      uturnCtx.lineWidth = 1.5;
      uturnCtx.setLineDash([6, 6]);
      uturnCtx.beginPath();
      uturnCtx.moveTo(370, 174);
      uturnCtx.lineTo(450, 162);
      uturnCtx.stroke();
      uturnCtx.setLineDash([]);

      const drawChevron = (cx: number, cy: number, rightward: boolean) => {
        uturnCtx.beginPath();
        const dir = rightward ? 1 : -1;
        uturnCtx.moveTo(cx - 8 * dir, cy - 6);
        uturnCtx.lineTo(cx, cy);
        uturnCtx.lineTo(cx - 8 * dir, cy + 6);
        uturnCtx.stroke();
      };
      uturnCtx.strokeStyle = 'rgba(16, 185, 129, 0.4)';
      uturnCtx.lineWidth = 2;
      drawChevron(120, 225, true);
      drawChevron(280, 225, true);
      drawChevron(W - 80, 225, true);
      drawChevron(W - 120, 135, false);
      drawChevron(280, 135, false);
      drawChevron(80, 135, false);

      if (showConflictsRef.current) {
        const pulse = 0.5 + 0.5 * Math.sin(time * 0.005);
        [
          [230, 135],
          [420, 165],
          [490, 180],
          [440, 205],
        ].forEach(([x, y]) => {
          uturnCtx.save();
          uturnCtx.strokeStyle = `rgba(16, 185, 129, ${0.5 + 0.4 * pulse})`;
          uturnCtx.fillStyle = `rgba(16, 185, 129, ${0.15 + 0.15 * pulse})`;
          uturnCtx.lineWidth = 1.5;
          uturnCtx.beginPath();
          uturnCtx.arc(x, y, 7 + 2 * pulse, 0, Math.PI * 2);
          uturnCtx.fill();
          uturnCtx.stroke();
          uturnCtx.fillStyle = '#34d399';
          uturnCtx.beginPath();
          uturnCtx.arc(x, y, 2.5, 0, Math.PI * 2);
          uturnCtx.fill();
          uturnCtx.restore();
        });
      }

      drawSpeedHeatmap(uturnCtx, uturnVehicles);
      drawVirtualRadars(uturnCtx, live.uturnSpeed > 0 ? live.uturnSpeed : 55, 45);
      uturnVehicles.forEach((v) => renderVehicle(uturnCtx, v));
    };

    const drawOpenScene = (ctx: CanvasRenderingContext2D, time: number) => {
      ctx.fillStyle = '#060a12';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#0c1322';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#141d2e';
      ctx.fillRect(0, 120, W, 120);
      ctx.fillRect(260, 0, 120, H);

      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(0, 120);
      ctx.lineTo(260, 120);
      ctx.lineTo(260, 0);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(380, 0);
      ctx.lineTo(380, 120);
      ctx.lineTo(W, 120);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, 240);
      ctx.lineTo(260, 240);
      ctx.lineTo(260, H);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(380, H);
      ctx.lineTo(380, 240);
      ctx.lineTo(W, 240);
      ctx.stroke();

      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, 178);
      ctx.lineTo(W, 178);
      ctx.moveTo(0, 182);
      ctx.lineTo(W, 182);
      ctx.stroke();

      ctx.strokeStyle = '#64748b';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([10, 8]);
      ctx.beginPath();
      ctx.moveTo(0, 150);
      ctx.lineTo(250, 150);
      ctx.moveTo(390, 150);
      ctx.lineTo(W, 150);
      ctx.moveTo(0, 210);
      ctx.lineTo(250, 210);
      ctx.moveTo(390, 210);
      ctx.lineTo(W, 210);
      ctx.moveTo(290, 0);
      ctx.lineTo(290, 110);
      ctx.moveTo(350, 250);
      ctx.lineTo(350, H);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.strokeStyle = '#f8fafc';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(260, 118);
      ctx.lineTo(318, 118);
      ctx.moveTo(322, 242);
      ctx.lineTo(380, 242);
      ctx.stroke();

      const drawStopSign = (x: number, y: number) => {
        ctx.save();
        ctx.translate(x, y);
        ctx.fillStyle = '#dc2626';
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1;
        ctx.beginPath();
        const r = 9;
        for (let i = 0; i < 8; i++) {
          const a = (i * Math.PI) / 4 + Math.PI / 8;
          const px = r * Math.cos(a);
          const py = r * Math.sin(a);
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 7px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(isAr ? 'قف' : 'STOP', 0, 0);
        ctx.restore();
      };
      drawStopSign(250, 110);
      drawStopSign(390, 250);

      if (showConflictsRef.current) {
        const pulse = 0.5 + 0.5 * Math.sin(time * 0.007);
        const crossPts = [
          [290, 150], [320, 150], [350, 150], [290, 180], [320, 180], [350, 180],
          [290, 210], [320, 210], [350, 210], [275, 165], [305, 165], [335, 165],
          [365, 165], [275, 195], [305, 195], [365, 195],
        ];
        crossPts.forEach(([x, y]) => {
          ctx.save();
          ctx.strokeStyle = `rgba(239, 68, 68, ${0.4 + 0.5 * pulse})`;
          ctx.fillStyle = `rgba(239, 68, 68, ${0.25 + 0.25 * pulse})`;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(x, y, 6 + 3 * pulse, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = '#f87171';
          ctx.beginPath();
          ctx.arc(x, y, 2.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        });
        const mergeDivergePts = [
          [260, 150], [260, 210], [380, 150], [380, 210],
          [290, 120], [350, 120], [290, 240], [350, 240],
          [245, 135], [245, 225], [395, 135], [395, 225],
          [275, 105], [365, 105], [275, 255], [365, 255],
        ];
        mergeDivergePts.forEach(([x, y]) => {
          ctx.save();
          ctx.fillStyle = `rgba(245, 158, 11, ${0.4 + 0.3 * pulse})`;
          ctx.beginPath();
          ctx.arc(x, y, 4, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        });
      }

      drawSpeedHeatmap(ctx, signalVehicles);
      drawVirtualRadars(ctx, 45, 25);
      signalVehicles.forEach((v) => renderVehicle(ctx, v));
    };

    const drawRoundaboutScene = (ctx: CanvasRenderingContext2D, time: number) => {
      ctx.fillStyle = '#060a12';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#0c1322';
      ctx.fillRect(0, 0, W, H);

      const cx = 320;
      const cy = 180;
      const rOuter = 95;
      const rInner = 42;

      ctx.fillStyle = '#141d2e';
      ctx.fillRect(0, cy - 55, W, 110);
      ctx.fillRect(cx - 55, 0, 110, H);

      ctx.beginPath();
      ctx.arc(cx, cy, rOuter, 0, Math.PI * 2);
      ctx.fillStyle = '#141d2e';
      ctx.fill();

      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cx, cy, rOuter, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = '#64748b';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([8, 8]);
      ctx.beginPath();
      ctx.arc(cx, cy, 60, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, 78, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.beginPath();
      ctx.arc(cx, cy, rInner, 0, Math.PI * 2);
      ctx.fillStyle = '#064e3b';
      ctx.fill();
      ctx.strokeStyle = '#475569';
      ctx.lineWidth = 3.5;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(cx, cy, 24, 0, Math.PI * 2);
      ctx.fillStyle = '#022c22';
      ctx.fill();
      ctx.strokeStyle = '#10b981';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      const drawSplitter = (angle: number) => {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(angle);
        ctx.fillStyle = '#1e293b';
        ctx.strokeStyle = '#475569';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(rOuter + 6, -6);
        ctx.lineTo(rOuter + 90, -14);
        ctx.lineTo(rOuter + 90, 14);
        ctx.lineTo(rOuter + 6, 6);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      };
      drawSplitter(0);
      drawSplitter(Math.PI / 2);
      drawSplitter(Math.PI);
      drawSplitter((3 * Math.PI) / 2);

      const drawYieldTeeth = (angle: number) => {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(angle);
        ctx.fillStyle = '#f8fafc';
        for (let i = -1; i <= 1; i++) {
          ctx.beginPath();
          ctx.moveTo(rOuter + 3, i * 16 - 5);
          ctx.lineTo(rOuter + 10, i * 16);
          ctx.lineTo(rOuter + 3, i * 16 + 5);
          ctx.closePath();
          ctx.fill();
        }
        ctx.restore();
      };
      drawYieldTeeth(0);
      drawYieldTeeth(Math.PI / 2);
      drawYieldTeeth(Math.PI);
      drawYieldTeeth((3 * Math.PI) / 2);

      if (showConflictsRef.current) {
        const pulse = 0.5 + 0.5 * Math.sin(time * 0.006);
        const roundPts = [
          [cx + rOuter - 6, cy + 24], [cx + rOuter - 6, cy - 24],
          [cx - rOuter + 6, cy + 24], [cx - rOuter + 6, cy - 24],
          [cx + 24, cy + rOuter - 6], [cx - 24, cy + rOuter - 6],
          [cx + 24, cy - rOuter + 6], [cx - 24, cy - rOuter + 6],
        ];
        roundPts.forEach(([x, y]) => {
          ctx.save();
          ctx.strokeStyle = `rgba(16, 185, 129, ${0.5 + 0.4 * pulse})`;
          ctx.fillStyle = `rgba(16, 185, 129, ${0.2 + 0.2 * pulse})`;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(x, y, 7 + 2 * pulse, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = '#34d399';
          ctx.beginPath();
          ctx.arc(x, y, 2.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        });
      }

      drawSpeedHeatmap(ctx, signalVehicles, true);
      drawVirtualRadars(ctx, 36, 32);

      const roundVehiclesCount = 8;
      const baseSpeed = simTime * 0.45;
      for (let i = 0; i < roundVehiclesCount; i++) {
        const laneRadius = i % 3 === 0 ? 52 : i % 3 === 1 ? 69 : 86;
        const ang = (baseSpeed * (60 / laneRadius) + (i * Math.PI * 2) / roundVehiclesCount) % (Math.PI * 2);
        const vx = cx + laneRadius * Math.cos(ang);
        const vy = cy + laneRadius * Math.sin(ang);
        const heading = ang + Math.PI / 2;
        const vDummy: SimVehicle = {
          id: 9000 + i,
          x: vx,
          y: vy,
          angle: heading,
          speed: 8.5 * PX_PER_M,
          spec: sampleVehicleClass(rng, heavyPct),
          color: i % 2 === 0 ? '#38bdf8' : '#fbbf24',
          lengthPx: 18,
          widthPx: 8,
          stream: 'east',
          lane: 1,
          departTime: 0,
          stoppedTime: 0,
          braking: false,
          passedStop: true,
          movement: 'through',
        };
        renderVehicle(ctx, vDummy);
      }
    };

    const renderAlternativeScene = (alt: AlternativeId, ctx: CanvasRenderingContext2D, time: number) => {
      if (alt === 'SIGNAL') {
        drawSignalScene(time, ctx);
      } else if (alt === 'UTURN') {
        drawUturnScene(time, ctx);
      } else if (alt === 'OPEN') {
        drawOpenScene(ctx, time);
      } else if (alt === 'ROUNDABOUT') {
        drawRoundaboutScene(ctx, time);
      }
    };

    const loop = (time: number) => {
      const dtReal = Math.min((time - lastTime) / 1000, 0.1);
      lastTime = time;

      if (isPlayingRef.current) {
        const dtSim = dtReal * simSpeedRef.current;
        const substeps = Math.max(1, Math.ceil(dtSim / (1 / 45)));
        const dtSub = dtSim / substeps;
        for (let i = 0; i < substeps; i += 1) step(dtSub);
      }

      if (time - lastLiveAt > 250) {
        lastLiveAt = time;
        setLive(computeLive());
      }

      renderAlternativeScene(leftAltRef.current, sigCtx, time);
      renderAlternativeScene(rightAltRef.current, uturnCtx, time);

      animFrameRef.current = requestAnimationFrame(loop);
    };

    const animFrameRef = { current: 0 };
    animFrameRef.current = requestAnimationFrame(loop);

    return () => cancelAnimationFrame(animFrameRef.current);
  }, [effectiveMainFlow, effectiveCrossFlow, turningPct, heavyPct, uturnDistanceM, language, resetToken]);

  const handleReset = () => {
    setResetToken((t) => t + 1);
    setLive(initialLive);
  };

  const liveDelayReduction =
    !live.warmup && !live.uturnWarmup && live.signalDelay > 0
      ? Math.max(0, ((live.signalDelay - live.uturnDelay) / live.signalDelay) * 100)
      : 0;

  const signalStateLabel =
    live.phase === 'MAIN_GREEN'
      ? isAr
        ? 'المحور الرئيسي أخضر'
        : 'Main East-West Green'
      : live.phase === 'MAIN_YELLOW'
      ? isAr
        ? 'تهدئة صفراء'
        : 'Amber Clearance'
      : live.phase === 'CROSS_GREEN'
      ? isAr
        ? 'الشارع العرضي أخضر'
        : 'Cross North-South Green'
      : live.phase === 'CROSS_YELLOW'
      ? isAr
        ? 'تهدئة صفراء'
        : 'Amber Clearance'
      : isAr
      ? 'توقف أحمر شامل'
      : 'All-Red Clearance';

  const losColor = (los: Los) =>
    los === 'A' || los === 'B'
      ? 'text-emerald-400 border-emerald-500/40 bg-emerald-500/15'
      : los === 'C'
      ? 'text-cyan-400 border-cyan-500/40 bg-cyan-500/15'
      : los === 'D'
      ? 'text-amber-400 border-amber-500/40 bg-amber-500/15'
      : 'text-rose-400 border-rose-500/40 bg-rose-500/15';

  const getAlternativeMetrics = (alt: AlternativeId) => {
    const plan = alternatives?.find((a) => a.id === alt);
    if (alt === 'SIGNAL') {
      return {
        titleEn: 'Webster 4-Phase Signalized Intersection',
        titleAr: 'تقاطع بإشارة ويبستر رباعية الأطوار',
        conflictBadge: isAr ? '٨ نقاط تعارض حرجة' : '8 Conflict Points',
        conflictPts: 8,
        los: live.signalLos,
        warmup: live.warmup,
        delaySec: live.signalDelay,
        queueM: live.signalQueueM,
        kpi3Label: isAr ? 'التدفق' : 'Throughput',
        kpi3Val: `${Math.round(live.signalThroughput).toLocaleString()} veh/h`,
        collisionType: isAr ? 'تعامد خطير 90°' : 'High T-Bone 90°',
        planDelay: plan?.average_delay_sec ?? signalPlanningDelaySec,
        planQueue: plan?.queue_95th_m ?? signalPlanningQueueM,
        borderColor: 'border-rose-900/40',
        badgeColor: 'bg-rose-500/20 text-rose-300 border-rose-500/30',
        dotColor: 'bg-rose-500',
      };
    }
    if (alt === 'UTURN') {
      return {
        titleEn: 'Protected U-Turn Axis (Continuous Flow)',
        titleAr: 'محور دوران للخلف محمي (تدفق مستمر)',
        conflictBadge: isAr ? '٤ نقاط اندماج آمنة' : '4 Safe Merging Nodes',
        conflictPts: 4,
        los: live.uturnLos,
        warmup: live.uturnWarmup,
        delaySec: live.uturnDelay,
        queueM: live.uturnQueueM,
        kpi3Label: isAr ? 'السرعة' : 'Speed',
        kpi3Val: `${live.uturnSpeed.toFixed(1)} km/h`,
        collisionType: isAr ? 'اندماج زاوية حادة' : 'Low-Angle Merge',
        planDelay: plan?.average_delay_sec ?? uturnPlanningDelaySec,
        planQueue: plan?.queue_95th_m ?? uturnPlanningQueueM,
        borderColor: 'border-emerald-900/40',
        badgeColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
        dotColor: 'bg-emerald-500',
      };
    }
    if (alt === 'OPEN') {
      // No live microsimulation runs for this alternative. Every value must
      // come from the backend HCM/gap-acceptance plan; if the plan is missing
      // the panel shows "—" instead of inventing a delay or queue.
      return {
        titleEn: 'Open Uncontrolled Intersection',
        titleAr: 'تقاطع مفتوح بدون إشارة أو تحكم',
        conflictBadge: isAr ? '٣٢ نقطة تصادم خطرة' : '32 Conflict Points',
        conflictPts: plan?.conflict_points ?? 32,
        los: (plan?.level_of_service as Los) ?? 'A',
        warmup: !plan,
        delaySec: plan?.average_delay_sec ?? 0,
        queueM: plan?.queue_95th_m ?? 0,
        kpi3Label: isAr ? 'التدفق المتاح' : 'Throughput',
        kpi3Val: plan
          ? `${Math.round(plan.estimated_throughput_pce).toLocaleString()} veh/h`
          : '—',
        collisionType: isAr ? 'تصادم متعامد مميت 90°' : 'Fatal 90° T-Bone',
        planDelay: plan?.average_delay_sec,
        planQueue: plan?.queue_95th_m,
        borderColor: 'border-red-950/80',
        badgeColor: 'bg-red-500/20 text-red-300 border-red-500/30',
        dotColor: 'bg-red-500',
      };
    }
    // ROUNDABOUT
    return {
      titleEn: '3-Lane Modern Roundabout',
      titleAr: 'دوار مروري حديث ثلاثي الحارات',
      conflictBadge: isAr ? '٨ نقاط احتكاك منخفضة' : '8 Conflict Points',
      conflictPts: plan?.conflict_points ?? 8,
      los: (plan?.level_of_service as Los) ?? 'A',
      warmup: !plan,
      delaySec: plan?.average_delay_sec ?? 0,
      queueM: plan?.queue_95th_m ?? 0,
      kpi3Label: isAr ? 'التدفق المتاح' : 'Throughput',
      kpi3Val: plan
        ? `${Math.round(plan.estimated_throughput_pce).toLocaleString()} veh/h`
        : '—',
      collisionType: isAr ? 'احتكاك جانبي خفيف 20°' : 'Sideswipe 20°',
      planDelay: plan?.average_delay_sec,
      planQueue: plan?.queue_95th_m,
      borderColor: 'border-cyan-900/40',
      badgeColor: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
      dotColor: 'bg-cyan-500',
    };
  };

  const leftMetrics = getAlternativeMetrics(leftAlt);
  const rightMetrics = getAlternativeMetrics(rightAlt);

  const delayDifferencePct =
    !leftMetrics.warmup &&
    !rightMetrics.warmup &&
    leftMetrics.delaySec > 0
      ? ((leftMetrics.delaySec - rightMetrics.delaySec) / leftMetrics.delaySec) * 100
      : 0;

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-2xl backdrop-blur-md">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-4 pb-3.5 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-gradient-to-br from-emerald-500/20 to-cyan-500/20 border border-emerald-500/30 text-emerald-400 shadow-inner">
            <GitCompare className="w-5 h-5" />
          </div>
          <div>
            <h4 className="text-base font-bold text-slate-100 flex items-center gap-2">
              <span>
                {isAr
                  ? 'المقارنة المرئية التفاعلية: مقارنة البدائل الهندسية الـ 4'
                  : 'Interactive Comparator: 4-Way Geometric Alternatives'}
              </span>
              <span className="text-[10px] bg-cyan-500/20 text-cyan-300 px-2 py-0.5 rounded-full border border-cyan-500/30 font-mono">
                IDM · HCM 6th · Webster
              </span>
            </h4>
            <p className="text-xs text-slate-400 mt-0.5">
              {isAr
                ? 'قارن أي بديلين هندسيين مباشرة بمعدل 60 إطار/ثانية مع حساب التأخير ونقاط التعارض لحظياً'
                : 'Compare any two engineering alternatives live at 60fps with real-time delay and conflict analysis'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center bg-slate-950 rounded-lg p-1 border border-slate-800 text-xs font-mono">
            {([1, 2, 4] as const).map((spd) => (
              <button
                key={spd}
                onClick={() => setSimSpeed(spd)}
                className={`px-2 py-1 rounded transition text-xs font-bold ${
                  simSpeed === spd ? 'bg-emerald-500 text-slate-950' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {spd}x
              </button>
            ))}
          </div>

          <button
            onClick={() => setShowHeatmap(!showHeatmap)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition ${
              showHeatmap
                ? 'bg-rose-500/20 text-rose-300 border-rose-500/40 shadow-sm shadow-rose-500/10'
                : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200'
            }`}
            title={isAr ? 'إظهار / إخفاء خريطة السرعات' : 'Toggle Speed Heatmap Overlay'}
          >
            <Flame className="w-3.5 h-3.5" />
            <span>{isAr ? 'خريطة السرعات' : 'Speed Heatmap'}</span>
          </button>

          <button
            onClick={() => setShowRadar(!showRadar)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition ${
              showRadar
                ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40 shadow-sm shadow-cyan-500/10'
                : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200'
            }`}
            title={isAr ? 'إظهار / إخفاء رادارات القياس' : 'Toggle Virtual Radar Probes'}
          >
            <Radio className="w-3.5 h-3.5" />
            <span>{isAr ? 'رادارات القياس' : 'Virtual Radars'}</span>
          </button>

          <button
            onClick={() => setShowConflicts(!showConflicts)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition ${
              showConflicts
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 shadow-sm shadow-amber-500/10'
                : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200'
            }`}
            title={isAr ? 'إظهار / إخفاء نقاط التعارض' : 'Toggle Conflict Points Overlay'}
          >
            <Flame className="w-3.5 h-3.5" />
            <span>{isAr ? 'نقاط التعارض' : 'Conflict Pts'}</span>
          </button>

          <button
            onClick={() => setEnableHeadlights(!enableHeadlights)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition ${
              enableHeadlights
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 shadow-sm'
                : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200'
            }`}
            title={isAr ? 'تشغيل كشافات المركبات الليلية' : 'Toggle Night Vehicle Headlights'}
          >
            <Eye className="w-3.5 h-3.5" />
            <span>{isAr ? 'كشافات ليلية' : 'Headlights'}</span>
          </button>

          <button
            onClick={() => setIsPlaying(!isPlaying)}
            className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg transition border border-slate-700"
            title={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 fill-slate-200" />}
          </button>

          <button
            onClick={handleReset}
            className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg transition border border-slate-700"
            title={isAr ? 'إعادة ضبط المحاكاة' : 'Reset Simulation'}
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* Left Alternative Panel */}
        <div className={`bg-slate-950/80 p-3.5 rounded-xl border ${leftMetrics.borderColor} shadow-xl flex flex-col justify-between`}>
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2 pb-2 border-b border-slate-800/80">
              <div className="flex items-center gap-2">
                <span className={`w-2.5 h-2.5 rounded-full ${leftMetrics.dotColor} animate-pulse`} />
                <select
                  value={leftAlt}
                  onChange={(e) => setLeftAlt(e.target.value as AlternativeId)}
                  className="bg-slate-900 border border-slate-700 text-xs font-bold text-slate-100 rounded-lg px-2 py-1 outline-none focus:border-cyan-500 cursor-pointer"
                >
                  <option value="SIGNAL">{isAr ? '١. إشارة ويبستر رباعية الأطوار' : '1. Webster 4-Phase Signal'}</option>
                  <option value="UTURN">{isAr ? '٢. محور دوران للخلف محمي' : '2. Protected U-Turn Axis'}</option>
                  <option value="OPEN">{isAr ? '٣. تقاطع مفتوح بدون تحكم' : '3. Open Uncontrolled'}</option>
                  <option value="ROUNDABOUT">{isAr ? '٤. دوار مروري ثلاثي الحارات' : '4. 3-Lane Roundabout'}</option>
                </select>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-[11px] px-2 py-0.5 rounded-full border font-bold ${leftMetrics.badgeColor}`}>
                  {leftMetrics.conflictBadge}
                </span>
                <span className={`text-[11px] px-2 py-0.5 rounded font-mono border font-bold ${losColor(leftMetrics.los)}`}>
                  LOS {leftMetrics.warmup ? '—' : leftMetrics.los}
                </span>
              </div>
            </div>

            <div className="relative rounded-lg overflow-hidden border border-slate-800/80 bg-[#060a12]">
              <canvas ref={signalCanvasRef} width={W} height={H} className="w-full aspect-[16/9] block rounded-lg" />
              {leftAlt === 'SIGNAL' ? (
                <div className="absolute top-2.5 left-2.5 flex items-center gap-2 bg-slate-950/90 border border-slate-800 px-2.5 py-1 rounded-md text-[11px] font-mono shadow-lg backdrop-blur-sm">
                  <span
                    className={`w-2.5 h-2.5 rounded-full ${
                      live.phase.includes('GREEN')
                        ? 'bg-emerald-500 shadow-emerald-500/50 shadow-sm animate-pulse'
                        : live.phase.includes('YELLOW')
                        ? 'bg-amber-500 shadow-amber-500/50 shadow-sm animate-pulse'
                        : 'bg-rose-500 shadow-rose-500/50 shadow-sm'
                    }`}
                  />
                  <span className="text-slate-200 font-semibold">{signalStateLabel}</span>
                  <span className="text-amber-400 font-bold ml-1">{live.countdown}s</span>
                </div>
              ) : (
                <div className="absolute top-2.5 left-2.5 flex items-center gap-2 bg-slate-950/90 border border-slate-800 px-2.5 py-1 rounded-md text-[11px] font-mono shadow-lg backdrop-blur-sm">
                  <span className={`w-2.5 h-2.5 rounded-full ${leftMetrics.dotColor} animate-pulse`} />
                  <span className="text-slate-200 font-semibold">
                    {isAr ? leftMetrics.titleAr : leftMetrics.titleEn}
                  </span>
                </div>
              )}
              <div className="absolute bottom-2.5 right-2.5 bg-slate-950/90 border border-slate-800 px-2.5 py-1 rounded-md text-[11px] font-mono shadow-lg text-slate-300">
                <span className="text-slate-400">{isAr ? 'طول الطابور: ' : 'Queue: '}</span>
                <span className="text-rose-400 font-bold">
                  {leftMetrics.warmup ? '—' : `${Math.round(leftMetrics.queueM)} m`}
                </span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3 pt-2.5 border-t border-slate-800/80 text-center">
            <div className="bg-slate-900/60 p-2 rounded-lg border border-slate-800/60">
              <span className="text-[10px] text-slate-400 block">{isAr ? 'متوسط التأخير' : 'Avg Delay'}</span>
              <span className="text-xs font-bold text-rose-400 font-mono">
                {leftMetrics.warmup ? '—' : `${leftMetrics.delaySec.toFixed(1)} s/veh`}
              </span>
            </div>
            <div className="bg-slate-900/60 p-2 rounded-lg border border-slate-800/60">
              <span className="text-[10px] text-slate-400 block">{isAr ? 'طول الطابور' : 'Queue Length'}</span>
              <span className="text-xs font-bold text-amber-400 font-mono">
                {leftMetrics.warmup ? '—' : `${Math.round(leftMetrics.queueM)} m`}
              </span>
            </div>
            <div className="bg-slate-900/60 p-2 rounded-lg border border-slate-800/60">
              <span className="text-[10px] text-slate-400 block flex items-center justify-center gap-1">
                <Activity className="w-3 h-3" /> {leftMetrics.kpi3Label}
              </span>
              <span className="text-xs font-bold text-cyan-400 font-mono">
                {leftMetrics.warmup ? '—' : leftMetrics.kpi3Val}
              </span>
            </div>
            <div className="bg-slate-900/60 p-2 rounded-lg border border-slate-800/60">
              <span className="text-[10px] text-slate-400 block">{isAr ? 'نوع التصادم' : 'Collision Type'}</span>
              <span className="text-xs font-bold text-rose-400">{leftMetrics.collisionType}</span>
            </div>
          </div>
          {leftMetrics.planDelay !== undefined && leftMetrics.planQueue !== undefined && (
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-500 font-mono">
              <span className="text-slate-400">{isAr ? 'المرجع التحليلي:' : 'Analytical reference:'}</span>
              <span>{leftMetrics.planDelay.toFixed(1)} s/veh</span>
              <span>{Math.round(leftMetrics.planQueue)} m</span>
            </div>
          )}
        </div>

        {/* Right Alternative Panel */}
        <div className={`bg-slate-950/80 p-3.5 rounded-xl border ${rightMetrics.borderColor} shadow-xl flex flex-col justify-between`}>
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2 pb-2 border-b border-slate-800/80">
              <div className="flex items-center gap-2">
                <span className={`w-2.5 h-2.5 rounded-full ${rightMetrics.dotColor} animate-pulse`} />
                <select
                  value={rightAlt}
                  onChange={(e) => setRightAlt(e.target.value as AlternativeId)}
                  className="bg-slate-900 border border-slate-700 text-xs font-bold text-slate-100 rounded-lg px-2 py-1 outline-none focus:border-cyan-500 cursor-pointer"
                >
                  <option value="UTURN">{isAr ? '٢. محور دوران للخلف محمي' : '2. Protected U-Turn Axis'}</option>
                  <option value="SIGNAL">{isAr ? '١. إشارة ويبستر رباعية الأطوار' : '1. Webster 4-Phase Signal'}</option>
                  <option value="OPEN">{isAr ? '٣. تقاطع مفتوح بدون تحكم' : '3. Open Uncontrolled'}</option>
                  <option value="ROUNDABOUT">{isAr ? '٤. دوار مروري ثلاثي الحارات' : '4. 3-Lane Roundabout'}</option>
                </select>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-[11px] px-2 py-0.5 rounded-full border font-bold ${rightMetrics.badgeColor}`}>
                  {rightMetrics.conflictBadge}
                </span>
                <span className={`text-[11px] px-2 py-0.5 rounded font-mono border font-bold ${losColor(rightMetrics.los)}`}>
                  LOS {rightMetrics.warmup ? '—' : rightMetrics.los}
                </span>
              </div>
            </div>

            <div className="relative rounded-lg overflow-hidden border border-slate-800/80 bg-[#060a12]">
              <canvas ref={uturnCanvasRef} width={W} height={H} className="w-full aspect-[16/9] block rounded-lg" />
              {rightAlt === 'SIGNAL' ? (
                <div className="absolute top-2.5 left-2.5 flex items-center gap-2 bg-slate-950/90 border border-slate-800 px-2.5 py-1 rounded-md text-[11px] font-mono shadow-lg backdrop-blur-sm">
                  <span
                    className={`w-2.5 h-2.5 rounded-full ${
                      live.phase.includes('GREEN')
                        ? 'bg-emerald-500 shadow-emerald-500/50 shadow-sm animate-pulse'
                        : live.phase.includes('YELLOW')
                        ? 'bg-amber-500 shadow-amber-500/50 shadow-sm animate-pulse'
                        : 'bg-rose-500 shadow-rose-500/50 shadow-sm'
                    }`}
                  />
                  <span className="text-slate-200 font-semibold">{signalStateLabel}</span>
                  <span className="text-amber-400 font-bold ml-1">{live.countdown}s</span>
                </div>
              ) : (
                <div className="absolute top-2.5 left-2.5 flex items-center gap-2 bg-slate-950/90 border border-slate-800 px-2.5 py-1 rounded-md text-[11px] font-mono shadow-lg backdrop-blur-sm">
                  <span className={`w-2.5 h-2.5 rounded-full ${rightMetrics.dotColor} animate-pulse`} />
                  <span className="text-slate-200 font-semibold">
                    {isAr ? rightMetrics.titleAr : rightMetrics.titleEn}
                  </span>
                </div>
              )}
              <div className="absolute bottom-2.5 right-2.5 bg-slate-950/90 border border-slate-800 px-2.5 py-1 rounded-md text-[11px] font-mono shadow-lg text-slate-300">
                <span className="text-slate-400">{isAr ? 'طول الطابور: ' : 'Queue: '}</span>
                <span className="text-emerald-400 font-bold">
                  {rightMetrics.warmup ? '—' : `${Math.round(rightMetrics.queueM)} m`}
                </span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3 pt-2.5 border-t border-slate-800/80 text-center">
            <div className="bg-slate-900/60 p-2 rounded-lg border border-slate-800/60">
              <span className="text-[10px] text-slate-400 block">{isAr ? 'متوسط التأخير' : 'Avg Delay'}</span>
              <span className="text-xs font-bold text-emerald-400 font-mono">
                {rightMetrics.warmup ? '—' : `${rightMetrics.delaySec.toFixed(1)} s/veh`}
              </span>
            </div>
            <div className="bg-slate-900/60 p-2 rounded-lg border border-slate-800/60">
              <span className="text-[10px] text-slate-400 block">{isAr ? 'طول الطابور' : 'Queue Length'}</span>
              <span className="text-xs font-bold text-emerald-400 font-mono">
                {rightMetrics.warmup ? '—' : `${Math.round(rightMetrics.queueM)} m`}
              </span>
            </div>
            <div className="bg-slate-900/60 p-2 rounded-lg border border-slate-800/60">
              <span className="text-[10px] text-slate-400 block flex items-center justify-center gap-1">
                <Gauge className="w-3 h-3" /> {rightMetrics.kpi3Label}
              </span>
              <span className="text-xs font-bold text-emerald-400 font-mono">
                {rightMetrics.warmup ? '—' : rightMetrics.kpi3Val}
              </span>
            </div>
            <div className="bg-slate-900/60 p-2 rounded-lg border border-slate-800/60">
              <span className="text-[10px] text-slate-400 block">{isAr ? 'نوع التصادم' : 'Collision Type'}</span>
              <span className="text-xs font-bold text-emerald-400">{rightMetrics.collisionType}</span>
            </div>
          </div>
          {rightMetrics.planDelay !== undefined && rightMetrics.planQueue !== undefined && (
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-500 font-mono">
              <span className="text-slate-400">{isAr ? 'المرجع التحليلي:' : 'Analytical reference:'}</span>
              <span>{rightMetrics.planDelay.toFixed(1)} s/veh</span>
              <span>{Math.round(rightMetrics.planQueue)} m</span>
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 p-3 rounded-xl bg-gradient-to-r from-emerald-950/30 via-slate-950 to-cyan-950/30 border border-emerald-500/20 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2.5">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span className="text-slate-300 leading-relaxed">
            {leftMetrics.warmup || rightMetrics.warmup ? (
              <span className="text-slate-400">
                {isAr
                  ? 'جاري تسخين المحاكاة لدورة إشارة كاملة قبل نشر المؤشرات…'
                  : 'Warming up for one full cycle before publishing KPIs…'}
              </span>
            ) : isAr ? (
              <>
                <strong className="text-emerald-400 font-semibold">مقارنة حية: </strong>
                البديل الأيمن ({isAr ? rightMetrics.titleAr : rightMetrics.titleEn}) يحقق فارق تأخير بنسبة{' '}
                <strong>{Math.abs(delayDifferencePct).toFixed(0)}%</strong>{' '}
                {delayDifferencePct >= 0 ? 'انخفاضاً' : 'ارتفاعاً'} مقارنة بالبديل الأيسر، مع{' '}
                <strong>{rightMetrics.conflictPts} نقاط تعارض</strong> مقابل <strong>{leftMetrics.conflictPts} نقاط</strong>.
              </>
            ) : (
              <>
                <strong className="text-emerald-400 font-semibold">Live Comparison: </strong>
                {rightMetrics.titleEn} yields a{' '}
                <strong>{Math.abs(delayDifferencePct).toFixed(0)}%</strong>{' '}
                {delayDifferencePct >= 0 ? 'delay reduction' : 'delay increase'} versus {leftMetrics.titleEn}, with{' '}
                <strong>{rightMetrics.conflictPts} conflict points</strong> versus <strong>{leftMetrics.conflictPts}</strong>.
              </>
            )}
          </span>
        </div>
        <span className="text-[10px] font-mono text-slate-500">
          {simSpeed}x · IDM · Poisson · {leftAlt} vs {rightAlt}
        </span>
      </div>
    </div>
  );
};

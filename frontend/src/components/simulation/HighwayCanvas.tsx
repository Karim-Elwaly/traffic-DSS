import React, { useEffect, useRef, useState } from 'react';
import { Play, Pause, RefreshCw, Eye, Activity, Gauge } from 'lucide-react';
import {
  VehicleClassSpec,
  averagePce,
  exponential,
  idmAcceleration,
  makeRng,
  pceToVehicleFlow,
  pickColor,
  sampleVehicleClass,
} from '../../simulation/microsim';

interface HighwayCanvasProps {
  closedLanes: number[]; // 1 = rightmost/slow lane ... 4 = leftmost/fast lane
  speedLimitKmh: number;
  demandPce: number;
  capacityPce: number;
  weavingIndex?: number;
  language?: 'en' | 'ar';
  heavyPct?: number;
}

interface Vehicle {
  id: number;
  xM: number;
  lane: number;
  laneVisual: number;
  speed: number;
  spec: VehicleClassSpec;
  color: string;
  lengthM: number;
  widthPx: number;
  departTime: number;
  braking: boolean;
  mergeCooldown: number;
  laneChanges: number;
}

interface LiveStats {
  throughputPce: number;
  queueM: number;
  peakQueueM: number;
  avgDelaySec: number;
  avgSpeedKmh: number;
  active: number;
  completed: number;
  laneChanges: number;
  avgPce: number;
  warmup: boolean;
}

// ---------------------------------------------------------------------------
// World geometry: 300 m of 4-lane arterial mapped onto an 800 px canvas.
// ---------------------------------------------------------------------------
const W = 800;
const H = 205;
const NETWORK_M = 300;
const PX_PER_M = W / NETWORK_M; // 2.667 px / m
const ROAD_TOP = 30;
const LANE_H = 36;
const TAPER_START_M = 130;
const TAPER_END_M = 165;
const ENTRY_M = -5;
const EXIT_M = NETWORK_M + 8;
const MAX_UPSTREAM_STORAGE_M = 180;
const WORK_ZONE_SPEED_KMH = 60;
const UPDATE_HZ = 5;

const laneCenterY = (lane: number) =>
  ROAD_TOP + (4 - lane) * LANE_H + LANE_H / 2;

const laneCenterOf = (laneVisual: number) =>
  ROAD_TOP + (4 - laneVisual) * LANE_H + LANE_H / 2;

export const HighwayCanvas: React.FC<HighwayCanvasProps> = ({
  closedLanes,
  speedLimitKmh,
  demandPce,
  capacityPce,
  weavingIndex = 0.2,
  language = 'en',
  heavyPct = 12,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(true);
  const [simSpeed, setSimSpeed] = useState<1 | 2>(1);
  const [resetToken, setResetToken] = useState(0);
  const [live, setLive] = useState<LiveStats>({
    throughputPce: 0,
    queueM: 0,
    peakQueueM: 0,
    avgDelaySec: 0,
    avgSpeedKmh: 0,
    active: 0,
    completed: 0,
    laneChanges: 0,
    avgPce: averagePce(heavyPct),
    warmup: true,
  });

  const isPlayingRef = useRef(true);
  const simSpeedRef = useRef<1 | 2>(1);
  const languageRef = useRef(language);
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);
  useEffect(() => {
    simSpeedRef.current = simSpeed;
  }, [simSpeed]);
  useEffect(() => {
    languageRef.current = language;
  }, [language]);

  const vehiclesRef = useRef<Vehicle[]>([]);
  const nextIdRef = useRef(1);
  const animationFrameIdRef = useRef<number | null>(null);
  const completedRef = useRef<Array<{ time: number; pce: number; delay: number }>>([]);
  const totalCompletedRef = useRef(0);
  const totalLaneChangesRef = useRef(0);
  const peakQueueRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // A changed scenario is a new run: clear the old state before warm-starting.
    vehiclesRef.current = [];
    completedRef.current = [];
    totalCompletedRef.current = 0;
    totalLaneChangesRef.current = 0;
    nextIdRef.current = 1;
    peakQueueRef.current = 0;

    const rng = makeRng(0x5eed + closedLanes.reduce((a, b) => a + b * 17, 0));
    const avgPce = averagePce(heavyPct);
    const vehPerSec = pceToVehicleFlow(demandPce, heavyPct) / 3600;
    const meanInterArrival = vehPerSec > 0 ? 1 / vehPerSec : 1e9;

    let simClock = 0;
    let nextArrival = exponential(rng, meanInterArrival);
    let lastTime = performance.now();
    let lastStatsAt = 0;

    const isOpen = (lane: number) => !closedLanes.includes(lane);

    const laneVehicles = (lane: number) =>
      vehiclesRef.current.filter((v) => v.lane === lane);

    const gapToLeader = (veh: Vehicle) => {
      let gap = Infinity;
      let leaderSpeed = veh.speed;
      for (const other of vehiclesRef.current) {
        if (other.id === veh.id || other.lane !== veh.lane) continue;
        if (other.xM > veh.xM) {
          const g = other.xM - veh.xM - (veh.lengthM + other.lengthM) / 2;
          if (g < gap) {
            gap = g;
            leaderSpeed = other.speed;
          }
        }
      }
      return { gap, leaderSpeed };
    };

    const laneGapForInsertion = (lane: number, x: number, lengthM: number) => {
      let rear = -Infinity;
      let front = Infinity;
      for (const v of vehiclesRef.current) {
        if (v.lane !== lane) continue;
        if (v.xM < x) rear = Math.max(rear, v.xM + v.lengthM / 2);
        else front = Math.min(front, v.xM - v.lengthM / 2);
      }
      return {
        behind: rear === -Infinity ? Infinity : x - lengthM / 2 - rear,
        ahead: front === Infinity ? Infinity : front - (x + lengthM / 2),
      };
    };

    const chooseLane = (spec: VehicleClassSpec): number => {
      // Vehicles are allowed to enter a lane that closes at the taper: this is
      // what produces the observed mandatory-merge and queue behaviour instead
      // of silently removing demand from the closed lane. In reality most
      // drivers read the advance warning and avoid the closed lane; only a
      // minority (late mergers, typically heavy vehicles) stay in it until the
      // taper. Sending the full lane share into the closure created an
      // artificial permanent queue that never discharged.
      const allLanes = [1, 2, 3, 4];
      const open = allLanes.filter(isOpen);
      if (open.length === 0) return 1;
      let preferred: number[];
      if (spec.kind === 'truck' || spec.kind === 'bus') {
        preferred = allLanes.filter((l) => l <= 2);
      } else if (spec.kind === 'car') {
        preferred = allLanes.filter((l) => l >= 3);
      } else {
        preferred = allLanes;
      }
      const openPreferred = preferred.filter(isOpen);
      const closedPreferred = preferred.filter((l) => !isOpen(l));
      // 18% late-merge share for classes whose preferred lane is closed.
      if (closedPreferred.length > 0 && rng() < 0.18) {
        return closedPreferred[
          Math.min(closedPreferred.length - 1, Math.floor(rng() * closedPreferred.length))
        ];
      }
      const pool = openPreferred.length > 0 ? openPreferred : open;
      return pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))];
    };

    const insertVehicle = () => {
      const spec = sampleVehicleClass(rng, heavyPct);
      const lane = chooseLane(spec);
      // Insert at the upstream boundary unless a vehicle is still sitting at
      // or before that boundary. Placing every arrival immediately behind the
      // rearmost vehicle (wherever it is) silently teleports demand downstream
      // and starves the network of vehicles.
      const laneList = laneVehicles(lane).sort((a, b) => a.xM - b.xM);
      const rear = laneList[0];
      let x = ENTRY_M;
      if (rear && rear.xM < ENTRY_M + 20) {
        x = rear.xM - (rear.lengthM / 2 + spec.minGapM + 1.5 + spec.lengthM / 2);
      }
      if (x < -MAX_UPSTREAM_STORAGE_M) return; // upstream storage is full

      const gaps = laneGapForInsertion(lane, x, spec.lengthM);
      if (gaps.behind < 1.2 || (Number.isFinite(gaps.ahead) && gaps.ahead < spec.minGapM)) {
        return;
      }

      vehiclesRef.current.push({
        id: nextIdRef.current++,
        xM: x,
        lane,
        laneVisual: lane,
        speed: speedLimitKmh / 3.6,
        spec,
        color: pickColor(rng, spec),
        lengthM: spec.lengthM,
        widthPx: Math.max(7, spec.widthM * 3.4),
        departTime: simClock,
        braking: false,
        mergeCooldown: 0,
        laneChanges: 0,
      });
    };

    // Warm-start the network at its equilibrium density instead of showing an
    // empty road for the first 10-20 seconds. Pre-filled vehicles get a
    // departTime that corresponds to free-flow travel from the entry, so they
    // do not create phantom delay when they leave the network.
    const prefillNetwork = () => {
      const freeSpeed = speedLimitKmh / 3.6;
      const openLaneCount = Math.max(
        1,
        [1, 2, 3, 4].filter((lane) => isOpen(lane)).length
      );
      // Equilibrium spacing from the measured physical flow, not the PCE
      // demand: density = flow / speed, so spacing = speed / per-lane flow.
      // This keeps the warm start consistent with the arrival process instead
      // of seeding an arbitrary number of cars.
      const perLaneVehPerSec = vehPerSec / openLaneCount;
      for (let lane = 1; lane <= 4; lane += 1) {
        const closed = !isOpen(lane);
        // The closed lane only carries the late-merge minority, so it must be
        // seeded more sparsely than an open lane.
        const laneSpacing = closed
          ? Math.max(25, Math.min(600, freeSpeed / Math.max(0.01, perLaneVehPerSec * 0.18)))
          : Math.max(14, Math.min(300, freeSpeed / Math.max(0.02, perLaneVehPerSec)));
        let x = ENTRY_M + rng() * laneSpacing;
        let guard = 0;
        while (x < EXIT_M - 4 && guard < 80) {
          guard += 1;
          // A closed lane only exists upstream of the taper nose. Never place
          // a vehicle inside the closed work-zone section.
          if (closed && x > TAPER_START_M - 8) break;
          const spec = sampleVehicleClass(rng, heavyPct);
          const minSpacing = spec.lengthM + spec.minGapM + 0.5;
          const departTime = -(x - ENTRY_M) / Math.max(4, freeSpeed);
          vehiclesRef.current.push({
            id: nextIdRef.current++,
            xM: x,
            lane,
            laneVisual: lane,
            speed: freeSpeed,
            spec,
            color: pickColor(rng, spec),
            lengthM: spec.lengthM,
            widthPx: Math.max(7, spec.widthM * 3.4),
            departTime,
            braking: false,
            mergeCooldown: 0,
            laneChanges: 0,
          });
          x += Math.max(laneSpacing, minSpacing) * (0.85 + rng() * 0.3);
        }
      }
    };

    prefillNetwork();

    const tryLaneChange = (veh: Vehicle, targetLane: number, now: number) => {
      if (veh.mergeCooldown > 0 || targetLane === veh.lane) return;
      if (!isOpen(targetLane)) return;

      const distToClosure = TAPER_END_M - veh.xM;
      const urgent = distToClosure < 55;
      // Dense traffic leaves only a couple of metres of clear gap. A zipper
      // merge is still physically possible when the follower has at least
      // ~1 s of headway and can brake, so the old absolute-speed test (which
      // required the follower to be no faster than the merging vehicle)
      // deadlocked stopped lane-1 vehicles at the taper.
      const requiredAhead = urgent ? 2.0 : 10 + veh.speed * 0.9;
      const requiredBehind = urgent ? 1.5 : 6 + veh.speed * 0.4;

      let aheadGap = Infinity;
      let aheadSpeed = veh.speed;
      let behindGap = Infinity;
      let behindSpeed = 0;
      for (const other of vehiclesRef.current) {
        if (other.id === veh.id || other.lane !== targetLane) continue;
        if (other.xM >= veh.xM) {
          const g = other.xM - veh.xM - (veh.lengthM + other.lengthM) / 2;
          if (g < aheadGap) {
            aheadGap = g;
            aheadSpeed = other.speed;
          }
        } else {
          const g = veh.xM - other.xM - (veh.lengthM + other.lengthM) / 2;
          if (g < behindGap) {
            behindGap = g;
            behindSpeed = other.speed;
          }
        }
      }

      const closingSpeed = Math.max(0, behindSpeed - veh.speed);
      const safe =
        aheadGap >= requiredAhead &&
        behindGap >= requiredBehind &&
        behindGap >= closingSpeed * 0.9;
      if (!safe) return;

      veh.lane = targetLane;
      veh.mergeCooldown = 2.5;
      veh.laneChanges += 1;
      totalLaneChangesRef.current += 1;
      if (urgent) veh.braking = aheadGap < 12;
      void now;
    };

    const step = (dtSim: number) => {
      simClock += dtSim;

      // Poisson arrivals
      let guard = 0;
      while (simClock >= nextArrival && guard < 20) {
        insertVehicle();
        nextArrival += exponential(rng, meanInterArrival);
        guard += 1;
      }

      const wzSpeed = Math.min(speedLimitKmh, WORK_ZONE_SPEED_KMH) / 3.6;

      for (const veh of vehiclesRef.current) {
        veh.mergeCooldown = Math.max(0, veh.mergeCooldown - dtSim);

        // Mandatory merge out of a closed lane inside the advance-warning
        // zone. Before this point vehicles may legitimately still use the lane.
        if (
          !isOpen(veh.lane) &&
          veh.xM > TAPER_START_M - 70 &&
          veh.xM < TAPER_END_M
        ) {
          const candidates = [veh.lane - 1, veh.lane + 1, veh.lane - 2, veh.lane + 2]
            .filter((l) => l >= 1 && l <= 4 && isOpen(l));
          candidates.sort((a, b) => Math.abs(a - veh.lane) - Math.abs(b - veh.lane));
          if (candidates.length > 0) {
            tryLaneChange(veh, candidates[0], simClock);
          }
        } else if (veh.spec.kind === 'microbus' && weavingIndex > 0.35) {
          // Egyptian microbus weaving, but only when a safe gap exists.
          if (rng() < weavingIndex * 0.08 * dtSim) {
            const target = veh.lane + (rng() < 0.5 ? -1 : 1);
            if (target >= 1 && target <= 4) tryLaneChange(veh, target, simClock);
          }
        }

        let desired = speedLimitKmh / 3.6;
        if (veh.xM > TAPER_START_M - 45) desired = Math.min(desired, wzSpeed);
        if (!isOpen(veh.lane)) desired = Math.min(desired, wzSpeed * 0.75);

        let { gap, leaderSpeed } = gapToLeader(veh);

        // A closed lane has a physical barrier at the taper nose.
        if (!isOpen(veh.lane) && veh.xM < TAPER_END_M) {
          const barrierGap = TAPER_END_M - 0.6 - veh.xM - veh.lengthM / 2;
          if (barrierGap < gap) {
            gap = barrierGap;
            leaderSpeed = 0;
          }
          if (barrierGap < 30) desired = Math.min(desired, 4.0);
        }

        // Zipper-merge courtesy: yield to a vehicle merging out of the closed
        // lane near the taper so a genuine gap opens instead of deadlocking.
        for (const other of vehiclesRef.current) {
          if (other.id === veh.id) continue;
          if (Math.abs(other.lane - veh.lane) !== 1) continue;
          if (isOpen(other.lane)) continue;
          if (other.xM < TAPER_END_M - 35) continue;
          if (Math.abs(other.xM - veh.xM) < 16) {
            desired = Math.min(desired, Math.max(5.0, veh.speed * 0.85));
          }
        }

        const accel = idmAcceleration(
          veh.speed,
          Math.max(0, desired * veh.spec.speedFactor),
          Math.max(0.1, gap),
          leaderSpeed,
          veh.spec
        );
        veh.speed = Math.max(0, veh.speed + accel * dtSim);
        veh.xM += veh.speed * dtSim;
        // Physical barrier at the taper nose: a vehicle that could not merge
        // must stop at the closure instead of driving through the work zone.
        if (!isOpen(veh.lane) && veh.xM > TAPER_END_M - veh.lengthM / 2 - 0.2) {
          veh.xM = TAPER_END_M - veh.lengthM / 2 - 0.2;
          veh.speed = 0;
        }
        veh.braking = accel < -0.35 || (veh.speed < 1.0 && desired > 1.0);
        veh.laneVisual += (veh.lane - veh.laneVisual) * Math.min(1, dtSim * 5.5);
      }

      // Hard safety pass: no bumper overlap inside a lane.
      for (let lane = 1; lane <= 4; lane += 1) {
        const list = vehiclesRef.current
          .filter((v) => v.lane === lane)
          .sort((a, b) => b.xM - a.xM);
        for (let i = 0; i < list.length - 1; i += 1) {
          const leader = list[i];
          const follower = list[i + 1];
          const minGap = (leader.lengthM + follower.lengthM) / 2 + follower.spec.minGapM * 0.6;
          const gap = leader.xM - follower.xM;
          if (gap < minGap) {
            follower.xM = leader.xM - minGap;
            follower.speed = Math.min(follower.speed, leader.speed);
          }
        }
      }

      // Record completed trips at the downstream boundary.
      const remaining: Vehicle[] = [];
      for (const veh of vehiclesRef.current) {
        if (veh.xM > EXIT_M) {
          const freeFlowTime =
            (EXIT_M - ENTRY_M) / Math.max(8, speedLimitKmh / 3.6);
          completedRef.current.push({
            time: simClock,
            pce: veh.spec.pce,
            delay: Math.max(0, simClock - veh.departTime - freeFlowTime),
          });
          totalCompletedRef.current += 1;
        } else {
          remaining.push(veh);
        }
      }
      vehiclesRef.current = remaining;

      const cutoff = simClock - 65;
      completedRef.current = completedRef.current.filter((c) => c.time >= cutoff);
    };

    const computeStats = (): LiveStats => {
      const windowSec = Math.max(10, Math.min(60, simClock));
      const recent = completedRef.current.filter((c) => c.time >= simClock - 60);
      const throughput = (recent.reduce((s, c) => s + c.pce, 0) * 3600) / windowSec;
      const warmup = simClock < 12 || totalCompletedRef.current < 5;

      let queueM = 0;
      for (let lane = 1; lane <= 4; lane += 1) {
        const queued = vehiclesRef.current.filter(
          (v) => v.lane === lane && v.speed < 1.0 && v.xM < TAPER_END_M
        );
        if (queued.length > 0) {
          const back = TAPER_END_M - Math.min(...queued.map((v) => v.xM - v.lengthM / 2));
          queueM = Math.max(queueM, Math.max(0, back));
        }
      }
      peakQueueRef.current = Math.max(peakQueueRef.current, queueM);

      const allCompleted = completedRef.current;
      const avgDelay =
        allCompleted.length > 0
          ? allCompleted.reduce((s, c) => s + c.delay, 0) / allCompleted.length
          : 0;
      const avgSpeed =
        vehiclesRef.current.length > 0
          ? (vehiclesRef.current.reduce((s, v) => s + v.speed, 0) /
              vehiclesRef.current.length) *
            3.6
          : 0;

      return {
        throughputPce: Math.round(throughput),
        queueM: Math.round(queueM * 10) / 10,
        peakQueueM: Math.round(peakQueueRef.current * 10) / 10,
        avgDelaySec: Math.round(avgDelay * 10) / 10,
        avgSpeedKmh: Math.round(avgSpeed * 10) / 10,
        active: vehiclesRef.current.length,
        completed: totalCompletedRef.current,
        laneChanges: totalLaneChangesRef.current,
        avgPce: Math.round(avgPce * 100) / 100,
        warmup,
      };
    };

    const render = (time: number) => {
      const dtReal = Math.min((time - lastTime) / 1000, 0.1);
      lastTime = time;

      if (isPlayingRef.current) {
        // Fixed 30 Hz physics sub-steps keep IDM stable at 1x and 2x speed.
        const dtSimTotal = dtReal * simSpeedRef.current;
        const subSteps = Math.max(1, Math.ceil(dtSimTotal / (1 / 30)));
        const dtSub = dtSimTotal / subSteps;
        for (let s = 0; s < subSteps; s += 1) step(dtSub);
      }

      const frameStats = computeStats();
      if (time - lastStatsAt > 1000 / UPDATE_HZ) {
        lastStatsAt = time;
        setLive(frameStats);
      }

      // ---------------------------------------------------------------------
      // Draw road, closure taper, work zone and vehicles.
      // ---------------------------------------------------------------------
      ctx.clearRect(0, 0, W, H);
      // The page is RTL in Arabic; canvas text must stay LTR so signs and lane
      // labels are not mirrored or clipped.
      ctx.direction = 'ltr';
      ctx.textAlign = 'start';
      ctx.fillStyle = '#060a12';
      ctx.fillRect(0, 0, W, H);

      const roadBottom = ROAD_TOP + 4 * LANE_H;
      ctx.fillStyle = '#0b0f19';
      ctx.fillRect(0, ROAD_TOP, W, 4 * LANE_H);

      // Shoulders
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(0, ROAD_TOP);
      ctx.lineTo(W, ROAD_TOP);
      ctx.moveTo(0, roadBottom);
      ctx.lineTo(W, roadBottom);
      ctx.stroke();

      // Lane dividers
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([12, 10]);
      for (let i = 1; i < 4; i += 1) {
        const y = ROAD_TOP + i * LANE_H;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        ctx.stroke();
      }
      ctx.setLineDash([]);

      // Lane labels (Lane 4 is the fast/top lane, Lane 1 the slow/bottom lane)
      ctx.font = '10px JetBrains Mono, monospace';
      for (let lane = 1; lane <= 4; lane += 1) {
        const y = laneCenterY(lane) + 3;
        const closed = !isOpen(lane);
        ctx.fillStyle = closed ? '#ef4444' : '#64748b';
        ctx.fillText(`L${lane}${closed ? ' ✕' : ''}`, 8, y);
      }

      const taperStartX = TAPER_START_M * PX_PER_M;
      const taperEndX = TAPER_END_M * PX_PER_M;

      // Work-zone carpet on closed lanes
      for (const lane of closedLanes) {
        const laneTop = ROAD_TOP + (4 - lane) * LANE_H;
        ctx.fillStyle = 'rgba(239, 68, 68, 0.16)';
        ctx.fillRect(taperStartX, laneTop, W - taperStartX, LANE_H);
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(taperStartX, laneTop + LANE_H / 2);
        ctx.lineTo(W, laneTop + LANE_H / 2);
        ctx.stroke();

        // Cones along the taper
        const steps = 10;
        for (let s = 0; s <= steps; s += 1) {
          const coneX = taperStartX + (s / steps) * (taperEndX - taperStartX);
          const coneY =
            laneTop + LANE_H * 0.82 - (s / steps) * (LANE_H * 0.62);
          ctx.fillStyle = '#f97316';
          ctx.beginPath();
          ctx.arc(coneX, coneY, 3.4, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(coneX, coneY, 1.4, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Work-zone speed sign
      ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(taperStartX + 8, ROAD_TOP - 28, 62, 21, 4);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#fbbf24';
      ctx.font = 'bold 11px JetBrains Mono, monospace';
      ctx.fillText(`${WORK_ZONE_SPEED_KMH} km/h`, taperStartX + 13, ROAD_TOP - 13);

      // Vehicles
      for (const v of vehiclesRef.current) {
        const xPx = v.xM * PX_PER_M;
        if (xPx < -60 || xPx > W + 60) continue;
        const y = laneCenterOf(v.laneVisual);
        const lengthPx = Math.max(11, v.lengthM * PX_PER_M * 1.35);
        const widthPx = v.widthPx;

        ctx.save();
        ctx.translate(xPx, y);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
        ctx.fillRect(-lengthPx / 2 + 2, -widthPx / 2 + 2, lengthPx, widthPx);
        ctx.fillStyle = v.color;
        ctx.beginPath();
        ctx.roundRect(-lengthPx / 2, -widthPx / 2, lengthPx, widthPx, 2.5);
        ctx.fill();
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(lengthPx * 0.04, -widthPx * 0.35, lengthPx * 0.2, widthPx * 0.7);
        ctx.fillStyle = '#f8fafc';
        ctx.fillRect(lengthPx / 2 - 2, -widthPx / 2 + 1, 2, 2);
        ctx.fillRect(lengthPx / 2 - 2, widthPx / 2 - 3, 2, 2);
        if (v.braking) {
          ctx.fillStyle = '#ef4444';
          ctx.shadowColor = '#ef4444';
          ctx.shadowBlur = 6;
          ctx.fillRect(-lengthPx / 2, -widthPx / 2 + 1, 2, 2);
          ctx.fillRect(-lengthPx / 2, widthPx / 2 - 3, 2, 2);
        }
        // Amber turn signal while merging
        if (!isOpen(v.lane) || v.mergeCooldown > 2.2) {
          ctx.fillStyle = '#f59e0b';
          ctx.shadowColor = '#f59e0b';
          ctx.shadowBlur = 5;
          ctx.fillRect(lengthPx / 2 - 2, -widthPx / 2 + 1, 2, 2.5);
        }
        ctx.restore();
      }

      // Queue and backpressure overlay
      if (frameStats.queueM > 30) {
        ctx.fillStyle = 'rgba(239, 68, 68, 0.95)';
        ctx.font = 'bold 11px Inter, Cairo, sans-serif';
        const txt =
          languageRef.current === 'ar'
            ? `⚠ ارتداد طابور ${Math.round(frameStats.queueM)} م — دمج إجباري`
            : `⚠ ${Math.round(frameStats.queueM)} m queue — mandatory merge`;
        ctx.fillText(txt, Math.max(16, taperEndX - 210), ROAD_TOP - 10);
      }

      animationFrameIdRef.current = requestAnimationFrame(render);
    };

    animationFrameIdRef.current = requestAnimationFrame(render);

    return () => {
      if (animationFrameIdRef.current) cancelAnimationFrame(animationFrameIdRef.current);
    };
  }, [closedLanes, speedLimitKmh, demandPce, weavingIndex, heavyPct, resetToken]);

  const measuredVc = capacityPce > 0 ? live.throughputPce / capacityPce : 0;

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-xl">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Eye className="w-5 h-5 text-cyan-400" />
          <h4 className="text-sm font-semibold text-slate-100">
            {language === 'ar'
              ? 'المحاكي الميكروسكوبي الحي (IDM + دمج إجباري عند منطقة العمل)'
              : 'Live Microscopic Simulator (IDM + mandatory work-zone merge)'}
          </h4>
        </div>
        <div className="flex items-center gap-2">
          <div className="hidden sm:flex items-center gap-3 text-xs text-slate-400 bg-slate-950/70 px-3 py-1 rounded-lg border border-slate-800">
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-cyan-400" /> Car
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400" /> Microbus
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" /> Bus
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-500" /> Truck
            </span>
          </div>

          <button
            onClick={() => setIsPlaying(!isPlaying)}
            className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg transition"
            title={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          </button>
          <button
            onClick={() => {
              vehiclesRef.current = [];
              completedRef.current = [];
              setResetToken((t) => t + 1);
            }}
            className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg transition"
            title="Reset Canvas"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="relative rounded-lg overflow-hidden border border-slate-800 bg-slate-950">
        <canvas
          ref={canvasRef}
          width={W}
          height={H}
          className="w-full h-auto block"
        />
      </div>

      {/* Live measured telemetry (not the analytical answer) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3 text-[11px] font-mono">
        <div className="bg-slate-950/70 border border-slate-800 rounded-lg px-2.5 py-2">
          <span className="text-slate-500 flex items-center gap-1">
            <Activity className="w-3 h-3" /> {language === 'ar' ? 'التدفق المقاس' : 'Measured flow'}
          </span>
          <span className="text-cyan-300 font-bold">
            {live.warmup ? '—' : `${live.throughputPce.toLocaleString()} PCE/h`}
          </span>
          {!live.warmup && <span className="text-slate-500"> (v/c {measuredVc.toFixed(2)})</span>}
        </div>
        <div className="bg-slate-950/70 border border-slate-800 rounded-lg px-2.5 py-2">
          <span className="text-slate-500">{language === 'ar' ? 'الطابور الأقصى' : 'Peak queue'}</span>
          <span className={live.peakQueueM > 150 ? 'text-rose-400 font-bold' : 'text-amber-300 font-bold'}>
            {live.warmup ? '—' : `${live.peakQueueM.toFixed(1)} m`}
          </span>
          {!live.warmup && (
            <span className="text-slate-600"> · now {live.queueM.toFixed(1)}</span>
          )}
        </div>
        <div className="bg-slate-950/70 border border-slate-800 rounded-lg px-2.5 py-2">
          <span className="text-slate-500">{language === 'ar' ? 'متوسط التأخير' : 'Avg delay'}</span>
          <span className="text-rose-300 font-bold">
            {live.warmup ? '—' : `${live.avgDelaySec.toFixed(1)} s/veh`}
          </span>
        </div>
        <div className="bg-slate-950/70 border border-slate-800 rounded-lg px-2.5 py-2">
          <span className="text-slate-500 flex items-center gap-1">
            <Gauge className="w-3 h-3" /> {language === 'ar' ? 'السرعة' : 'Mean speed'}
          </span>
          <span className="text-emerald-300 font-bold">
            {live.warmup ? '—' : `${live.avgSpeedKmh.toFixed(1)} km/h`}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between mt-2.5 gap-2 text-xs text-slate-400">
        <span>
          {language === 'ar' ? 'الطلب:' : 'Demand:'} <strong className="text-cyan-400">{Math.round(demandPce).toLocaleString()}</strong> PCE/h
          {' · '}
          {language === 'ar' ? 'السعة:' : 'Capacity:'} <strong className="text-emerald-400">{Math.round(capacityPce).toLocaleString()}</strong> PCE/h
          {' · '}
          {language === 'ar' ? 'متوسط PCE:' : 'Avg PCE:'} <strong className="text-slate-300">{live.avgPce.toFixed(2)}</strong>
        </span>
        <div className="flex items-center gap-2">
          {live.warmup && (
            <span className="text-[10px] font-bold text-amber-400 animate-pulse">
              {language === 'ar' ? 'جاري التسخين…' : 'Warming up…'}
            </span>
          )}
          <span className="text-[10px] text-slate-500 font-mono">
            {live.active} active · {live.completed} trips · {live.laneChanges} lane changes
          </span>
          <span>{language === 'ar' ? 'سرعة المحاكاة:' : 'Sim speed:'}</span>
          {[1, 2].map((s) => (
            <button
              key={s}
              onClick={() => setSimSpeed(s as 1 | 2)}
              className={`px-2 py-0.5 rounded text-[11px] font-mono ${
                simSpeed === s ? 'bg-cyan-500 text-slate-950 font-bold' : 'bg-slate-800 text-slate-400'
              }`}
            >
              {s}x
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

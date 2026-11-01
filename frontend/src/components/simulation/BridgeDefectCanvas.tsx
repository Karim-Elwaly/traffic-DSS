import React, { useEffect, useRef, useState } from 'react';
import { Play, Pause, RefreshCw, Flame, Radio, Wrench, AlertTriangle } from 'lucide-react';
import {
  VehicleClassSpec,
  sampleVehicleClass,
  pickColor,
  makeRng,
} from '../../simulation/microsim';

interface BridgeDefectCanvasProps {
  defectType: string; // DAMAGED_EXPANSION_JOINT | DEEP_POTHOLE_CLUSTER | ASPHALT_SUBSIDENCE
  crawlSpeedKmh: number;
  affectedLanes: number; // 1 to 4 (starting from Lane 1 rightmost)
  speedLimitKmh?: number;
  language?: 'ar' | 'en';
}

interface DefectVehicle {
  id: number;
  xM: number;
  lane: number; // 1 (right) to 4 (left)
  laneVisualY: number;
  speed: number;
  targetSpeed: number;
  spec: VehicleClassSpec;
  color: string;
  braking: boolean;
  laneChanging: boolean;
  targetLane: number;
  joltOffsetPx: number; // Vertical bounce when crossing damaged joint
}

const W = 900;
const H = 230;
const NETWORK_M = 320;
const PX_PER_M = W / NETWORK_M; // 2.81 px / m
const ROAD_TOP = 38;
const LANE_H = 34;
const TOTAL_LANES = 4;
const DEFECT_X_M = 190; // Defect located at 190m along the bridge deck

const laneCenterY = (laneIndex1to4: number) => {
  return ROAD_TOP + (TOTAL_LANES - laneIndex1to4 + 0.5) * LANE_H;
};

export const BridgeDefectCanvas: React.FC<BridgeDefectCanvasProps> = ({
  defectType,
  crawlSpeedKmh,
  affectedLanes,
  speedLimitKmh = 80,
  language = 'ar',
}) => {
  const isAr = language === 'ar';
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animRef = useRef<number | null>(null);

  const [isPlaying, setIsPlaying] = useState(true);
  const isPlayingRef = useRef(true);
  isPlayingRef.current = isPlaying;

  const [showHeatmap, setShowHeatmap] = useState(false);
  const showHeatmapRef = useRef(false);
  showHeatmapRef.current = showHeatmap;

  const [showRadar, setShowRadar] = useState(true);
  const showRadarRef = useRef(true);
  showRadarRef.current = showRadar;

  const [resetToken, setResetToken] = useState(0);

  const vehiclesRef = useRef<DefectVehicle[]>([]);
  const nextIdRef = useRef(1);

  // Dynamic props ref so dragging sliders updates the simulation in real time
  const propsRef = useRef({
    defectType,
    crawlSpeedKmh,
    affectedLanes,
    speedLimitKmh,
  });

  useEffect(() => {
    propsRef.current = {
      defectType,
      crawlSpeedKmh,
      affectedLanes,
      speedLimitKmh,
    };
  }, [defectType, crawlSpeedKmh, affectedLanes, speedLimitKmh]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let simClock = 0;
    let lastTs = performance.now();
    const rng = makeRng(77123 + resetToken);
    let nextSpawnTime = 0;

    // Pre-seed the bridge deck with realistic traffic flow so canvas is instantly alive
    const prefillBridgeDeck = () => {
      const freeSpeedMs = propsRef.current.speedLimitKmh / 3.6;
      for (let lane = 1; lane <= 4; lane++) {
        let x = 15 + rng() * 25;
        while (x < NETWORK_M - 15) {
          const spec = sampleVehicleClass(rng, 14);
          const color = pickColor(rng, spec);
          const isAffected = lane <= propsRef.current.affectedLanes;
          const distToDefect = DEFECT_X_M - x;
          const spd = (isAffected && distToDefect > -20 && distToDefect < 40)
            ? (propsRef.current.crawlSpeedKmh / 3.6)
            : freeSpeedMs;

          vehiclesRef.current.push({
            id: nextIdRef.current++,
            xM: x,
            lane,
            laneVisualY: laneCenterY(lane),
            speed: spd * (0.95 + rng() * 0.1),
            targetSpeed: spd,
            spec,
            color,
            braking: false,
            laneChanging: false,
            targetLane: lane,
            joltOffsetPx: 0,
          });
          x += (28 + rng() * 30);
        }
      }
    };

    if (vehiclesRef.current.length === 0) {
      prefillBridgeDeck();
    }

    const render = (ts: number) => {
      const dt = Math.min(0.05, (ts - lastTs) / 1000);
      lastTs = ts;

      const {
        defectType: dType,
        crawlSpeedKmh: cSpeed,
        affectedLanes: aLanes,
        speedLimitKmh: sLimit,
      } = propsRef.current;

      const freeSpeedMs = sLimit / 3.6;
      const crawlSpeedMs = cSpeed / 3.6;

      if (isPlayingRef.current) {
        simClock += dt * 1.5;

        // 1. Vehicle Spawning
        if (simClock >= nextSpawnTime && vehiclesRef.current.length < 55) {
          const chosenLane = Math.floor(rng() * 4) + 1;
          const spec = sampleVehicleClass(rng, 14);
          const color = pickColor(rng, spec);

          vehiclesRef.current.push({
            id: nextIdRef.current++,
            xM: -10,
            lane: chosenLane,
            laneVisualY: laneCenterY(chosenLane),
            speed: freeSpeedMs * (0.92 + rng() * 0.16),
            targetSpeed: freeSpeedMs,
            spec,
            color,
            braking: false,
            laneChanging: false,
            targetLane: chosenLane,
            joltOffsetPx: 0,
          });

          // Poisson arrival interval (~4,800 PCE/h corridor volume)
          const interval = (3600 / 4800) * (0.6 + rng() * 0.8);
          nextSpawnTime = simClock + Math.max(0.18, interval);
        }

        // 2. Physics & Spot-Crawl IDM Logic
        for (const v of vehiclesRef.current) {
          const isLaneAffected = v.lane <= aLanes;
          const distToDefect = DEFECT_X_M - v.xM;

          // Attempt lane change away from affected lane before reaching the joint
          if (
            isLaneAffected &&
            !v.laneChanging &&
            distToDefect > 30 &&
            distToDefect < 110 &&
            v.lane < 4 &&
            rng() < 0.035
          ) {
            v.laneChanging = true;
            v.targetLane = v.lane + 1;
          }

          // Complete lane change animation
          if (v.laneChanging) {
            const targetY = laneCenterY(v.targetLane);
            v.laneVisualY += (targetY - v.laneVisualY) * Math.min(1, dt * 4.5);
            if (Math.abs(v.laneVisualY - targetY) < 1.0) {
              v.lane = v.targetLane;
              v.laneVisualY = targetY;
              v.laneChanging = false;
            }
          }

          // Determine target speed based on location relative to defect
          let desiredSpeed = freeSpeedMs;
          if (v.lane <= aLanes) {
            if (distToDefect > 0 && distToDefect < 65) {
              // Decelerating sharply before the damaged joint / pothole
              desiredSpeed = crawlSpeedMs;
            } else if (distToDefect <= 0 && distToDefect > -20) {
              // Crawling directly over the defect
              desiredSpeed = crawlSpeedMs;
              // Vehicle jolt / bounce physics over the defect
              v.joltOffsetPx = (Math.sin(simClock * 38) * 2.2);
            } else {
              // Accelerating back to free-flow after clearing the joint
              desiredSpeed = freeSpeedMs;
              v.joltOffsetPx = 0;
            }
          } else {
            v.joltOffsetPx = 0;
          }

          // Car-following: leader gap in current lane
          let leaderGap = 999;
          let leaderSpeed = desiredSpeed;
          for (const other of vehiclesRef.current) {
            if (other.id === v.id || other.lane !== v.lane) continue;
            if (other.xM > v.xM && (other.xM - v.xM) < leaderGap) {
              leaderGap = (other.xM - v.xM) - (v.spec.lengthM + other.spec.lengthM) / 2;
              leaderSpeed = other.speed;
            }
          }

          // Braking & acceleration calculation
          const approachingLeader = leaderGap < 22;
          const approachingCrawl = v.lane <= aLanes && distToDefect > 0 && distToDefect < 50;

          if (approachingLeader || (approachingCrawl && v.speed > crawlSpeedMs + 1)) {
            v.speed = Math.max(crawlSpeedMs * 0.7, v.speed - dt * 26);
            v.braking = true;
          } else {
            v.speed = Math.min(desiredSpeed, v.speed + dt * 14);
            v.braking = false;
          }

          v.xM += v.speed * dt;
        }

        // Cleanup offscreen vehicles
        vehiclesRef.current = vehiclesRef.current.filter((v) => v.xM < NETWORK_M + 30);
      }

      // ---------------------------------------------------------------------
      // RENDER CANVAS
      // ---------------------------------------------------------------------
      ctx.clearRect(0, 0, W, H);
      ctx.direction = 'ltr';
      ctx.textAlign = 'left';

      // Deep dark background
      ctx.fillStyle = '#060a12';
      ctx.fillRect(0, 0, W, H);

      // Bridge Deck Elevation Shadow
      const roadH = TOTAL_LANES * LANE_H;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
      ctx.fillRect(0, ROAD_TOP + roadH, W, 14);

      // Concrete Bridge Girder / Viaduct Edge
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(0, ROAD_TOP + roadH + 2, W, 8);
      ctx.fillStyle = '#334155';
      ctx.fillRect(0, ROAD_TOP + roadH, W, 2);

      // Bridge Road Surface Asphalt
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, ROAD_TOP, W, roadH);

      // Lane separator dashed lines
      for (let i = 1; i < TOTAL_LANES; i++) {
        const y = ROAD_TOP + i * LANE_H;
        ctx.strokeStyle = '#334155';
        ctx.lineWidth = 1.2;
        ctx.setLineDash([12, 12]);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        ctx.stroke();
      }
      ctx.setLineDash([]);

      // Bridge Concrete Parapets / Guardrails
      ctx.fillStyle = '#475569';
      ctx.fillRect(0, ROAD_TOP - 6, W, 6);
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(0, ROAD_TOP - 2, W, 2); // White reflective curb line

      ctx.fillStyle = '#475569';
      ctx.fillRect(0, ROAD_TOP + roadH, W, 5);
      ctx.fillStyle = '#eab308';
      ctx.fillRect(0, ROAD_TOP + roadH - 2, W, 2); // Yellow bottom shoulder

      // ---------------------------------------------------------------------
      // DEFECT RENDERING (Bridge Joint / Potholes / Subsidence)
      // ---------------------------------------------------------------------
      const defectXPx = DEFECT_X_M * PX_PER_M;
      const affectedH = aLanes * LANE_H;
      const defectTopY = ROAD_TOP + (TOTAL_LANES - aLanes) * LANE_H;

      // Red Hazard Zone on Pavement
      ctx.fillStyle = 'rgba(239, 68, 68, 0.12)';
      ctx.fillRect(defectXPx - 35, defectTopY, 70, affectedH);

      // Draw Specific Structural Defect
      if (dType === 'DAMAGED_EXPANSION_JOINT') {
        // Steel Bridge Finger Expansion Joint Gap
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 8;
        ctx.beginPath();
        ctx.moveTo(defectXPx, defectTopY);
        ctx.lineTo(defectXPx, defectTopY + affectedH);
        ctx.stroke();

        // Jagged Steel Expansion Teeth Plates
        ctx.strokeStyle = '#94a3b8';
        ctx.lineWidth = 3;
        ctx.setLineDash([6, 6]);
        ctx.beginPath();
        ctx.moveTo(defectXPx - 3, defectTopY);
        ctx.lineTo(defectXPx - 3, defectTopY + affectedH);
        ctx.moveTo(defectXPx + 3, defectTopY);
        ctx.lineTo(defectXPx + 3, defectTopY + affectedH);
        ctx.stroke();
        ctx.setLineDash([]);

        // Broken Jagged Teeth Sparks / Wear
        ctx.fillStyle = '#ef4444';
        for (let py = defectTopY + 8; py < defectTopY + affectedH; py += 16) {
          ctx.beginPath();
          ctx.arc(defectXPx + (Math.sin(py) * 2), py, 3, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (dType === 'DEEP_POTHOLE_CLUSTER') {
        // Deep Pothole Cavities with Crumbling Asphalt
        for (let l = 1; l <= aLanes; l++) {
          const py = laneCenterY(l);
          ctx.fillStyle = '#020617';
          ctx.beginPath();
          ctx.ellipse(defectXPx - 10, py - 4, 14, 8, -0.1, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#f59e0b';
          ctx.lineWidth = 1.5;
          ctx.stroke();

          ctx.beginPath();
          ctx.ellipse(defectXPx + 12, py + 5, 11, 7, 0.2, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      } else {
        // Asphalt Subsidence & Rutting (Wavy depressions)
        ctx.strokeStyle = '#d97706';
        ctx.lineWidth = 2.5;
        for (let l = 1; l <= aLanes; l++) {
          const py = laneCenterY(l);
          ctx.beginPath();
          ctx.moveTo(defectXPx - 30, py);
          ctx.bezierCurveTo(defectXPx - 10, py + 9, defectXPx + 10, py - 9, defectXPx + 30, py);
          ctx.stroke();
        }
      }

      // Overhead Gantry Warning Sign for Defect
      ctx.fillStyle = 'rgba(15, 23, 42, 0.95)';
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(defectXPx - 85, ROAD_TOP - 32, 170, 24, 4);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#f87171';
      ctx.font = 'bold 9.5px JetBrains Mono, monospace';
      ctx.textAlign = 'center';
      const defectLabel =
        dType === 'DAMAGED_EXPANSION_JOINT'
          ? (isAr ? '⚠ فاصل كوبري متضرر (كم 4+200)' : '⚠ DAMAGED JOINT (KM 4+200)')
          : dType === 'DEEP_POTHOLE_CLUSTER'
          ? (isAr ? '⚠ تجمع حفر غائرة بالأسفلت' : '⚠ DEEP POTHOLE CLUSTER')
          : (isAr ? '⚠ هبوط وتخدد أسفلتي' : '⚠ ASPHALT SUBSIDENCE');
      ctx.fillText(defectLabel, defectXPx, ROAD_TOP - 16);
      ctx.textAlign = 'start';

      // Speed Heatmap Overlay
      if (showHeatmapRef.current) {
        const nSegs = 8;
        const segLenM = NETWORK_M / nSegs;
        for (let s = 0; s < nSegs; s++) {
          const x0 = s * segLenM * PX_PER_M;
          const wSeg = segLenM * PX_PER_M;
          for (let lane = 1; lane <= TOTAL_LANES; lane++) {
            const inSeg = vehiclesRef.current.filter(
              (v) => v.lane === lane && v.xM >= s * segLenM && v.xM < (s + 1) * segLenM
            );
            const meanSpd =
              inSeg.length > 0
                ? (inSeg.reduce((a, b) => a + b.speed, 0) / inSeg.length) * 3.6
                : (lane <= aLanes && s * segLenM > 160 && s * segLenM < 230 ? cSpeed : sLimit);

            const yTop = ROAD_TOP + (TOTAL_LANES - lane) * LANE_H;
            let col = 'rgba(16, 185, 129, 0.16)';
            if (meanSpd < 25) col = 'rgba(239, 68, 68, 0.38)';
            else if (meanSpd < 45) col = 'rgba(245, 158, 11, 0.28)';

            ctx.fillStyle = col;
            ctx.fillRect(x0, yTop, wSeg, LANE_H);
          }
        }
      }

      // ---------------------------------------------------------------------
      // VEHICLES RENDERING (Module 1 Quality)
      // ---------------------------------------------------------------------
      for (const v of vehiclesRef.current) {
        const xPx = v.xM * PX_PER_M;
        const yPx = v.laneVisualY + v.joltOffsetPx;

        ctx.save();
        ctx.translate(xPx, yPx);

        const lenPx = Math.max(14, v.spec.lengthM * 2.3);
        const widPx = Math.max(8, v.spec.widthM * 4.2);

        // Soft drop-shadow
        ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
        ctx.fillRect(-lenPx / 2 + 2, -widPx / 2 + 2, lenPx, widPx);

        // Vehicle body with rounded corners
        ctx.fillStyle = v.color;
        ctx.beginPath();
        ctx.roundRect(-lenPx / 2, -widPx / 2, lenPx, widPx, 2.5);
        ctx.fill();

        // Dark-tinted windshield
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(lenPx * 0.05, -widPx * 0.35, lenPx * 0.22, widPx * 0.7);

        // Dual front headlights
        ctx.fillStyle = '#f8fafc';
        ctx.fillRect(lenPx / 2 - 2, -widPx / 2 + 1, 2, 2);
        ctx.fillRect(lenPx / 2 - 2, widPx / 2 - 3, 2, 2);

        // Dynamic Glowing Taillights / Brake Lights
        if (v.braking) {
          ctx.fillStyle = '#ff2222';
          ctx.shadowColor = '#ff0033';
          ctx.shadowBlur = 10;
          ctx.fillRect(-lenPx / 2 - 1, -widPx / 2 + 1, 2.5, 2.5);
          ctx.fillRect(-lenPx / 2 - 1, widPx / 2 - 3.5, 2.5, 2.5);
          ctx.fillRect(-lenPx / 2 - 1, -0.75, 2, 1.5);
        } else {
          ctx.fillStyle = '#991b1b';
          ctx.fillRect(-lenPx / 2 - 0.5, -widPx / 2 + 1, 1.5, 2);
          ctx.fillRect(-lenPx / 2 - 0.5, widPx / 2 - 3, 1.5, 2);
        }

        // Amber blinker while changing lane to avoid defect
        if (v.laneChanging && Math.sin(simClock * 16) > 0) {
          ctx.fillStyle = '#f59e0b';
          ctx.shadowColor = '#f59e0b';
          ctx.shadowBlur = 8;
          ctx.fillRect(lenPx * 0.1, -widPx / 2 - 1, 2.5, 2);
        }

        ctx.restore();
      }

      // ---------------------------------------------------------------------
      // VIRTUAL RADAR PROBES
      // ---------------------------------------------------------------------
      if (showRadarRef.current) {
        ctx.save();
        ctx.font = 'bold 9px JetBrains Mono, monospace';

        // Radar 1: Upstream Free-Flow Radar at x = 70m
        const rxUp = 70 * PX_PER_M;
        ctx.strokeStyle = '#06b6d4';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(rxUp, ROAD_TOP - 4);
        ctx.lineTo(rxUp, ROAD_TOP + roadH + 6);
        ctx.stroke();
        ctx.setLineDash([]);

        const upVehs = vehiclesRef.current.filter((v) => v.xM >= 50 && v.xM <= 90);
        const upSpd = upVehs.length > 0 ? (upVehs.reduce((a, b) => a + b.speed, 0) / upVehs.length) * 3.6 : sLimit;
        const upTxt = `📡 UPSTREAM: ${Math.round(upSpd)} km/h`;
        const upW = Math.max(125, Math.ceil(ctx.measureText(upTxt).width) + 16);
        const upH = 20;

        ctx.fillStyle = 'rgba(15, 23, 42, 0.95)';
        ctx.strokeStyle = '#06b6d4';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(rxUp - upW / 2, ROAD_TOP + roadH + 8, upW, upH, 4);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#06b6d4';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(upTxt, rxUp, ROAD_TOP + roadH + 8 + upH / 2);

        // Radar 2: Spot Bottleneck Crawl Radar directly over defect at x = 190m
        const rxSpot = defectXPx;
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(rxSpot, ROAD_TOP - 4);
        ctx.lineTo(rxSpot, ROAD_TOP + roadH + 6);
        ctx.stroke();
        ctx.setLineDash([]);

        const spotVehs = vehiclesRef.current.filter((v) => v.xM >= 170 && v.xM <= 210 && v.lane <= aLanes);
        const spotSpd = spotVehs.length > 0 ? (spotVehs.reduce((a, b) => a + b.speed, 0) / spotVehs.length) * 3.6 : cSpeed;
        const spotTxt = `📡 SPOT CRAWL: ${Math.round(spotSpd)} km/h`;
        const spotW = Math.max(130, Math.ceil(ctx.measureText(spotTxt).width) + 16);

        ctx.fillStyle = 'rgba(15, 23, 42, 0.95)';
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(rxSpot - spotW / 2, ROAD_TOP + roadH + 8, spotW, upH, 4);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#ef4444';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(spotTxt, rxSpot, ROAD_TOP + roadH + 8 + upH / 2);

        ctx.restore();
      }

      // Lane Category Badges on Left
      ctx.fillStyle = '#64748b';
      ctx.font = 'bold 9px JetBrains Mono, monospace';
      ctx.fillText(isAr ? 'حارة ٤ (سريعة)' : 'L4 (Fast)', 10, laneCenterY(4) + 3);
      ctx.fillText(isAr ? 'حارة ٣ (وسطى)' : 'L3 (Center)', 10, laneCenterY(3) + 3);
      ctx.fillStyle = aLanes >= 2 ? '#f87171' : '#64748b';
      ctx.fillText(isAr ? 'حارة ٢ (متأثرة)' : 'L2 (Affected)', 10, laneCenterY(2) + 3);
      ctx.fillStyle = aLanes >= 1 ? '#f87171' : '#64748b';
      ctx.fillText(isAr ? 'حارة ١ (متأثرة)' : 'L1 (Defect)', 10, laneCenterY(1) + 3);

      animRef.current = requestAnimationFrame(render);
    };

    animRef.current = requestAnimationFrame(render);
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [resetToken]);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-xl">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <Wrench className="w-5 h-5 text-amber-400" />
          <h4 className="text-sm font-semibold text-slate-100">
            {isAr
              ? 'المحاكي الميكروسكوبي اللحظي (فيزياء الزحف فوق الفاصل واضطراب التحويل الإجباري)'
              : 'Spot-Crawl & Weaving Defect Micro-Simulation Canvas (60 FPS)'}
          </h4>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowHeatmap(!showHeatmap)}
            className={`p-1.5 rounded-lg border transition flex items-center gap-1.5 text-xs font-semibold ${
              showHeatmap
                ? 'bg-rose-500/20 text-rose-400 border-rose-500/40'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-400 border-transparent'
            }`}
            title="Toggle Speed Heatmap"
          >
            <Flame className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{isAr ? 'خريطة السرعات' : 'Heatmap'}</span>
          </button>

          <button
            onClick={() => setShowRadar(!showRadar)}
            className={`p-1.5 rounded-lg border transition flex items-center gap-1.5 text-xs font-semibold ${
              showRadar
                ? 'bg-cyan-500/20 text-cyan-400 border-cyan-500/40'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-400 border-transparent'
            }`}
            title="Toggle Radar Probes"
          >
            <Radio className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{isAr ? 'رادارات السرعة' : 'Radars'}</span>
          </button>

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
              setResetToken((t) => t + 1);
            }}
            className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg transition"
            title="Reset Simulation"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="relative rounded-lg overflow-hidden border border-slate-800 bg-[#060a12]">
        <canvas ref={canvasRef} width={W} height={H} className="w-full h-auto block" />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3 text-[11px] font-mono">
        <div className="bg-slate-950/70 border border-slate-800 rounded-lg px-2.5 py-2">
          <span className="text-slate-500 block">{isAr ? 'سرعة الزحف فوق العيب:' : 'Spot Crawl Speed:'}</span>
          <span className="text-rose-400 font-bold">{crawlSpeedKmh} km/h (Bottleneck)</span>
        </div>
        <div className="bg-slate-950/70 border border-slate-800 rounded-lg px-2.5 py-2">
          <span className="text-slate-500 block">{isAr ? 'الحارات المتأثرة بالعيب:' : 'Affected Lanes:'}</span>
          <span className="text-amber-400 font-bold">{affectedLanes} / 4 Lanes</span>
        </div>
        <div className="bg-slate-950/70 border border-slate-800 rounded-lg px-2.5 py-2">
          <span className="text-slate-500 block">{isAr ? 'موقع الفاصل المتضرر:' : 'Joint Location:'}</span>
          <span className="text-sky-400 font-bold">KM 4+200 (Viaduct)</span>
        </div>
        <div className="bg-slate-950/70 border border-slate-800 rounded-lg px-2.5 py-2">
          <span className="text-slate-500 block">{isAr ? 'سلوك السائقين:' : 'Driver Behavior:'}</span>
          <span className="text-emerald-400 font-bold">{isAr ? 'تهدئة حادة + هروب للحارة المجاورة' : 'Heavy Braking + Weaving'}</span>
        </div>
      </div>
    </div>
  );
};

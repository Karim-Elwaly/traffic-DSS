import React, { useEffect, useRef, useState } from 'react';
import { Play, Pause, RefreshCw, Eye, ArrowLeftRight, Zap, Flame, Radio, Activity } from 'lucide-react';
import { Language } from '../../i18n/translations';
import {
  VehicleClassSpec,
  VEHICLE_CLASSES,
  idmAcceleration,
  makeRng,
  sampleVehicleClass,
  pickColor,
  pceToVehicleFlow,
} from '../../simulation/microsim';

interface ReversibleCanvasProps {
  inboundFlow: number;   // PCE/h
  outboundFlow: number;  // PCE/h
  recommendedMode: 'REVERSIBLE_5_3' | 'BALANCED_4_4';
  emergencyMode?: boolean;
  language?: Language;
}

interface RevVehicle {
  id: number;
  xM: number;
  lane: number;          // 1 to 8 (1-4 Inbound, 5 Reversible, 6-8 Outbound)
  laneVisualY: number;
  speed: number;
  direction: 1 | -1;     // 1 = Left-to-Right (Inbound), -1 = Right-to-Left (Outbound)
  spec: VehicleClassSpec;
  color: string;
  lengthM: number;
  widthPx: number;
  braking: boolean;
}

const W = 820;
const H = 340;
const ROAD_TOP = 40;
const LANE_H = 32;
const TOTAL_LANES = 8;
const NETWORK_M = 300;
const PX_PER_M = W / NETWORK_M;

const laneCenterY = (laneIndex1to8: number) => {
  return ROAD_TOP + (laneIndex1to8 - 0.5) * LANE_H;
};

export const ReversibleCanvas: React.FC<ReversibleCanvasProps> = ({
  inboundFlow,
  outboundFlow,
  recommendedMode,
  emergencyMode = false,
  language = 'ar',
}) => {
  const isAr = language === 'ar';
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [isPlaying, setIsPlaying] = useState(true);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [showRadar, setShowRadar] = useState(false);
  const [showGreenWave, setShowGreenWave] = useState(true);
  const [resetToken, setResetToken] = useState(0);

  const isPlayingRef = useRef(true);
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  const showHeatmapRef = useRef(false);
  const showRadarRef = useRef(false);
  const showGreenWaveRef = useRef(true);
  const modeRef = useRef(recommendedMode);

  useEffect(() => {
    showHeatmapRef.current = showHeatmap;
  }, [showHeatmap]);
  useEffect(() => {
    showRadarRef.current = showRadar;
  }, [showRadar]);
  const inboundFlowRef = useRef(inboundFlow);
  const outboundFlowRef = useRef(outboundFlow);
  useEffect(() => {
    inboundFlowRef.current = inboundFlow;
  }, [inboundFlow]);
  useEffect(() => {
    outboundFlowRef.current = outboundFlow;
  }, [outboundFlow]);
  useEffect(() => {
    showGreenWaveRef.current = showGreenWave;
  }, [showGreenWave]);
  useEffect(() => {
    modeRef.current = recommendedMode;
  }, [recommendedMode]);

  const vehiclesRef = useRef<RevVehicle[]>([]);
  const nextIdRef = useRef(1);
  const animationFrameIdRef = useRef<number | null>(null);
  const barrierYVisualRef = useRef(ROAD_TOP + 4 * LANE_H);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let simClock = 0;
    let lastTs = performance.now();
    const rng = makeRng(8821 + resetToken);

    let nextInboundSpawn = 0;
    let nextOutboundSpawn = 0;

    // Pre-fill all 8 corridor lanes immediately so vehicles are moving from frame 0
    const prefillReversibleCorridor = () => {
      const is53 = modeRef.current === 'REVERSIBLE_5_3';
      const inboundLanes = is53 ? [1, 2, 3, 4, 5] : [1, 2, 3, 4];
      const outboundLanes = is53 ? [6, 7, 8] : [5, 6, 7, 8];

      // Seed inbound vehicles (moving left-to-right)
      for (const lane of inboundLanes) {
        let x = 15 + rng() * 30;
        while (x < NETWORK_M - 15) {
          const spec = sampleVehicleClass(rng, 12);
          vehiclesRef.current.push({
            id: nextIdRef.current++,
            xM: x,
            lane,
            laneVisualY: laneCenterY(lane),
            speed: (55 / 3.6) * (0.92 + rng() * 0.16),
            direction: 1,
            spec,
            color: pickColor(rng, spec),
            lengthM: spec.lengthM,
            widthPx: spec.widthM * 3.6,
            braking: false,
          });
          x += 35 + rng() * 30;
        }
      }

      // Seed outbound vehicles (moving right-to-left)
      for (const lane of outboundLanes) {
        let x = 20 + rng() * 30;
        while (x < NETWORK_M - 15) {
          const spec = sampleVehicleClass(rng, 10);
          vehiclesRef.current.push({
            id: nextIdRef.current++,
            xM: x,
            lane,
            laneVisualY: laneCenterY(lane),
            speed: (50 / 3.6) * (0.92 + rng() * 0.16),
            direction: -1,
            spec,
            color: pickColor(rng, spec),
            lengthM: spec.lengthM,
            widthPx: spec.widthM * 3.6,
            braking: false,
          });
          x += 40 + rng() * 35;
        }
      }
    };

    if (vehiclesRef.current.length === 0) {
      prefillReversibleCorridor();
    }

    const render = (ts: number) => {
      const dtReal = Math.min(0.05, (ts - lastTs) / 1000);
      lastTs = ts;

      const targetBarrierY =
        modeRef.current === 'REVERSIBLE_5_3'
          ? ROAD_TOP + 5 * LANE_H
          : ROAD_TOP + 4 * LANE_H;

      if (isPlayingRef.current) {
        simClock += dtReal * 2; // 2x speed for vivid dynamics

        // Smooth Barrier Translation (QMB Moving concrete zipper barrier)
        barrierYVisualRef.current += (targetBarrierY - barrierYVisualRef.current) * Math.min(1, dtReal * 3.5);

        // Spawn Inbound Vehicles (Lanes 1 to 4, and Lane 5 when REVERSIBLE_5_3)
        if (simClock >= nextInboundSpawn) {
          const inboundLanes = modeRef.current === 'REVERSIBLE_5_3' ? [1, 2, 3, 4, 5] : [1, 2, 3, 4];
          const chosenLane = inboundLanes[Math.floor(rng() * inboundLanes.length)];
          const spec = sampleVehicleClass(rng, 12);
          vehiclesRef.current.push({
            id: nextIdRef.current++,
            xM: -8,
            lane: chosenLane,
            laneVisualY: laneCenterY(chosenLane),
            speed: (55 / 3.6) * (0.9 + rng() * 0.2),
            direction: 1,
            spec,
            color: pickColor(rng, spec),
            lengthM: spec.lengthM,
            widthPx: spec.widthM * 3.6,
            braking: false,
          });
          const interval = 3600 / Math.max(800, inboundFlowRef.current) * (0.6 + rng() * 0.8) / inboundLanes.length;
          nextInboundSpawn = simClock + Math.max(0.12, interval);
        }

        // Spawn Outbound Vehicles (Lanes 6 to 8, or Lanes 5 to 8 when BALANCED_4_4)
        if (simClock >= nextOutboundSpawn) {
          const outboundLanes = modeRef.current === 'REVERSIBLE_5_3' ? [6, 7, 8] : [5, 6, 7, 8];
          const chosenLane = outboundLanes[Math.floor(rng() * outboundLanes.length)];
          const spec = sampleVehicleClass(rng, 10);
          vehiclesRef.current.push({
            id: nextIdRef.current++,
            xM: NETWORK_M + 8,
            lane: chosenLane,
            laneVisualY: laneCenterY(chosenLane),
            speed: (50 / 3.6) * (0.9 + rng() * 0.2),
            direction: -1,
            spec,
            color: pickColor(rng, spec),
            lengthM: spec.lengthM,
            widthPx: spec.widthM * 3.6,
            braking: false,
          });
          const interval = 3600 / Math.max(600, outboundFlowRef.current) * (0.6 + rng() * 0.8) / outboundLanes.length;
          nextOutboundSpawn = simClock + Math.max(0.15, interval);
        }

        // Update Vehicles with IDM Physics & Green Wave Progression
        const greenWaveSpeedMs = 60 / 3.6; // 60 km/h green wave speed
        const greenWaveFrontM = (simClock * greenWaveSpeedMs * 1.2) % (NETWORK_M * 1.4);

        for (const veh of vehiclesRef.current) {
          // Check leader in same lane
          let gap = 200;
          let leaderSpeed = veh.speed;

          for (const other of vehiclesRef.current) {
            if (other.id === veh.id || other.lane !== veh.lane) continue;
            if (veh.direction === 1) {
              if (other.xM > veh.xM && other.xM - veh.xM < gap) {
                gap = (other.xM - veh.xM) - (veh.lengthM + other.lengthM) / 2;
                leaderSpeed = other.speed;
              }
            } else {
              if (other.xM < veh.xM && veh.xM - other.xM < gap) {
                gap = (veh.xM - other.xM) - (veh.lengthM + other.lengthM) / 2;
                leaderSpeed = other.speed;
              }
            }
          }

          // Desired speed boosted when inside Green Wave packet
          let desired = 65 / 3.6;
          const insideGreenWave =
            veh.direction === 1 &&
            Math.abs(veh.xM - greenWaveFrontM) < 45;
          if (insideGreenWave && showGreenWaveRef.current) {
            desired = 75 / 3.6;
          }

          const accel = idmAcceleration(
            veh.speed,
            desired,
            Math.max(0.2, gap),
            leaderSpeed,
            veh.spec,
            1,
            1
          );

          veh.speed = Math.max(0, veh.speed + accel * dtReal);
          veh.xM += veh.direction * veh.speed * dtReal;
          veh.braking = accel < -0.5 || (veh.speed < 1.0 && desired > 1.0);
          veh.laneVisualY += (laneCenterY(veh.lane) - veh.laneVisualY) * Math.min(1, dtReal * 6);
        }

        // Cleanup offscreen vehicles
        vehiclesRef.current = vehiclesRef.current.filter(
          (v) => v.xM >= -30 && v.xM <= NETWORK_M + 30
        );
      }

      // ---------------------------------------------------------------------
      // RENDER CANVAS
      // ---------------------------------------------------------------------
      ctx.clearRect(0, 0, W, H);
      ctx.direction = 'ltr';
      ctx.textAlign = 'left';

      // Background asphalt
      ctx.fillStyle = '#060a12';
      ctx.fillRect(0, 0, W, H);

      // Road deck (8 Lanes)
      const roadH = TOTAL_LANES * LANE_H;
      ctx.fillStyle = '#0c1322';
      ctx.fillRect(0, ROAD_TOP, W, roadH);

      // Lane separator markings
      for (let i = 1; i < TOTAL_LANES; i++) {
        const y = ROAD_TOP + i * LANE_H;
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 1;
        ctx.setLineDash([8, 8]);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        ctx.stroke();
      }
      ctx.setLineDash([]);

      // Lane 5 Reversible Highlight Band
      const l5Top = ROAD_TOP + 4 * LANE_H;
      const is53 = modeRef.current === 'REVERSIBLE_5_3';
      ctx.fillStyle = is53 ? 'rgba(16, 185, 129, 0.09)' : 'rgba(6, 182, 212, 0.08)';
      ctx.fillRect(0, l5Top, W, LANE_H);

      // Lane 5 Reversible Direction Arrows (pavement markings)
      const arrowStep = 90;
      for (let ax = 40; ax < W; ax += arrowStep) {
        ctx.fillStyle = is53 ? 'rgba(52, 211, 153, 0.45)' : 'rgba(56, 189, 248, 0.35)';
        ctx.font = 'bold 12px monospace';
        ctx.fillText(is53 ? '→' : '←', ax, l5Top + LANE_H / 2 + 4);
      }

      // Green-Wave Signal Progression Pulse Wave
      if (showGreenWaveRef.current) {
        const greenWaveSpeedMs = 60 / 3.6;
        const waveX = (simClock * greenWaveSpeedMs * 1.2 * PX_PER_M) % (W + 120) - 60;
        const inboundH = is53 ? 5 * LANE_H : 4 * LANE_H;

        const waveGrad = ctx.createLinearGradient(waveX - 50, 0, waveX + 50, 0);
        waveGrad.addColorStop(0, 'rgba(16, 185, 129, 0.0)');
        waveGrad.addColorStop(0.5, 'rgba(16, 185, 129, 0.28)');
        waveGrad.addColorStop(1, 'rgba(16, 185, 129, 0.0)');
        ctx.fillStyle = waveGrad;
        ctx.fillRect(waveX - 50, ROAD_TOP, 100, inboundH);

        // Crest line
        ctx.strokeStyle = '#34d399';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(waveX, ROAD_TOP);
        ctx.lineTo(waveX, ROAD_TOP + inboundH);
        ctx.stroke();

        ctx.fillStyle = '#34d399';
        ctx.font = 'bold 9px JetBrains Mono, monospace';
        ctx.fillText('⚡ GREEN WAVE (60 km/h)', waveX - 45, ROAD_TOP - 6);
      }

      // Dynamic Movable Concrete Barrier (QMB Zipper Barrier)
      const bY = barrierYVisualRef.current;
      ctx.fillStyle = '#475569';
      ctx.fillRect(0, bY - 3.5, W, 7);
      ctx.fillStyle = '#f59e0b'; // Reflective yellow hazard stripe along barrier
      ctx.fillRect(0, bY - 1, W, 2);

      // QMB Barrier Transfer Vehicle (BTV) Icon moving during transition
      if (Math.abs(barrierYVisualRef.current - targetBarrierY) > 1.0) {
        const btvX = (simClock * 65) % (W - 80);
        ctx.fillStyle = '#f59e0b';
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(btvX, bY - 7, 50, 14);
        ctx.fillRect(btvX, bY - 7, 50, 14);
        ctx.fillStyle = '#0f172a';
        ctx.font = 'bold 9px JetBrains Mono, monospace';
        ctx.fillText('QMB BTV', btvX + 4, bY + 3);
      }

      // Outer Road Curbs & Guardrails
      ctx.fillStyle = '#64748b';
      ctx.fillRect(0, ROAD_TOP - 4, W, 4);
      ctx.fillRect(0, ROAD_TOP + roadH, W, 4);

      // Speed Heatmap Overlay
      if (showHeatmapRef.current) {
        const nSegs = 6;
        const segLenM = NETWORK_M / nSegs;
        for (let s = 0; s < nSegs; s++) {
          const x0 = s * segLenM * PX_PER_M;
          const wSeg = segLenM * PX_PER_M;
          for (let lane = 1; lane <= 8; lane++) {
            const inSeg = vehiclesRef.current.filter(
              (v) => v.lane === lane && v.xM >= s * segLenM && v.xM < (s + 1) * segLenM
            );
            const meanSpd =
              inSeg.length > 0
                ? (inSeg.reduce((a, b) => a + b.speed, 0) / inSeg.length) * 3.6
                : 60;
            const yTop = ROAD_TOP + (lane - 1) * LANE_H;
            let col = 'rgba(16, 185, 129, 0.18)';
            if (meanSpd < 30) col = 'rgba(239, 68, 68, 0.35)';
            else if (meanSpd < 50) col = 'rgba(245, 158, 11, 0.25)';
            ctx.fillStyle = col;
            ctx.fillRect(x0, yTop, wSeg, LANE_H);
          }
        }
      }

      // Vehicles
      for (const v of vehiclesRef.current) {
        const xPx = v.xM * PX_PER_M;
        if (xPx < -50 || xPx > W + 50) continue;
        const yPx = v.laneVisualY;
        const lenPx = Math.max(12, v.lengthM * PX_PER_M * 1.3);
        const widPx = v.widthPx;

        ctx.save();
        ctx.translate(xPx, yPx);
        if (v.direction === -1) ctx.scale(-1, 1);

        // Vehicle Shadow & Body
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        ctx.fillRect(-lenPx / 2 + 2, -widPx / 2 + 2, lenPx, widPx);
        ctx.fillStyle = v.color;
        ctx.beginPath();
        ctx.roundRect(-lenPx / 2, -widPx / 2, lenPx, widPx, 2.5);
        ctx.fill();

        // Windshield
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(lenPx * 0.05, -widPx * 0.35, lenPx * 0.2, widPx * 0.7);

        // Headlights (Front)
        ctx.fillStyle = '#f8fafc';
        ctx.fillRect(lenPx / 2 - 2, -widPx / 2 + 1, 2, 2);
        ctx.fillRect(lenPx / 2 - 2, widPx / 2 - 3, 2, 2);

        // Dynamic Brake Lights (Rear)
        if (v.braking) {
          ctx.fillStyle = '#ff2222';
          ctx.shadowColor = '#ff0033';
          ctx.shadowBlur = 12; // Dynamic intense red brake glow
          ctx.fillRect(-lenPx / 2 - 1, -widPx / 2 + 1, 3, 2.5);
          ctx.fillRect(-lenPx / 2 - 1, widPx / 2 - 3.5, 3, 2.5);
          ctx.fillRect(-lenPx / 2 - 1, -0.75, 2.5, 1.5);
        }

        ctx.restore();
      }

      // Virtual Radar Probes
      if (showRadarRef.current) {
        const inVehs = vehiclesRef.current.filter((v) => v.direction === 1);
        const outVehs = vehiclesRef.current.filter((v) => v.direction === -1);
        const inSpd = inVehs.length > 0 ? (inVehs.reduce((a, b) => a + b.speed, 0) / inVehs.length) * 3.6 : 65;
        const outSpd = outVehs.length > 0 ? (outVehs.reduce((a, b) => a + b.speed, 0) / outVehs.length) * 3.6 : 58;

        const rx = 120 * PX_PER_M;
        ctx.strokeStyle = '#06b6d4';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(rx, ROAD_TOP - 12);
        ctx.lineTo(rx, ROAD_TOP + roadH + 12);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.save();
        ctx.font = 'bold 9px JetBrains Mono, monospace';

        const inTxt = `📡 INBOUND: ${Math.round(inSpd)} km/h`;
        const inW = Math.max(125, Math.ceil(ctx.measureText(inTxt).width) + 16);
        const inH = 20;
        const inX = rx - inW / 2;
        const inY = ROAD_TOP - 30;

        ctx.fillStyle = 'rgba(15, 23, 42, 0.95)';
        ctx.strokeStyle = '#06b6d4';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(inX, inY, inW, inH, 4);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#06b6d4';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(inTxt, rx, inY + inH / 2);

        const rx2 = 240 * PX_PER_M;
        ctx.strokeStyle = '#10b981';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(rx2, ROAD_TOP - 12);
        ctx.lineTo(rx2, ROAD_TOP + roadH + 12);
        ctx.stroke();
        ctx.setLineDash([]);

        const outTxt = `📡 OUTBOUND: ${Math.round(outSpd)} km/h`;
        const outW = Math.max(125, Math.ceil(ctx.measureText(outTxt).width) + 16);
        const outH = 20;
        const outX = rx2 - outW / 2;
        const outY = ROAD_TOP + roadH + 10;

        ctx.fillStyle = 'rgba(15, 23, 42, 0.95)';
        ctx.strokeStyle = '#10b981';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(outX, outY, outW, outH, 4);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#10b981';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(outTxt, rx2, outY + outH / 2);

        ctx.restore();
      }

      // Lane Category Badges on Left
      ctx.fillStyle = '#34d399';
      ctx.font = 'bold 10px JetBrains Mono, monospace';
      ctx.fillText(isAr ? '← ٤ حارات مدخل (Inbound)' : '← Inbound (L1-L4)', 12, ROAD_TOP + 1.8 * LANE_H);

      ctx.fillStyle = is53 ? '#34d399' : '#38bdf8';
      ctx.fillText(
        is53
          ? (isAr ? '★ حارة ٥ عكوس (مُضمّة للمدخل)' : '★ Lane 5: REVERSIBLE (Inbound)')
          : (isAr ? '★ حارة ٥ (مخرج متوازن)' : '★ Lane 5: Balanced (Outbound)'),
        12,
        ROAD_TOP + 4.5 * LANE_H + 4
      );

      ctx.fillStyle = '#38bdf8';
      ctx.fillText(isAr ? '→ ٣ حارات مخرج (Outbound)' : '→ Outbound (L6-L8)', 12, ROAD_TOP + 6.8 * LANE_H);

      animationFrameIdRef.current = requestAnimationFrame(render);
    };

    animationFrameIdRef.current = requestAnimationFrame(render);
    return () => {
      if (animationFrameIdRef.current) cancelAnimationFrame(animationFrameIdRef.current);
    };
  }, [resetToken]);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-xl">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <ArrowLeftRight className="w-5 h-5 text-emerald-400" />
          <h4 className="text-sm font-semibold text-slate-100">
            {isAr
              ? 'المحاكي الميكروسكوبي ثنائي الاتجاه (محور ٨ حارات مع حاجز ديناميكي متحرك QMB وموجة خضراء)'
              : 'Bidirectional 8-Lane Corridor Canvas (QMB Barrier + Green-Wave Progression)'}
          </h4>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowGreenWave(!showGreenWave)}
            className={`p-1.5 rounded-lg border transition flex items-center gap-1.5 text-xs font-semibold ${
              showGreenWave
                ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-400 border-transparent'
            }`}
            title="Toggle Green-Wave Progression Wave"
          >
            <Zap className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{isAr ? 'الموجة الخضراء' : 'Green Wave'}</span>
          </button>

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
            <span className="hidden sm:inline">{isAr ? 'الرادار الحي' : 'Radar Probes'}</span>
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
          <span className="text-slate-500 block">{isAr ? 'توزيع الحارات الحالي:' : 'Lane Configuration:'}</span>
          <span className="text-emerald-400 font-bold">
            {recommendedMode === 'REVERSIBLE_5_3' ? '5 Inbound / 3 Outbound' : '4 Inbound / 4 Outbound'}
          </span>
        </div>
        <div className="bg-slate-950/70 border border-slate-800 rounded-lg px-2.5 py-2">
          <span className="text-slate-500 block">{isAr ? 'حالة حاجز QMB المتحرك:' : 'Moveable Barrier:'}</span>
          <span className="text-amber-400 font-bold">
            {recommendedMode === 'REVERSIBLE_5_3' ? 'Shifted to Lane 5/6 Boundary' : 'Neutral at Lane 4/5'}
          </span>
        </div>
        <div className="bg-slate-950/70 border border-slate-800 rounded-lg px-2.5 py-2">
          <span className="text-slate-500 block">{isAr ? 'سرعة التزامن (Green Wave):' : 'Progression Speed:'}</span>
          <span className="text-emerald-300 font-bold">60 km/h (Continuous Platoon)</span>
        </div>
        <div className="bg-slate-950/70 border border-slate-800 rounded-lg px-2.5 py-2">
          <span className="text-slate-500 block">{isAr ? 'معدل التدفق الإجمالي:' : 'Corridor Flow:'}</span>
          <span className="text-cyan-400 font-bold">{(inboundFlow + outboundFlow).toLocaleString()} PCE/h</span>
        </div>
      </div>
    </div>
  );
};

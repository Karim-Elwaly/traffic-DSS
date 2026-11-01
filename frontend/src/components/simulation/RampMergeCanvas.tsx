import React, { useEffect, useRef, useState } from 'react';
import { Play, Pause, Shield, Zap, RefreshCw } from 'lucide-react';
import {
  VehicleClassSpec,
  sampleVehicleClass,
  pickColor,
  makeRng,
} from '../../simulation/microsim';

interface RampMergeCanvasProps {
  mainlineFlowPce: number;
  rampDemandPce: number;
  controlMode: string; // UNCONTROLLED | ALINEA_METERED | CHANNELIZED_BARRIER
  signalCycleSec: number;
  mainlineSpeedKmh: number;
  heavyPct?: number;
  language?: 'ar' | 'en';
}

interface SimVehicle {
  id: number;
  x: number;
  y: number;
  angle: number;
  speed: number;
  targetSpeed: number;
  lane: number;
  isRamp: boolean;
  spec: VehicleClassSpec;
  color: string;
  braking: boolean;
  turnSignal: boolean;
}

export const RampMergeCanvas: React.FC<RampMergeCanvasProps> = ({
  mainlineFlowPce,
  rampDemandPce,
  controlMode,
  signalCycleSec,
  mainlineSpeedKmh,
  heavyPct = 12,
  language = 'ar',
}) => {
  const isAr = language === 'ar';
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animRef = useRef<number | null>(null);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const isPausedRef = useRef(false);
  isPausedRef.current = isPaused;

  const vehiclesRef = useRef<SimVehicle[]>([]);
  const nextIdRef = useRef<number>(1);
  const signalTimerRef = useRef<number>(0);
  const isGreenRef = useRef<boolean>(true);
  const spawnMainlineRef = useRef<number>(0);
  const spawnRampRef = useRef<number>(0);

  // Dynamic props ref so dragging sliders updates simulation seamlessly without tearing down the loop
  const propsRef = useRef({
    mainlineFlowPce,
    rampDemandPce,
    controlMode,
    signalCycleSec,
    mainlineSpeedKmh,
    heavyPct,
  });

  useEffect(() => {
    propsRef.current = {
      mainlineFlowPce,
      rampDemandPce,
      controlMode,
      signalCycleSec,
      mainlineSpeedKmh,
      heavyPct,
    };
  }, [mainlineFlowPce, rampDemandPce, controlMode, signalCycleSec, mainlineSpeedKmh, heavyPct]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let lastTime = performance.now();
    const rng = makeRng(54321);

    const render = (time: number) => {
      const dt = Math.min((time - lastTime) / 1000, 0.05);
      lastTime = time;

      const {
        mainlineFlowPce: mFlow,
        rampDemandPce: rDemand,
        controlMode: cMode,
        signalCycleSec: sigCycle,
        mainlineSpeedKmh: mSpeed,
        heavyPct: hPct,
      } = propsRef.current;

      const width = canvas.width;
      const height = canvas.height;

      // Dark asphalt background
      ctx.direction = 'ltr';
      ctx.textAlign = 'left';
      ctx.fillStyle = '#070b14';
      ctx.fillRect(0, 0, width, height);

      // Geometry coordinates
      const numMainLanes = 4;
      const mainLaneH = 26;
      const mainRoadTopY = 30;
      const mainRoadBottomY = mainRoadTopY + numMainLanes * mainLaneH; // 30 + 104 = 134

      const rampStartX = 40;
      const rampStartY = height - 12;
      const rampMergeX = 460;
      const rampMergeY = mainRoadBottomY;

      const rampDx = rampMergeX - rampStartX;
      const rampDy = rampMergeY - rampStartY;
      const rampInclineAngle = Math.atan2(rampDy, rampDx); // approx -0.27 rad (-15 deg)

      // 1. Draw Pavements
      // Mainline asphalt
      ctx.fillStyle = '#0e1726';
      ctx.fillRect(0, mainRoadTopY, width, numMainLanes * mainLaneH);

      // Angled Ramp asphalt
      ctx.beginPath();
      ctx.moveTo(rampStartX, rampStartY);
      ctx.lineTo(rampStartX + 42, rampStartY);
      ctx.lineTo(rampMergeX + 80, rampMergeY);
      ctx.lineTo(rampMergeX, rampMergeY);
      ctx.closePath();
      ctx.fillStyle = '#111c30';
      ctx.fill();

      // Mainline dividers
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([10, 10]);
      for (let i = 1; i < numMainLanes; i++) {
        const y = mainRoadTopY + i * mainLaneH;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }
      ctx.setLineDash([]);

      // Road Borders (Yellow shoulders)
      ctx.strokeStyle = '#eab308';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(0, mainRoadTopY);
      ctx.lineTo(width, mainRoadTopY);
      ctx.moveTo(0, mainRoadBottomY);
      ctx.lineTo(rampMergeX - 10, mainRoadBottomY);
      ctx.stroke();

      // Ramp right shoulder
      ctx.beginPath();
      ctx.moveTo(rampStartX + 38, rampStartY);
      ctx.lineTo(rampMergeX + 80, rampMergeY);
      ctx.lineTo(width, mainRoadBottomY);
      ctx.stroke();

      // 2. Channelized Barrier Feature
      if (cMode === 'CHANNELIZED_BARRIER') {
        const barrierStart = rampMergeX - 80;
        const barrierEnd = barrierStart + 220;
        const barrierY = mainRoadBottomY - mainLaneH;

        // Draw 180m concrete barrier (Type-F New Jersey profile)
        ctx.strokeStyle = '#94a3b8';
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(barrierStart, barrierY);
        ctx.lineTo(barrierEnd, barrierY);
        ctx.stroke();

        // Yellow reflective warning hazard stripe
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 3;
        ctx.setLineDash([8, 8]);
        ctx.beginPath();
        ctx.moveTo(barrierStart, barrierY);
        ctx.lineTo(barrierEnd, barrierY);
        ctx.stroke();
        ctx.setLineDash([]);

        // Label
        ctx.fillStyle = '#f8fafc';
        ctx.font = 'bold 9px JetBrains Mono, monospace';
        ctx.fillText('🛡️ 180m CONCRETE CHANNELIZATION BARRIER', barrierStart + 10, barrierY - 6);
      }

      // 3. Ramp Metering Signal Head
      const signalX = rampMergeX - 110;
      const signalY = rampMergeY + 30;

      if (cMode === 'ALINEA_METERED') {
        signalTimerRef.current += dt;
        const cycle = Math.max(2.5, sigCycle);
        const greenWindow = 1.2; // 1-car pulse
        const isGreen = (signalTimerRef.current % cycle) < greenWindow;
        isGreenRef.current = isGreen;

        // Gantry post
        ctx.strokeStyle = '#64748b';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(signalX, signalY);
        ctx.lineTo(signalX, signalY - 24);
        ctx.stroke();

        // Signal Housing
        ctx.fillStyle = '#0f172a';
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 1;
        ctx.fillRect(signalX - 6, signalY - 42, 12, 22);
        ctx.strokeRect(signalX - 6, signalY - 42, 12, 22);

        // Red light
        ctx.fillStyle = isGreen ? '#450a0a' : '#ef4444';
        if (!isGreen) {
          ctx.shadowColor = '#ef4444';
          ctx.shadowBlur = 8;
        }
        ctx.beginPath();
        ctx.arc(signalX, signalY - 34, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        // Green light
        ctx.fillStyle = isGreen ? '#22c55e' : '#052e16';
        if (isGreen) {
          ctx.shadowColor = '#22c55e';
          ctx.shadowBlur = 8;
        }
        ctx.beginPath();
        ctx.arc(signalX, signalY - 24, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        // Stop bar across ramp
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(signalX - 10, signalY - 14);
        ctx.lineTo(signalX + 16, signalY + 2);
        ctx.stroke();

        // Status text
        ctx.fillStyle = isGreen ? '#4ade80' : '#f87171';
        ctx.font = 'bold 9px JetBrains Mono, monospace';
        const secLeft = (cycle - (signalTimerRef.current % cycle)).toFixed(1);
        ctx.fillText(isGreen ? '1 CAR / GREEN' : `HOLD (${secLeft}s)`, signalX - 25, signalY + 16);
      } else {
        isGreenRef.current = true;
      }

      // 4. Vehicle Spawning (Responds immediately to sliders)
      if (!isPausedRef.current) {
        spawnMainlineRef.current += dt;
        // Inject per-lane frequency based on mainlineFlowPce
        const mainInterval = 3600 / Math.max(800, mFlow) / numMainLanes;
        if (spawnMainlineRef.current >= mainInterval && vehiclesRef.current.length < 85) {
          spawnMainlineRef.current = 0;
          const assignedLane = Math.floor(rng() * numMainLanes);
          const laneY = mainRoadTopY + assignedLane * mainLaneH + mainLaneH / 2;

          const spec = sampleVehicleClass(rng, hPct);
          const vColor = pickColor(rng, spec);
          const baseSpeed = (mSpeed / 3.6) * 4.0;

          vehiclesRef.current.push({
            id: nextIdRef.current++,
            x: -20,
            y: laneY,
            angle: 0,
            speed: baseSpeed * (0.9 + rng() * 0.2),
            targetSpeed: baseSpeed,
            lane: assignedLane,
            isRamp: false,
            spec,
            color: vColor,
            braking: false,
            turnSignal: false,
          });
        }

        spawnRampRef.current += dt;
        const rampInterval = 3600 / Math.max(300, rDemand);
        if (spawnRampRef.current >= rampInterval && vehiclesRef.current.length < 85) {
          spawnRampRef.current = 0;
          const spec = sampleVehicleClass(rng, Math.min(25, hPct * 0.8)); // slightly fewer heavy trucks on steep on-ramp
          const vColor = pickColor(rng, spec);

          vehiclesRef.current.push({
            id: nextIdRef.current++,
            x: rampStartX,
            y: rampStartY,
            angle: rampInclineAngle,
            speed: 55,
            targetSpeed: 75,
            lane: 0,
            isRamp: true,
            spec,
            color: vColor,
            braking: false,
            turnSignal: true,
          });
        }
      }

      // 5. Physics & Dynamic Updates
      const vehicles = vehiclesRef.current;
      for (let i = 0; i < vehicles.length; i++) {
        const v = vehicles[i];

        if (!isPausedRef.current) {
          // Dynamic mainline target speed update as user moves slider
          const targetMainSpeed = (mSpeed / 3.6) * 4.0;
          if (!v.isRamp) {
            v.targetSpeed = targetMainSpeed;
          }

          if (v.isRamp) {
            // Car-following on ramp: look for vehicle ahead on ramp
            let frontDist = 999;
            let leaderSpeed = v.speed;
            for (let j = 0; j < vehicles.length; j++) {
              const other = vehicles[j];
              if (other.id !== v.id && other.isRamp && other.x > v.x) {
                const dist = Math.hypot(other.x - v.x, other.y - v.y);
                if (dist < frontDist) {
                  frontDist = dist;
                  leaderSpeed = other.speed;
                }
              }
            }

            // Approaching meter stop-bar
            const stopBarX = signalX - 10;
            const approachingRed = cMode === 'ALINEA_METERED' && !isGreenRef.current && v.x >= stopBarX - 55 && v.x <= stopBarX;

            if (approachingRed || frontDist < 30) {
              v.speed = Math.max(0, v.speed - dt * 120);
              v.braking = true;
            } else {
              v.braking = false;
              v.speed = Math.min(v.targetSpeed, v.speed + dt * 50);

              // Progress along angled ramp towards merge point
              const rampProgress = Math.min(1, Math.max(0, (v.x - rampStartX) / rampDx));
              v.x += Math.cos(v.angle) * v.speed * dt * 1.35;
              v.y += Math.sin(v.angle) * v.speed * dt * 1.35;

              // Smoothly straighten angle as it approaches mainline merge point
              if (v.x > rampMergeX - 70) {
                const alignFactor = (v.x - (rampMergeX - 70)) / 70;
                v.angle = rampInclineAngle * (1 - Math.min(1, alignFactor));
              }

              // Merged into Lane 4 (rightmost mainline lane)
              if (v.x >= rampMergeX) {
                v.isRamp = false;
                v.angle = 0;
                v.lane = 3; // Lane 4 (0-indexed: 3)
                v.y = mainRoadTopY + 3 * mainLaneH + mainLaneH / 2;
                v.targetSpeed = targetMainSpeed;
                v.turnSignal = false;
              }
            }
          } else {
            // Mainline vehicle car-following & merge friction
            let leaderGap = 999;
            for (let j = 0; j < vehicles.length; j++) {
              const other = vehicles[j];
              if (other.id !== v.id && !other.isRamp && other.lane === v.lane && other.x > v.x) {
                const gap = other.x - v.x;
                if (gap < leaderGap) {
                  leaderGap = gap;
                }
              }
            }

            // Merge friction: if UNCONTROLLED and in Lane 3 or 4 near merge point, decelerate
            const inMergeTurbulence = cMode === 'UNCONTROLLED' && (v.lane === 2 || v.lane === 3) && v.x > rampMergeX - 80 && v.x < rampMergeX + 100;

            if (leaderGap < 35 || inMergeTurbulence) {
              v.speed = Math.max(30, v.speed - dt * (inMergeTurbulence ? 40 : 80));
              v.braking = true;
            } else {
              v.braking = false;
              v.speed = Math.min(v.targetSpeed, v.speed + dt * 35);
            }

            v.x += v.speed * dt;
          }
        }

        // 6. DRAW VEHICLE (Stunning Module 1 Aesthetics)
        ctx.save();
        ctx.translate(v.x, v.y);
        ctx.rotate(v.angle);

        // Physical proportions scaled from VehicleClassSpec
        const lengthPx = Math.max(14, v.spec.lengthM * 2.2);
        const widthPx = Math.max(7.5, v.spec.widthM * 4.2);

        // Soft drop-shadow
        ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
        ctx.fillRect(-lengthPx / 2 + 1.5, -widthPx / 2 + 1.5, lengthPx, widthPx);

        // Vehicle body with rounded corners
        ctx.fillStyle = v.color;
        ctx.beginPath();
        ctx.roundRect(-lengthPx / 2, -widthPx / 2, lengthPx, widthPx, 2.5);
        ctx.fill();

        // Dark tinted windshield
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(lengthPx * 0.05, -widthPx * 0.35, lengthPx * 0.22, widthPx * 0.7);

        // Dual front headlights
        ctx.fillStyle = '#f8fafc';
        ctx.fillRect(lengthPx / 2 - 2, -widthPx / 2 + 1, 2, 2);
        ctx.fillRect(lengthPx / 2 - 2, widthPx / 2 - 3, 2, 2);

        // Taillights / Dynamic Brake Lights
        if (v.braking) {
          ctx.fillStyle = '#ff2222';
          ctx.shadowColor = '#ff0033';
          ctx.shadowBlur = 10;
          ctx.fillRect(-lengthPx / 2 - 1, -widthPx / 2 + 1, 2.5, 2.5);
          ctx.fillRect(-lengthPx / 2 - 1, widthPx / 2 - 3.5, 2.5, 2.5);
          // Center brake light (CHMSL)
          ctx.fillRect(-lengthPx / 2 - 1, -0.75, 2, 1.5);
        } else {
          ctx.fillStyle = '#991b1b';
          ctx.fillRect(-lengthPx / 2 - 0.5, -widthPx / 2 + 1, 1.5, 2);
          ctx.fillRect(-lengthPx / 2 - 0.5, widthPx / 2 - 3, 1.5, 2);
        }

        // Amber turn signal while on ramp / merging
        if (v.turnSignal && Math.sin(time * 0.012) > 0) {
          ctx.fillStyle = '#f59e0b';
          ctx.shadowColor = '#f59e0b';
          ctx.shadowBlur = 8;
          ctx.fillRect(lengthPx * 0.15, -widthPx / 2 - 1, 2.5, 2);
        }

        ctx.restore();
      }

      // Cleanup vehicles that exited canvas
      vehiclesRef.current = vehicles.filter((v) => v.x < width + 50 && v.y > 0 && v.y < height + 30);

      // HUD Overlay
      ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
      ctx.fillRect(width - 250, 8, 240, 26);
      ctx.strokeStyle = '#0284c7';
      ctx.lineWidth = 1;
      ctx.strokeRect(width - 250, 8, 240, 26);

      ctx.fillStyle = '#38bdf8';
      ctx.font = 'bold 10px JetBrains Mono, monospace';
      ctx.fillText(`MAINLINE SPEED: ${Math.round(mSpeed)} KM/H · HV: ${hPct}%`, width - 240, 25);

      animRef.current = requestAnimationFrame(render);
    };

    animRef.current = requestAnimationFrame(render);
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, []); // Mounts once: dynamic propsRef guarantees continuous 60fps simulation without restarts

  return (
    <div className="relative rounded-xl overflow-hidden border border-slate-800 bg-slate-950 shadow-2xl">
      <div className="absolute top-3 right-3 z-10 flex items-center gap-2">
        <button
          onClick={() => {
            vehiclesRef.current = [];
          }}
          className="px-2 py-1 text-[11px] font-semibold bg-slate-900/80 hover:bg-slate-800 text-slate-300 rounded-lg border border-slate-700 backdrop-blur-md flex items-center gap-1"
          title="Reset Vehicles"
        >
          <RefreshCw className="w-3 h-3 text-cyan-400" />
        </button>
        <button
          onClick={() => setIsPaused(!isPaused)}
          className="px-2.5 py-1 text-[11px] font-semibold bg-slate-900/80 hover:bg-slate-800 text-slate-300 rounded-lg border border-slate-700 backdrop-blur-md flex items-center gap-1"
        >
          {isPaused ? <Play className="w-3 h-3 text-emerald-400" /> : <Pause className="w-3 h-3 text-amber-400" />}
          {isPaused ? (isAr ? 'تشغيل' : 'Resume') : (isAr ? 'إيقاف' : 'Pause')}
        </button>
      </div>

      <canvas
        ref={canvasRef}
        width={960}
        height={240}
        className="w-full h-[240px] block"
      />

      <div className="bg-slate-900/90 border-t border-slate-800 px-4 py-2 flex flex-wrap items-center justify-between gap-3 text-[11px] text-slate-400">
        <div className="flex items-center gap-4 flex-wrap">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-cyan-400" /> {isAr ? 'تدفق المحور' : 'Mainline'} ({mainlineFlowPce} PCE/h)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" /> {isAr ? 'طلب المطلع' : 'On-Ramp'} ({rampDemandPce} PCE/h)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-400" /> {isAr ? 'الشاحنات' : 'Heavy'} ({heavyPct}%)
          </span>
          {controlMode === 'CHANNELIZED_BARRIER' && (
            <span className="flex items-center gap-1.5 text-amber-400 font-bold">
              <Shield className="w-3.5 h-3.5 text-amber-400" /> {isAr ? 'حاجز التوجيه الخرساني 180 م نشط' : '180m Concrete Barrier Separation Active'}
            </span>
          )}
          {controlMode === 'ALINEA_METERED' && (
            <span className="flex items-center gap-1.5 text-emerald-400 font-bold">
              <Zap className="w-3.5 h-3.5 text-emerald-400" /> ALINEA: {signalCycleSec}s / Veh
            </span>
          )}
        </div>
        <div className="text-slate-500 font-mono text-[10px]">
          Physics: ALINEA Local Feedback Control Law & Merge Turbulence Modeling
        </div>
      </div>
    </div>
  );
};

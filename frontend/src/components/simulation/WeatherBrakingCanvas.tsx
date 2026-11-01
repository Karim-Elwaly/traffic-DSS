import React, { useEffect, useRef, useState } from 'react';
import { Eye, Shield, AlertTriangle, Gauge, Siren, RefreshCw, Play, Pause } from 'lucide-react';
import {
  VehicleClassSpec,
  sampleVehicleClass,
  pickColor,
  makeRng,
} from '../../simulation/microsim';

interface WeatherBrakingCanvasProps {
  visibilityM: number;
  currentSpeedKmh: number;
  safeSpeedKmh: number;
  currentSsdM: number;
  safeSsdM: number;
  deficitM: number;
  roadCondition: string;
  pacingActive: boolean;
  convoySpeedKmh: number;
  trafficFlowPce?: number; // 1,000 to 7,500 PCE/h
  language?: 'ar' | 'en';
}

interface SimVehicle {
  id: number;
  x: number;
  lane: number; // 0 to 3 (Lane 1 to 4)
  speed: number;
  targetSpeed: number;
  color: string;
  type: 'police' | 'car' | 'microbus' | 'truck' | 'bus';
  spec?: VehicleClassSpec;
  isSubject?: boolean;
  isLeader?: boolean;
  braking: boolean;
}

export const WeatherBrakingCanvas: React.FC<WeatherBrakingCanvasProps> = ({
  visibilityM,
  currentSpeedKmh,
  safeSpeedKmh,
  currentSsdM,
  safeSsdM,
  deficitM,
  roadCondition,
  pacingActive,
  convoySpeedKmh,
  trafficFlowPce = 3800,
  language = 'ar',
}) => {
  const isAr = language === 'ar';
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animRef = useRef<number | null>(null);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const isPausedRef = useRef(false);
  isPausedRef.current = isPaused;

  const [resetToken, setResetToken] = useState<number>(0);

  // Dynamic props ref so dragging sliders updates simulation seamlessly without tearing down the loop
  const propsRef = useRef({
    visibilityM,
    currentSpeedKmh,
    safeSpeedKmh,
    currentSsdM,
    safeSsdM,
    deficitM,
    roadCondition,
    pacingActive,
    convoySpeedKmh,
    trafficFlowPce,
  });

  useEffect(() => {
    propsRef.current = {
      visibilityM,
      currentSpeedKmh,
      safeSpeedKmh,
      currentSsdM,
      safeSsdM,
      deficitM,
      roadCondition,
      pacingActive,
      convoySpeedKmh,
      trafficFlowPce,
    };
  }, [
    visibilityM,
    currentSpeedKmh,
    safeSpeedKmh,
    currentSsdM,
    safeSsdM,
    deficitM,
    roadCondition,
    pacingActive,
    convoySpeedKmh,
    trafficFlowPce,
  ]);

  const vehiclesRef = useRef<SimVehicle[]>([]);
  const nextIdRef = useRef<number>(1);
  const strobeRef = useRef<number>(0);
  const fogOffsetRef = useRef<number>(0);
  const lastSpawnRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let lastTime = performance.now();
    const rng = makeRng(33112 + resetToken);
    const pxPerMeter = 3.2; // 3.2 px per meter
    const numLanes = 4;
    const laneHeight = canvas.height / numLanes;

    // Helper: populate initial vehicles across the highway based on trafficFlowPce
    const initFleet = () => {
      const { trafficFlowPce: flow, currentSpeedKmh: spd, pacingActive: pacing, convoySpeedKmh: cSpd } = propsRef.current;
      const list: SimVehicle[] = [];
      const effectiveSpd = pacing ? cSpd : spd;

      // 1. If Pacing is active: 2 Police cruisers lead in lanes 1 and 2
      if (pacing) {
        list.push({
          id: nextIdRef.current++,
          x: 480,
          lane: 1,
          speed: effectiveSpd,
          targetSpeed: effectiveSpd,
          color: '#ffffff',
          type: 'police',
          isLeader: true,
          braking: false,
        });
        list.push({
          id: nextIdRef.current++,
          x: 480,
          lane: 2,
          speed: effectiveSpd,
          targetSpeed: effectiveSpd,
          color: '#ffffff',
          type: 'police',
          isLeader: true,
          braking: false,
        });
      }

      // 2. Subject vehicle in Lane 1 (for stopping sight distance evaluation)
      list.push({
        id: nextIdRef.current++,
        x: pacing ? 260 : 200,
        lane: 1,
        speed: effectiveSpd,
        targetSpeed: effectiveSpd,
        color: '#06b6d4',
        type: 'car',
        isSubject: true,
        braking: false,
      });

      // 3. Dense traffic filling based on trafficFlowPce (scaled up to 7500 PCE/h)
      // At 7500 PCE/h: target ~36 vehicles on canvas; at 1000 PCE/h: ~8 vehicles
      const targetCount = Math.max(8, Math.min(48, Math.round((flow / 7500) * 42)));
      const vehiclesPerLane = Math.ceil(targetCount / numLanes);

      for (let l = 0; l < numLanes; l++) {
        // Vehicle spacing compresses as flow approaches 7500 PCE/h
        const baseSpacing = Math.max(30, (canvas.width / vehiclesPerLane) * (0.8 + rng() * 0.4));
        let xPos = 15 + rng() * baseSpacing;

        while (xPos < canvas.width + 100) {
          // Avoid colliding directly with subject vehicle or police
          const conflict = list.some((other) => other.lane === l && Math.abs(other.x - xPos) < 32);
          if (!conflict) {
            const spec = sampleVehicleClass(rng, l === 3 ? 28 : 12); // Lane 4 carries more trucks
            const color = pickColor(rng, spec);
            list.push({
              id: nextIdRef.current++,
              x: xPos,
              lane: l,
              speed: effectiveSpd * (0.94 + rng() * 0.12),
              targetSpeed: effectiveSpd,
              color,
              type: spec.kind,
              spec,
              braking: false,
            });
          }
          xPos += baseSpacing;
        }
      }

      vehiclesRef.current = list;
    };

    initFleet();

    const render = (time: number) => {
      const dt = Math.min((time - lastTime) / 1000, 0.05);
      lastTime = time;

      const {
        visibilityM: visM,
        currentSpeedKmh: spdKmh,
        safeSpeedKmh: sSpdKmh,
        currentSsdM: curSsd,
        deficitM: defM,
        roadCondition: rCond,
        pacingActive: pacing,
        convoySpeedKmh: cSpdKmh,
        trafficFlowPce: flowPce,
      } = propsRef.current;

      const width = canvas.width;
      const height = canvas.height;
      const laneH = height / numLanes;
      const effectiveSpd = pacing ? cSpdKmh : spdKmh;

      // 1. Asphalt Background according to Road Condition
      ctx.direction = 'ltr';
      ctx.textAlign = 'left';
      let asphaltColor = '#0f172a';
      if (rCond === 'wet') asphaltColor = '#070f1e';
      if (rCond === 'fog_slick') asphaltColor = '#050a14';
      ctx.fillStyle = asphaltColor;
      ctx.fillRect(0, 0, width, height);

      // Wet / Slick Road Tire Specular Reflection
      if (rCond === 'wet' || rCond === 'fog_slick') {
        const sheen = ctx.createLinearGradient(0, 0, 0, height);
        sheen.addColorStop(0, 'rgba(56, 189, 248, 0.04)');
        sheen.addColorStop(0.5, 'rgba(148, 163, 184, 0.08)');
        sheen.addColorStop(1, 'rgba(56, 189, 248, 0.04)');
        ctx.fillStyle = sheen;
        ctx.fillRect(0, 0, width, height);
      }

      // Moving Dashed Lane Dividers
      fogOffsetRef.current = (fogOffsetRef.current + (effectiveSpd / 3.6) * pxPerMeter * dt * 0.4) % 28;
      const dashOffset = -fogOffsetRef.current;

      for (let i = 1; i < numLanes; i++) {
        const y = i * laneH;
        ctx.strokeStyle = '#334155';
        ctx.lineWidth = 1.2;
        ctx.setLineDash([14, 14]);
        ctx.lineDashOffset = dashOffset;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }
      ctx.setLineDash([]); // Reset dash

      // Road Borders (Yellow road shoulders)
      ctx.strokeStyle = '#eab308';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(0, 2);
      ctx.lineTo(width, 2);
      ctx.moveTo(0, height - 2);
      ctx.lineTo(width, height - 2);
      ctx.stroke();

      // Meters Scale on bottom shoulder
      ctx.fillStyle = '#64748b';
      ctx.font = '9px JetBrains Mono, monospace';
      for (let m = 0; m <= 300; m += 50) {
        const xPos = m * pxPerMeter;
        if (xPos < width) {
          ctx.beginPath();
          ctx.moveTo(xPos, height - 8);
          ctx.lineTo(xPos, height);
          ctx.strokeStyle = '#475569';
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.fillText(`${m}m`, xPos + 2, height - 10);
        }
      }

      // 2. Dynamic Spawning & Vehicle Density scaling with trafficFlowPce (up to 7500 PCE/h)
      if (!isPausedRef.current) {
        lastSpawnRef.current += dt;
        // Interval dynamically contracts as trafficFlowPce rises to 7500
        const spawnInterval = Math.max(0.12, (3600 / Math.max(800, flowPce)) * 0.28);
        const maxCapacityVehicles = Math.max(12, Math.min(50, Math.round((flowPce / 7500) * 46)));

        if (lastSpawnRef.current >= spawnInterval && vehiclesRef.current.length < maxCapacityVehicles) {
          lastSpawnRef.current = 0;
          const assignedLane = Math.floor(rng() * numLanes);
          const spec = sampleVehicleClass(rng, assignedLane === 3 ? 30 : 12);
          const color = pickColor(rng, spec);

          vehiclesRef.current.push({
            id: nextIdRef.current++,
            x: -45,
            lane: assignedLane,
            speed: effectiveSpd * (0.92 + rng() * 0.16),
            targetSpeed: effectiveSpd,
            color,
            type: spec.kind,
            spec,
            braking: false,
          });
        }
      }

      // Strobe beacon timer for police patrols
      strobeRef.current = (strobeRef.current + dt * 12) % (Math.PI * 2);

      // 3. Vehicles Movement & Car-Following Physics
      const vehicles = vehiclesRef.current;
      let subjectX = 200;
      let subjectY = 1.5 * laneH;

      for (let i = 0; i < vehicles.length; i++) {
        const veh = vehicles[i];

        if (!isPausedRef.current) {
          // Dynamic target speed adjustment as user drags speed slider or flow changes
          veh.targetSpeed = veh.type === 'police' ? cSpdKmh : effectiveSpd;

          // Car-following: find vehicle ahead in same lane
          let frontGap = 999;
          for (let j = 0; j < vehicles.length; j++) {
            const other = vehicles[j];
            if (other.id !== veh.id && other.lane === veh.lane && other.x > veh.x) {
              const gap = other.x - veh.x;
              if (gap < frontGap) {
                frontGap = gap;
              }
            }
          }

          // In dense flow (7500 PCE/h), headways are tight; vehicles brake when gap < 36px
          const minSafeGap = flowPce > 5000 ? 32 : 45;
          if (frontGap < minSafeGap) {
            veh.speed = Math.max(effectiveSpd * 0.5, veh.speed - dt * 45);
            veh.braking = true;
          } else {
            veh.speed = Math.min(veh.targetSpeed, veh.speed + dt * 25);
            veh.braking = false;
          }

          // Move vehicle
          veh.x += (veh.speed / 3.6) * pxPerMeter * dt * 0.42;

          // Subject vehicle remains anchored near x=200 for steady distance cone visualization
          if (veh.isSubject) {
            if (veh.x > 240) veh.x -= 0.5;
            if (veh.x < 180) veh.x += 0.5;
            subjectX = veh.x;
            subjectY = veh.lane * laneH + laneH / 2;
          }

          // Recycle vehicles exiting on the right
          if (veh.x > width + 60 && !veh.isSubject && veh.type !== 'police') {
            veh.x = -40;
            veh.lane = Math.floor(rng() * numLanes);
          }
        }

        const vx = veh.x;
        const vy = veh.lane * laneH + laneH / 2;

        // 4. DRAW VEHICLE (Module 1 Quality + Headlight Beams in Fog)
        ctx.save();
        ctx.translate(vx, vy);

        // Proportional vehicle size
        let lenPx = 28;
        let widPx = 14;
        if (veh.type === 'police') {
          lenPx = 32;
          widPx = 15;
        } else if (veh.type === 'truck') {
          lenPx = 48;
          widPx = 17;
        } else if (veh.type === 'bus') {
          lenPx = 44;
          widPx = 16;
        } else if (veh.type === 'microbus') {
          lenPx = 32;
          widPx = 15;
        }

        // Soft drop-shadow
        ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
        ctx.fillRect(-lenPx / 2 + 1.5, -widPx / 2 + 1.5, lenPx, widPx);

        // Vehicle Body
        if (veh.type === 'police') {
          // Police Cruiser Body (White + Navy)
          ctx.fillStyle = '#f8fafc';
          ctx.beginPath();
          ctx.roundRect(-lenPx / 2, -widPx / 2, lenPx, widPx, 3);
          ctx.fill();

          ctx.fillStyle = '#1e3a8a';
          ctx.fillRect(-lenPx * 0.2, -widPx / 2, lenPx * 0.4, widPx);

          // Flashing emergency roof strobe
          const flash = Math.sin(strobeRef.current) > 0;
          ctx.fillStyle = flash ? '#ef4444' : '#3b82f6';
          ctx.fillRect(-3, -widPx * 0.35, 6, widPx * 0.7);

          // Strobe illumination bloom in fog
          ctx.beginPath();
          ctx.arc(0, 0, 26, 0, Math.PI * 2);
          ctx.fillStyle = flash ? 'rgba(239, 68, 68, 0.22)' : 'rgba(59, 130, 246, 0.22)';
          ctx.fill();

          ctx.fillStyle = '#fbbf24';
          ctx.font = 'bold 7.5px JetBrains Mono, monospace';
          ctx.fillText('POLICE', -12, 2.5);
        } else {
          // Civilian Vehicles (Cars, Microbuses, Buses, Trucks)
          ctx.fillStyle = veh.color;
          ctx.beginPath();
          ctx.roundRect(-lenPx / 2, -widPx / 2, lenPx, widPx, 2.5);
          ctx.fill();

          // Dark-tinted windshield
          ctx.fillStyle = '#0f172a';
          ctx.fillRect(lenPx * 0.08, -widPx * 0.35, lenPx * 0.22, widPx * 0.7);

          // Dual front headlights
          ctx.fillStyle = '#f8fafc';
          ctx.fillRect(lenPx / 2 - 2, -widPx / 2 + 1, 2, 2);
          ctx.fillRect(lenPx / 2 - 2, widPx / 2 - 3, 2, 2);

          // Taillights / Glowing Red Brake Lights in Fog
          if (veh.braking) {
            ctx.fillStyle = '#ff2222';
            ctx.shadowColor = '#ff0033';
            ctx.shadowBlur = 12;
            ctx.fillRect(-lenPx / 2 - 1, -widPx / 2 + 1, 3, 2.5);
            ctx.fillRect(-lenPx / 2 - 1, widPx / 2 - 3.5, 3, 2.5);
          } else {
            ctx.fillStyle = '#991b1b';
            ctx.fillRect(-lenPx / 2 - 0.5, -widPx / 2 + 1, 1.5, 2);
            ctx.fillRect(-lenPx / 2 - 0.5, widPx / 2 - 3, 1.5, 2);
          }
        }

        // Forward Headlight Beam Cone illuminating through fog
        const beamLen = Math.min(65, Math.max(25, visM * 0.5));
        const hlGrad = ctx.createRadialGradient(lenPx / 2, 0, 2, lenPx / 2 + beamLen, 0, 28);
        hlGrad.addColorStop(0, 'rgba(254, 240, 138, 0.7)');
        hlGrad.addColorStop(0.5, 'rgba(254, 240, 138, 0.22)');
        hlGrad.addColorStop(1, 'rgba(254, 240, 138, 0.0)');

        ctx.fillStyle = hlGrad;
        ctx.beginPath();
        ctx.moveTo(lenPx / 2, -widPx * 0.4);
        ctx.lineTo(lenPx / 2 + beamLen, -widPx * 1.3);
        ctx.lineTo(lenPx / 2 + beamLen, widPx * 1.3);
        ctx.lineTo(lenPx / 2, widPx * 0.4);
        ctx.closePath();
        ctx.fill();

        ctx.restore();
      }

      // 5. CONE VISUALIZATION FOR SUBJECT VEHICLE
      const fogDistancePx = visM * pxPerMeter;
      const ssdDistancePx = curSsd * pxPerMeter;
      const fogLineX = subjectX + fogDistancePx;

      ctx.save();
      // Draw S_fog Horizon Line
      if (fogLineX < width + 100) {
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(fogLineX, 0);
        ctx.lineTo(fogLineX, height);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = '#38bdf8';
        ctx.font = 'bold 10px JetBrains Mono, monospace';
        ctx.fillText(`👁️ Fog Sight Range: ${Math.round(visM)}m`, fogLineX + 6, 18);
      }

      // Draw SSD Stopping Distance Cone
      const ssdEndX = subjectX + ssdDistancePx;
      const coneHeight = 36;

      if (defM > 0) {
        // HAZARD DEFICIT ZONE (Overlaps beyond fog sight horizon!)
        const safeWidth = Math.min(fogDistancePx, ssdDistancePx);
        const safeGrad = ctx.createLinearGradient(subjectX, 0, subjectX + safeWidth, 0);
        safeGrad.addColorStop(0, 'rgba(16, 185, 129, 0.35)');
        safeGrad.addColorStop(1, 'rgba(234, 179, 8, 0.2)');

        ctx.fillStyle = safeGrad;
        ctx.beginPath();
        ctx.moveTo(subjectX + 18, subjectY - 8);
        ctx.lineTo(subjectX + safeWidth, subjectY - coneHeight);
        ctx.lineTo(subjectX + safeWidth, subjectY + coneHeight);
        ctx.lineTo(subjectX + 18, subjectY + 8);
        ctx.closePath();
        ctx.fill();

        // Pulsing CRITICAL RED DEFICIT CONE (Blind Braking Zone)
        const pulse = 0.45 + 0.35 * Math.sin(time * 0.008);
        const redGrad = ctx.createLinearGradient(subjectX + safeWidth, 0, ssdEndX, 0);
        redGrad.addColorStop(0, `rgba(239, 68, 68, ${pulse})`);
        redGrad.addColorStop(1, `rgba(220, 38, 38, ${pulse * 1.5})`);

        ctx.fillStyle = redGrad;
        ctx.beginPath();
        ctx.moveTo(subjectX + safeWidth, subjectY - coneHeight);
        ctx.lineTo(ssdEndX, subjectY - coneHeight * 1.35);
        ctx.lineTo(ssdEndX, subjectY + coneHeight * 1.35);
        ctx.lineTo(subjectX + safeWidth, subjectY + coneHeight);
        ctx.closePath();
        ctx.fill();

        // Hazard stopping marker line
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(ssdEndX, subjectY - coneHeight * 1.4);
        ctx.lineTo(ssdEndX, subjectY + coneHeight * 1.4);
        ctx.stroke();

        ctx.fillStyle = '#ef4444';
        ctx.font = 'bold 10px JetBrains Mono, monospace';
        ctx.fillText(`⚠️ Full Stop: ${Math.round(curSsd)}m (+${Math.round(defM)}m Blind Deficit)`, Math.min(width - 260, ssdEndX - 90), subjectY - coneHeight * 1.5);
      } else {
        // SAFE: SSD is completely within Fog Horizon
        const safeGrad = ctx.createLinearGradient(subjectX, 0, ssdEndX, 0);
        safeGrad.addColorStop(0, 'rgba(16, 185, 129, 0.4)');
        safeGrad.addColorStop(1, 'rgba(16, 185, 129, 0.05)');

        ctx.fillStyle = safeGrad;
        ctx.beginPath();
        ctx.moveTo(subjectX + 18, subjectY - 8);
        ctx.lineTo(ssdEndX, subjectY - coneHeight);
        ctx.lineTo(ssdEndX, subjectY + coneHeight);
        ctx.lineTo(subjectX + 18, subjectY + 8);
        ctx.closePath();
        ctx.fill();

        ctx.strokeStyle = '#10b981';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(ssdEndX, subjectY - coneHeight);
        ctx.lineTo(ssdEndX, subjectY + coneHeight);
        ctx.stroke();

        ctx.fillStyle = '#10b981';
        ctx.font = 'bold 10px JetBrains Mono, monospace';
        ctx.fillText(`✓ Safe SSD: ${Math.round(curSsd)}m (Within ${Math.round(visM)}m Fog Horizon)`, ssdEndX + 6, subjectY);
      }
      ctx.restore();

      // 6. DENSE FOG OVERLAY
      // Fog density increases as visibility decreases (10m = 0.85 opacity, 400m = 0.05 opacity)
      const fogAlpha = Math.max(0.08, Math.min(0.88, 1.0 - visM / 350));
      const fogGrad = ctx.createLinearGradient(0, 0, width, 0);
      fogGrad.addColorStop(0, `rgba(148, 163, 184, ${fogAlpha * 0.35})`);
      fogGrad.addColorStop(0.4, `rgba(203, 213, 225, ${fogAlpha * 0.65})`);
      fogGrad.addColorStop(1, `rgba(226, 232, 240, ${fogAlpha * 0.95})`);
      ctx.fillStyle = fogGrad;
      ctx.fillRect(0, 0, width, height);

      // HUD Overlay showing live demand & visibility
      ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
      ctx.fillRect(width - 320, 8, 310, 26);
      ctx.strokeStyle = '#0284c7';
      ctx.lineWidth = 1;
      ctx.strokeRect(width - 320, 8, 310, 26);

      ctx.fillStyle = '#38bdf8';
      ctx.font = 'bold 10px JetBrains Mono, monospace';
      ctx.fillText(
        `FOG: ${Math.round(visM)}M · FLOW: ${Math.round(flowPce)} PCE/h · V: ${Math.round(spdKmh)} KM/H`,
        width - 310,
        25
      );

      animRef.current = requestAnimationFrame(render);
    };

    animRef.current = requestAnimationFrame(render);
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [resetToken]);

  return (
    <div className="relative rounded-xl overflow-hidden border border-slate-800 bg-slate-950 shadow-2xl">
      <div className="absolute top-3 right-3 z-10 flex items-center gap-2">
        <button
          onClick={() => {
            vehiclesRef.current = [];
            setResetToken((t) => t + 1);
          }}
          className="px-2 py-1 text-[11px] font-semibold bg-slate-900/80 hover:bg-slate-800 text-slate-300 rounded-lg border border-slate-700 backdrop-blur-md flex items-center gap-1"
          title="Reset Simulation"
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
            <span className="w-2.5 h-2.5 rounded-full bg-cyan-400" />
            {isAr ? 'مدى الرؤية' : 'Sight Range'} ({visibilityM}m)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
            {isAr ? 'كثافة التدفق' : 'Demand'} ({trafficFlowPce} PCE/h)
          </span>
          {deficitM > 0 ? (
            <span className="flex items-center gap-1.5 text-rose-400 font-bold">
              <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
              {isAr ? `عجز التوقف الأعمى: +${Math.round(deficitM)} م` : `Blind Braking Deficit: +${Math.round(deficitM)}m`}
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-emerald-400 font-bold">
              <Shield className="w-3.5 h-3.5 text-emerald-400" />
              {isAr ? 'مسافة التوقف آمنة بالكامل' : 'Safe Stopping Distance'}
            </span>
          )}
          {pacingActive && (
            <span className="flex items-center gap-1.5 text-blue-400 font-bold animate-pulse">
              <Siren className="w-3.5 h-3.5 text-blue-400" />
              {isAr ? `دوريات التفويج الأمني نشطة (${convoySpeedKmh} كم/س)` : `Police Pacing Active (${convoySpeedKmh} km/h)`}
            </span>
          )}
        </div>
        <div className="text-slate-500 font-mono text-[10px]">
          Physics: AASHTO Green Book SSD & Fog Extinction Optics
        </div>
      </div>
    </div>
  );
};

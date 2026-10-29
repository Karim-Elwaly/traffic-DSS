import React, { useEffect, useRef, useState } from 'react';
import { Play, Pause, RefreshCw, Eye } from 'lucide-react';

interface HighwayCanvasProps {
  closedLanes: number[]; // 1 to 4
  speedLimitKmh: number;
  demandPce: number;
  capacityPce: number;
  weavingIndex?: number;
  language?: 'en' | 'ar';
}

interface Vehicle {
  id: number;
  x: number;
  lane: number;
  targetLane: number;
  speed: number;
  type: 'car' | 'microbus' | 'bus' | 'truck';
  length: number;
  width: number;
  color: string;
  isBraking: boolean;
}

export const HighwayCanvas: React.FC<HighwayCanvasProps> = ({
  closedLanes,
  speedLimitKmh,
  demandPce,
  capacityPce,
  weavingIndex = 0.2,
  language = 'en',
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(true);
  const [simSpeed, setSimSpeed] = useState(1);
  const vehiclesRef = useRef<Vehicle[]>([]);
  const nextIdRef = useRef(1);
  const animationFrameIdRef = useRef<number | null>(null);

  // Vehicle type profiles
  const VEHICLE_TYPES = [
    { type: 'car' as const, length: 18, width: 8, color: '#06b6d4', prob: 0.55 },
    { type: 'microbus' as const, length: 22, width: 9, color: '#f59e0b', prob: 0.25 },
    { type: 'bus' as const, length: 38, width: 10, color: '#10b981', prob: 0.08 },
    { type: 'truck' as const, length: 44, width: 11, color: '#f43f5e', prob: 0.12 },
  ];

  const spawnVehicle = (canvasWidth: number) => {
    // Pick lane based on open lanes and vehicle type
    const r = Math.random();
    let selectedType = VEHICLE_TYPES[0];
    let cumulative = 0;
    for (const vt of VEHICLE_TYPES) {
      cumulative += vt.prob;
      if (r <= cumulative) {
        selectedType = vt;
        break;
      }
    }

    // Heavy vehicles favor right lanes (1 & 2)
    let candidateLane: number;
    if (selectedType.type === 'truck') {
      candidateLane = Math.random() < 0.7 ? 1 : 2;
    } else if (selectedType.type === 'car') {
      candidateLane = Math.random() < 0.6 ? 4 : 3;
    } else {
      candidateLane = Math.floor(Math.random() * 4) + 1;
    }

    // Check if spawn position is clear
    const laneY = candidateLane;
    const isOccupied = vehiclesRef.current.some(
      (v) => v.lane === laneY && v.x < 60
    );

    if (!isOccupied) {
      vehiclesRef.current.push({
        id: nextIdRef.current++,
        x: -40,
        lane: candidateLane,
        targetLane: candidateLane,
        speed: (speedLimitKmh / 35.0) * (0.85 + Math.random() * 0.3),
        type: selectedType.type,
        length: selectedType.length,
        width: selectedType.width,
        color: selectedType.color,
        isBraking: false,
      });
    }
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let lastSpawnTime = performance.now();

    const render = (time: number) => {
      // Auto spawn based on demandPce
      const spawnInterval = Math.max(120, (3600.0 / Math.max(500, demandPce)) * 50);
      if (time - lastSpawnTime > spawnInterval) {
        spawnVehicle(canvas.width);
        lastSpawnTime = time;
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const laneHeight = 36;
      const roadTop = 30;
      const roadBottom = roadTop + 4 * laneHeight;
      const taperStartX = canvas.width * 0.45;
      const workZoneStartX = canvas.width * 0.60;
      const isCongested = demandPce > capacityPce;

      // 1. Draw Asphalt Road Bed
      ctx.fillStyle = '#0b0f19';
      ctx.fillRect(0, roadTop, canvas.width, 4 * laneHeight);

      // Top and bottom solid road shoulders (yellow / white)
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(0, roadTop);
      ctx.lineTo(canvas.width, roadTop);
      ctx.moveTo(0, roadBottom);
      ctx.lineTo(canvas.width, roadBottom);
      ctx.stroke();

      // 2. Draw Lane Dividers (Dashed)
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([12, 10]);

      for (let i = 1; i < 4; i++) {
        const y = roadTop + i * laneHeight;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
      }
      ctx.setLineDash([]); // Reset dash

      // 3. Draw Lane Labels (Lane 4 Top, Lane 1 Bottom)
      ctx.font = '10px JetBrains Mono, monospace';
      ctx.fillStyle = '#64748b';
      for (let i = 1; i <= 4; i++) {
        const laneIdxFromTop = 4 - i; // Lane 4 is top (0), Lane 1 is bottom (3)
        const y = roadTop + laneIdxFromTop * laneHeight + laneHeight / 2 + 3;
        ctx.fillText(`L${i}`, 8, y);
      }

      // 4. Draw Closed Lanes Work-Zone & Taper Cones
      closedLanes.forEach((closedLane) => {
        const laneIdxFromTop = 4 - closedLane;
        const yTop = roadTop + laneIdxFromTop * laneHeight;

        // Work zone hazard hatching
        ctx.fillStyle = 'rgba(239, 68, 68, 0.18)';
        ctx.fillRect(workZoneStartX, yTop, canvas.width - workZoneStartX, laneHeight);

        // Safety Barrier stripes
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(workZoneStartX, yTop + laneHeight / 2);
        ctx.lineTo(canvas.width, yTop + laneHeight / 2);
        ctx.stroke();

        // Warning Taper zone (yellow/orange cones diagonal)
        const taperSteps = 8;
        for (let s = 0; s <= taperSteps; s++) {
          const coneX = taperStartX + s * ((workZoneStartX - taperStartX) / taperSteps);
          const coneY = yTop + (s / taperSteps) * (laneHeight * 0.8) + 4;

          // Draw reflective cone
          ctx.fillStyle = '#f97316';
          ctx.beginPath();
          ctx.arc(coneX, coneY, 3.5, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(coneX, coneY, 1.5, 0, Math.PI * 2);
          ctx.fill();
        }
      });

      // 5. Update & Draw Vehicles
      if (isPlaying) {
        const vehicles = vehiclesRef.current;
        for (let i = 0; i < vehicles.length; i++) {
          const v = vehicles[i];

          // Check if ahead vehicle is too close in the same lane
          let leadDistance = 999;
          for (let j = 0; j < vehicles.length; j++) {
            if (i !== j && vehicles[j].lane === v.lane && vehicles[j].x > v.x) {
              const dist = vehicles[j].x - (v.x + v.length);
              if (dist < leadDistance) {
                leadDistance = dist;
              }
            }
          }

          // Check if upcoming lane is closed and trigger merging
          const isCurrentLaneClosed = closedLanes.includes(v.lane);
          const approachingWorkZone = v.x > taperStartX - 100 && v.x < workZoneStartX;

          if (isCurrentLaneClosed && approachingWorkZone && v.lane === v.targetLane) {
            // Find an open lane
            const availableOpenLanes = [1, 2, 3, 4].filter((l) => !closedLanes.includes(l));
            if (availableOpenLanes.length > 0) {
              // Pick closest open lane
              availableOpenLanes.sort((a, b) => Math.abs(a - v.lane) - Math.abs(b - v.lane));
              v.targetLane = availableOpenLanes[0];
            }
          }

          // Random microbus weaving if weavingIndex is high
          if (v.type === 'microbus' && Math.random() < weavingIndex * 0.015 && v.lane === v.targetLane) {
            const delta = Math.random() < 0.5 ? -1 : 1;
            const newL = v.lane + delta;
            if (newL >= 1 && newL <= 4 && !closedLanes.includes(newL)) {
              v.targetLane = newL;
            }
          }

          // Smooth lane transition
          if (v.lane !== v.targetLane) {
            const laneDiff = v.targetLane - v.lane;
            v.lane += Math.sign(laneDiff) * 0.05 * simSpeed;
            if (Math.abs(v.targetLane - v.lane) < 0.06) {
              v.lane = v.targetLane;
            }
          }

          // Physics speed adjustments
          let targetSpeed = (speedLimitKmh / 35.0) * simSpeed;

          // Congestion deceleration
          if (isCongested && v.x > taperStartX - 80) {
            targetSpeed *= Math.max(0.25, capacityPce / demandPce);
          }

          // Car-following model
          if (leadDistance < 35) {
            v.isBraking = true;
            targetSpeed = Math.min(targetSpeed, leadDistance * 0.08);
          } else {
            v.isBraking = false;
          }

          v.speed += (targetSpeed - v.speed) * 0.1;
          v.x += Math.max(0.4, v.speed);
        }

        // Remove vehicles off-screen
        vehiclesRef.current = vehicles.filter((v) => v.x < canvas.width + 50);
      }

      // Draw all vehicles
      vehiclesRef.current.forEach((v) => {
        const laneIdxFromTop = 4 - v.lane;
        const centerY = roadTop + laneIdxFromTop * laneHeight + laneHeight / 2;

        ctx.save();
        ctx.translate(v.x, centerY);

        // Shadow
        ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
        ctx.fillRect(-v.length / 2 + 2, -v.width / 2 + 2, v.length, v.width);

        // Body
        ctx.fillStyle = v.color;
        ctx.beginPath();
        ctx.roundRect(-v.length / 2, -v.width / 2, v.length, v.width, 2.5);
        ctx.fill();

        // Windshield
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(v.length * 0.05, -v.width * 0.35, v.length * 0.22, v.width * 0.7);

        // Headlights (cyan / white)
        ctx.fillStyle = '#f8fafc';
        ctx.fillRect(v.length / 2 - 2, -v.width / 2 + 1, 2, 2);
        ctx.fillRect(v.length / 2 - 2, v.width / 2 - 3, 2, 2);

        // Brake lights (red glow when braking)
        if (v.isBraking) {
          ctx.fillStyle = '#ef4444';
          ctx.shadowColor = '#ef4444';
          ctx.shadowBlur = 6;
          ctx.fillRect(-v.length / 2, -v.width / 2 + 1, 2, 2);
          ctx.fillRect(-v.length / 2, v.width / 2 - 3, 2, 2);
        }

        ctx.restore();
      });

      // 6. Draw Shockwave Backpressure Queue Indicator
      if (isCongested) {
        ctx.fillStyle = 'rgba(239, 68, 68, 0.85)';
        ctx.font = 'bold 11px Inter, Cairo, sans-serif';
        ctx.fillText(
          language === 'ar' ? '⚠️ ارتداد موجة تكدس (LWR Shockwave)' : '⚠️ LWR Incident Shockwave Queue Active',
          taperStartX - 190,
          roadTop - 8
        );
      }

      animationFrameIdRef.current = requestAnimationFrame(render);
    };

    animationFrameIdRef.current = requestAnimationFrame(render);

    return () => {
      if (animationFrameIdRef.current) {
        cancelAnimationFrame(animationFrameIdRef.current);
      }
    };
  }, [closedLanes, speedLimitKmh, demandPce, capacityPce, weavingIndex, isPlaying, simSpeed, language]);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-xl">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Eye className="w-5 h-5 text-cyan-400" />
          <h4 className="text-sm font-semibold text-slate-100">
            {language === 'ar'
              ? 'المحاكي الميكروسكوبي الحي للطريق السريع (60 إطار/ثانية)'
              : 'Live 60fps Microscopic 4-Lane Highway Simulator'}
          </h4>
        </div>
        <div className="flex items-center gap-2">
          {/* Vehicle Class Legend */}
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
          width={800}
          height={205}
          className="w-full h-auto block"
        />
      </div>

      <div className="flex items-center justify-between mt-2.5 text-xs text-slate-400">
        <span>
          {language === 'ar' ? 'حجم الطلب:' : 'Demand:'} <strong className="text-cyan-400">{demandPce}</strong> PCE/h |{' '}
          {language === 'ar' ? 'السعة الفعالة:' : 'Capacity:'} <strong className="text-emerald-400">{capacityPce}</strong> PCE/h
        </span>
        <div className="flex items-center gap-2">
          <span>{language === 'ar' ? 'السرعة:' : 'Sim Speed:'}</span>
          {[1, 2].map((s) => (
            <button
              key={s}
              onClick={() => setSimSpeed(s)}
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

import React, { useEffect, useRef, useState } from 'react';
import { Users, Zap, Play, Pause, RefreshCw, Flame, Radio, ShieldCheck } from 'lucide-react';
import { Language } from '../../i18n/translations';
import {
  VehicleClassSpec,
  VEHICLE_CLASSES,
  idmAcceleration,
  makeRng,
  sampleVehicleClass,
  pickColor,
} from '../../simulation/microsim';

interface EventSurgeCanvasProps {
  eventType: string;           // 'STADIUM_EGRESS' | 'SCHOOL_CLUSTER_PEAK' | 'EXHIBITION_DISPERSAL'
  surgeVehicles: number;       // total surge volume (e.g. 5,500 veh)
  baseFlowPce: number;         // corridor background flow (e.g. 3,600 PCE/h)
  staggerMinutes: number;      // 0 = uncontrolled, 15, 30, 45
  expressChute: boolean;       // Coned dedicated discharge lane
  language?: Language;
}

interface SurgeSimVehicle {
  id: number;
  x: number;
  y: number;
  lane: number;          // 0, 1, 2 (mainline through) or 3 (express chute) or 99 (on egress ramp)
  speed: number;        // px/s (1m ≈ 3.2px, 60km/h ≈ 53px/s, 80km/h ≈ 71px/s)
  desiredSpeed: number;
  heading: number;      // Tangent rotation in radians
  isSurgeVehicle: boolean;
  gateIndex: number;    // 1, 2, or 3
  spec: VehicleClassSpec;
  color: string;
  braking: boolean;
  rampT: number;        // 0 to 1 parameter along curved egress ramp
  lengthPx: number;
  widthPx: number;
}

const W = 960;
const H = 280;

// Highway Geometry
const HWY_LANES = 4;
const LANE_H = 22;
const HWY_TOP = 170; // Highway spans from Y=170 to Y=258
const LANE_Y = [
  HWY_TOP + 0.5 * LANE_H, // Lane 0: 181 px (Fast Through)
  HWY_TOP + 1.5 * LANE_H, // Lane 1: 203 px (Through)
  HWY_TOP + 2.5 * LANE_H, // Lane 2: 225 px (Through / Chute Buffer)
  HWY_TOP + 3.5 * LANE_H, // Lane 3: 247 px (Express Chute / Dedicated Right Lane)
];

// Venue & Ramp Geometry
const VENUE_X = 25;
const VENUE_Y = 20;
const VENUE_W = 210;
const VENUE_H = 68;

const RAMP_START_X = 240;
const RAMP_START_Y = 54;
const RAMP_MERGE_X = 460;
const RAMP_MERGE_Y = LANE_Y[3]; // Merges into Lane 3

/**
 * Calculates position and heading along the curved egress slip ramp
 */
function getRampTrajectory(t: number): { x: number; y: number; heading: number } {
  // Smooth Bezier curve from venue gate exit (240, 54) into Lane 3 merge (460, 247)
  const p0 = { x: RAMP_START_X, y: RAMP_START_Y };
  const p1 = { x: RAMP_START_X + 110, y: RAMP_START_Y + 12 };
  const p2 = { x: RAMP_MERGE_X - 110, y: RAMP_MERGE_Y };
  const p3 = { x: RAMP_MERGE_X, y: RAMP_MERGE_Y };

  const oneMinusT = 1 - t;
  const x =
    oneMinusT * oneMinusT * oneMinusT * p0.x +
    3 * oneMinusT * oneMinusT * t * p1.x +
    3 * oneMinusT * t * t * p2.x +
    t * t * t * p3.x;

  const y =
    oneMinusT * oneMinusT * oneMinusT * p0.y +
    3 * oneMinusT * oneMinusT * t * p1.y +
    3 * oneMinusT * t * t * p2.y +
    t * t * t * p3.y;

  // Tangent derivative
  const dx =
    3 * oneMinusT * oneMinusT * (p1.x - p0.x) +
    6 * oneMinusT * t * (p2.x - p1.x) +
    3 * t * t * (p3.x - p2.x);

  const dy =
    3 * oneMinusT * oneMinusT * (p1.y - p0.y) +
    6 * oneMinusT * t * (p2.y - p1.y) +
    3 * t * t * (p3.y - p2.y);

  const heading = Math.atan2(dy, dx);
  return { x, y, heading };
}

export const EventSurgeCanvas: React.FC<EventSurgeCanvasProps> = ({
  eventType,
  surgeVehicles,
  baseFlowPce,
  staggerMinutes,
  expressChute,
  language = 'ar',
}) => {
  const isAr = language === 'ar';
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [showHeatmap, setShowHeatmap] = useState<boolean>(false);
  const [showRadar, setShowRadar] = useState<boolean>(false);
  const [resetToken, setResetToken] = useState<number>(0);

  // Persistent props ref for 60fps real-time updates without restarting the animation loop
  const propsRef = useRef({
    eventType,
    surgeVehicles,
    baseFlowPce,
    staggerMinutes,
    expressChute,
  });

  useEffect(() => {
    propsRef.current = {
      eventType,
      surgeVehicles,
      baseFlowPce,
      staggerMinutes,
      expressChute,
    };
  }, [eventType, surgeVehicles, baseFlowPce, staggerMinutes, expressChute]);

  const vehiclesRef = useRef<SurgeSimVehicle[]>([]);
  const nextIdRef = useRef<number>(1);
  const animRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let simClock = 0;
    let lastTime = performance.now();
    const rng = makeRng(9921 + resetToken);
    let nextMainSpawn = 0;
    let nextSurgeSpawn = 0;

    // Instant prefill routine to populate highway and ramp on frame 0
    const prefillCorridor = () => {
      vehiclesRef.current = [];
      const { expressChute: chuteActive, baseFlowPce: flow } = propsRef.current;

      // 1. Seed Mainline Highway Vehicles (Lanes 0, 1, 2, and 3 if chute off)
      const activeLanes = chuteActive ? [0, 1, 2] : [0, 1, 2, 3];
      for (const lane of activeLanes) {
        let x = 20 + rng() * 35;
        while (x < W - 25) {
          const spec = sampleVehicleClass(rng, 10);
          vehiclesRef.current.push({
            id: nextIdRef.current++,
            x,
            y: LANE_Y[lane],
            lane,
            speed: (75 / 3.6) * 3.2 * (0.92 + rng() * 0.16),
            desiredSpeed: (80 / 3.6) * 3.2,
            heading: 0,
            isSurgeVehicle: false,
            gateIndex: 0,
            spec,
            color: pickColor(rng, spec),
            braking: false,
            rampT: 0,
            lengthPx: Math.max(16, spec.lengthM * 3.2),
            widthPx: Math.max(8, spec.widthM * 4.0),
          });
          x += 45 + rng() * 35;
        }
      }

      // 2. Seed Venue Egress Ramp Vehicles (Spaced along the curve)
      const rampSeeds = [0.25, 0.55, 0.85];
      for (const t of rampSeeds) {
        const spec = sampleVehicleClass(rng, 15);
        const { x, y, heading } = getRampTrajectory(t);
        vehiclesRef.current.push({
          id: nextIdRef.current++,
          x,
          y,
          lane: 99,
          speed: (50 / 3.6) * 3.2,
          desiredSpeed: (55 / 3.6) * 3.2,
          heading,
          isSurgeVehicle: true,
          gateIndex: Math.floor(rng() * 3) + 1,
          spec,
          color: pickColor(rng, spec),
          braking: false,
          rampT: t,
          lengthPx: Math.max(16, spec.lengthM * 3.2),
          widthPx: Math.max(8, spec.widthM * 4.0),
        });
      }

      // 3. Seed Express Chute vehicles downstream (Lane 3)
      if (chuteActive) {
        let cx = RAMP_MERGE_X + 20;
        while (cx < W - 20) {
          const spec = sampleVehicleClass(rng, 10);
          vehiclesRef.current.push({
            id: nextIdRef.current++,
            x: cx,
            y: LANE_Y[3],
            lane: 3,
            speed: (65 / 3.6) * 3.2 * (0.95 + rng() * 0.1),
            desiredSpeed: (70 / 3.6) * 3.2,
            heading: 0,
            isSurgeVehicle: true,
            gateIndex: 1,
            spec,
            color: pickColor(rng, spec),
            braking: false,
            rampT: 1,
            lengthPx: Math.max(16, spec.lengthM * 3.2),
            widthPx: Math.max(8, spec.widthM * 4.0),
          });
          cx += 40 + rng() * 30;
        }
      }
    };

    if (vehiclesRef.current.length === 0) {
      prefillCorridor();
    }

    const render = (time: number) => {
      const dtReal = Math.min((time - lastTime) / 1000, 0.05);
      lastTime = time;

      const {
        eventType,
        surgeVehicles,
        baseFlowPce,
        staggerMinutes,
        expressChute,
      } = propsRef.current;

      // -----------------------------------------------------------------------
      // 1. VEHICLE SIMULATION & EGRESS LOGIC (60 FPS)
      // -----------------------------------------------------------------------
      if (isPlaying) {
        simClock += dtReal * 1.6;

        // 1.1 Spawn Mainline Vehicles
        const mainSpawnInterval = 3600 / Math.max(1200, baseFlowPce) / 3;
        if (simClock >= nextMainSpawn && vehiclesRef.current.length < 85) {
          // If express chute is active, mainline only spawns in Lanes 0, 1, 2
          const availableLanes = expressChute ? [0, 1, 2] : [0, 1, 2, 3];
          const chosenLane = availableLanes[Math.floor(rng() * availableLanes.length)];
          const spec = sampleVehicleClass(rng, 12);

          vehiclesRef.current.push({
            id: nextIdRef.current++,
            x: -20,
            y: LANE_Y[chosenLane],
            lane: chosenLane,
            speed: (75 / 3.6) * 3.2 * (0.92 + rng() * 0.16),
            desiredSpeed: (80 / 3.6) * 3.2,
            heading: 0,
            isSurgeVehicle: false,
            gateIndex: 0,
            spec,
            color: pickColor(rng, spec),
            braking: false,
            rampT: 0,
            lengthPx: Math.max(16, spec.lengthM * 3.2),
            widthPx: Math.max(8, spec.widthM * 4.0),
          });

          nextMainSpawn = simClock + Math.max(0.12, mainSpawnInterval * (0.6 + rng() * 0.8));
        }

        // 1.2 Spawn Surge Egress Vehicles from Venue Gates
        // Stagger intervals determine gating release rate:
        // Stagger=0 (uncontrolled): massive burst (very low interval)
        // Stagger=15/30/45: smooth, regulated platoon discharge
        const burstFactor = staggerMinutes === 0 ? 0.25 : 0.6 + (staggerMinutes / 45) * 0.4;
        const surgeInterval = (3600 / (surgeVehicles * 0.8)) * burstFactor;

        // In staggered mode, gate 1 releases first, then gate 2, then gate 3 in cycles
        const gatePhase = Math.floor((simClock / 12) % 3) + 1; // 1, 2, or 3
        const activeGate = staggerMinutes === 0 ? Math.floor(rng() * 3) + 1 : gatePhase;

        // Ensure ramp entrance is clear before injecting next vehicle to avoid bunching/clipping
        const canSpawnOnRamp = !vehiclesRef.current.some(
          (v) => v.lane === 99 && v.rampT < 0.22
        );

        if (simClock >= nextSurgeSpawn && canSpawnOnRamp && vehiclesRef.current.length < 85) {
          const spec = sampleVehicleClass(rng, eventType === 'SCHOOL_CLUSTER_PEAK' ? 25 : 10);
          const rampPos = getRampTrajectory(0);

          vehiclesRef.current.push({
            id: nextIdRef.current++,
            x: rampPos.x,
            y: rampPos.y,
            lane: 99, // on ramp
            speed: (45 / 3.6) * 3.2 * (0.95 + rng() * 0.1),
            desiredSpeed: (52 / 3.6) * 3.2,
            heading: rampPos.heading,
            isSurgeVehicle: true,
            gateIndex: activeGate,
            spec,
            color: pickColor(rng, spec),
            braking: false,
            rampT: 0,
            lengthPx: Math.max(16, spec.lengthM * 3.2),
            widthPx: Math.max(8, spec.widthM * 4.0),
          });

          // Headway minimum of 1.1s prevents bumper overlap
          nextSurgeSpawn = simClock + Math.max(1.1, surgeInterval * (0.8 + rng() * 0.4));
        }

        // 1.3 Update Vehicles Along Trajectories
        for (const veh of vehiclesRef.current) {
          if (veh.lane === 99) {
            // Travelling along curved egress slip ramp
            const rampLengthPx = 280;
            const ds = veh.speed * dtReal;
            veh.rampT += ds / rampLengthPx;

            if (veh.rampT >= 1.0) {
              // Reached highway merge point!
              veh.rampT = 1.0;
              veh.lane = 3; // Enters Lane 3
              veh.x = RAMP_MERGE_X;
              veh.y = LANE_Y[3];
              veh.heading = 0;
            } else {
              const pos = getRampTrajectory(veh.rampT);
              veh.x = pos.x;
              veh.y = pos.y;
              veh.heading = pos.heading;

              // Check for vehicle ahead on ramp
              let rampGap = 150;
              let rampLeaderSpeed = veh.speed;
              for (const other of vehiclesRef.current) {
                if (other.id !== veh.id && other.lane === 99 && other.rampT > veh.rampT) {
                  const dist = (other.rampT - veh.rampT) * rampLengthPx;
                  if (dist < rampGap) {
                    rampGap = dist;
                    rampLeaderSpeed = other.speed;
                  }
                }
              }

              // If expressChute is OFF and reaching merge, check for oncoming mainline traffic
              if (!expressChute && veh.rampT > 0.8) {
                const approachingMainline = vehiclesRef.current.some(
                  (m) => m.lane === 3 && m.x > RAMP_MERGE_X - 100 && m.x < RAMP_MERGE_X + 20
                );
                if (approachingMainline) {
                  rampGap = Math.min(rampGap, 12);
                  rampLeaderSpeed = 0;
                }
              }

              const accel = idmAcceleration(
                veh.speed / 3.2,
                veh.desiredSpeed / 3.2,
                Math.max(1.0, (rampGap - veh.lengthPx) / 3.2),
                rampLeaderSpeed / 3.2,
                veh.spec,
                1.0,
                1.5
              );
              veh.speed = Math.max(2.0, veh.speed + accel * 3.2 * dtReal);
              veh.braking = accel < -0.8;
            }
          } else {
            // Mainline Highway Vehicle (Lanes 0, 1, 2, or 3)
            let desired = veh.desiredSpeed;

            // If expressChute is OFF, severe turbulence occurs around merge point (X ~ 400 to 550)
            if (!expressChute) {
              const nearMerge = veh.x > 380 && veh.x < 580;
              if (nearMerge && (veh.lane === 3 || veh.lane === 2)) {
                // Harsh slowdown due to unchanneled merging
                desired = (25 / 3.6) * 3.2;
              }
            } else {
              // If Express Chute is ACTIVE, Lane 3 flows at 65 km/h cleanly, Lanes 0-2 at 80 km/h!
              if (veh.lane === 3) {
                desired = (65 / 3.6) * 3.2;
              }
            }

            // Leader detection in same lane
            let gapPx = 250;
            let leaderSpeed = veh.speed;

            for (const other of vehiclesRef.current) {
              if (other.id === veh.id || other.lane !== veh.lane) continue;
              if (other.x > veh.x && other.x - veh.x < gapPx) {
                gapPx = other.x - veh.x;
                leaderSpeed = other.speed;
              }
            }

            const accel = idmAcceleration(
              veh.speed / 3.2,
              desired / 3.2,
              Math.max(0.5, (gapPx - 20) / 3.2),
              leaderSpeed / 3.2,
              veh.spec,
              1,
              1
            );

            veh.speed = Math.max(1.0, veh.speed + accel * 3.2 * dtReal);
            veh.x += veh.speed * dtReal;
            veh.y = LANE_Y[veh.lane];
            veh.heading = 0;
            veh.braking = accel < -0.6 || veh.speed < 12;
          }
        }

        // Cleanup offscreen
        vehiclesRef.current = vehiclesRef.current.filter((v) => v.x <= W + 50);
      }

      // -----------------------------------------------------------------------
      // 2. CANVAS DRAWING (CRISP 60 FPS)
      // -----------------------------------------------------------------------
      ctx.clearRect(0, 0, W, H);

      // Force LTR text direction so Arabic strings and English labels fit inside bounding boxes without clipping
      ctx.direction = 'ltr';
      ctx.textAlign = 'left';

      // Deep Dark Backdrop
      ctx.fillStyle = '#060a12';
      ctx.fillRect(0, 0, W, H);

      // 2.1 Draw Venue / Stadium Parking Compound (Top-Left)
      ctx.fillStyle = '#0f172a';
      ctx.strokeStyle = '#a855f7';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(VENUE_X, VENUE_Y, VENUE_W, VENUE_H, 8);
      ctx.fill();
      ctx.stroke();

      // Venue Title & Icon
      ctx.direction = 'ltr';
      ctx.textAlign = 'left';
      ctx.fillStyle = '#c084fc';
      ctx.font = 'bold 9.5px JetBrains Mono, monospace';
      const venueTitle =
        eventType === 'STADIUM_EGRESS'
          ? (isAr ? '🏟️ استاد القاهرة الرياضي' : '🏟️ CAIRO STADIUM EGRESS')
          : eventType === 'SCHOOL_CLUSTER_PEAK'
          ? (isAr ? '🏫 مجمع المدارس الدولية' : '🏫 SCHOOL CLUSTER PICKUP')
          : (isAr ? '🏛️ مركز المؤتمرات والمعارض' : '🏛️ EXHIBITION DISPERSAL');
      ctx.fillText(venueTitle, VENUE_X + 10, VENUE_Y + 18);

      // 3 Venue Egress Gates (Gate 1, 2, 3)
      const gatePhase = Math.floor((simClock / 12) % 3) + 1;
      for (let g = 1; g <= 3; g++) {
        const gx = VENUE_X + 12 + (g - 1) * 62;
        const gy = VENUE_Y + 30;
        const isOpen = staggerMinutes === 0 || gatePhase === g;

        ctx.fillStyle = isOpen ? '#15803d' : '#1e293b';
        ctx.strokeStyle = isOpen ? '#22c55e' : '#64748b';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(gx, gy, 54, 24, 4);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = isOpen ? '#4ade80' : '#94a3b8';
        ctx.font = 'bold 9.5px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`GATE ${g}`, gx + 27, gy + 16);

        // Status beacon dot
        ctx.fillStyle = isOpen ? '#22c55e' : '#ef4444';
        ctx.beginPath();
        ctx.arc(gx + 46, gy + 8, 3, 0, Math.PI * 2);
        ctx.fill();
      }

      // 2.2 Draw Curved Paved Egress Ramp from Venue to Highway
      ctx.beginPath();
      ctx.moveTo(RAMP_START_X, RAMP_START_Y - 10);
      ctx.bezierCurveTo(
        RAMP_START_X + 110,
        RAMP_START_Y - 10,
        RAMP_MERGE_X - 110,
        LANE_Y[3] - LANE_H / 2,
        RAMP_MERGE_X,
        LANE_Y[3] - LANE_H / 2
      );
      ctx.lineTo(RAMP_MERGE_X + 40, LANE_Y[3] + LANE_H / 2);
      ctx.lineTo(RAMP_MERGE_X, LANE_Y[3] + LANE_H / 2);
      ctx.bezierCurveTo(
        RAMP_MERGE_X - 110,
        LANE_Y[3] + LANE_H / 2,
        RAMP_START_X + 110,
        RAMP_START_Y + 10,
        RAMP_START_X,
        RAMP_START_Y + 10
      );
      ctx.closePath();
      ctx.fillStyle = '#0f172a';
      ctx.fill();
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // 2.3 Draw Mainline 4-Lane Highway
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, HWY_TOP, W, 4 * LANE_H);

      // Yellow outer shoulders
      ctx.strokeStyle = '#eab308';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, HWY_TOP);
      ctx.lineTo(W, HWY_TOP);
      ctx.moveTo(0, HWY_TOP + 4 * LANE_H);
      ctx.lineTo(W, HWY_TOP + 4 * LANE_H);
      ctx.stroke();

      // Dashed lane divider lines (Lanes 0-1, 1-2, 2-3)
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 1;
      ctx.setLineDash([8, 8]);
      for (let i = 1; i <= 3; i++) {
        const y = HWY_TOP + i * LANE_H;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        ctx.stroke();
      }
      ctx.setLineDash([]);

      // 2.4 Draw Express Chute (مسار الأقماع السريع) on Lane 3
      if (expressChute) {
        // Shaded highlight band for Lane 3
        ctx.fillStyle = 'rgba(168, 85, 247, 0.12)';
        ctx.fillRect(230, HWY_TOP + 3 * LANE_H, W - 230, LANE_H);

        // Continuous row of fluorescent safety cones along Lane 2/3 boundary
        const coneY = HWY_TOP + 3 * LANE_H;
        for (let cx = 230; cx < W; cx += 22) {
          // Orange cone base
          ctx.fillStyle = '#f97316';
          ctx.beginPath();
          ctx.moveTo(cx, coneY - 7);
          ctx.lineTo(cx - 3.5, coneY + 3);
          ctx.lineTo(cx + 3.5, coneY + 3);
          ctx.closePath();
          ctx.fill();

          // Reflective white stripe on cone
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(cx - 2, coneY - 3, 4, 2);
        }

        // Taper warning cones angled from x=160 to x=225 to guide mainline traffic left
        for (let tx = 0; tx <= 4; tx++) {
          const tpx = 160 + tx * 15;
          const tpy = HWY_TOP + 3 * LANE_H + (4 - tx) * 3;
          ctx.fillStyle = '#f97316';
          ctx.beginPath();
          ctx.moveTo(tpx, tpy - 7);
          ctx.lineTo(tpx - 3.5, tpy + 3);
          ctx.lineTo(tpx + 3.5, tpy + 3);
          ctx.closePath();
          ctx.fill();
        }

        // Express Chute Illuminated Pavement Markers
        ctx.direction = 'ltr';
        ctx.textAlign = 'left';
        ctx.fillStyle = '#c084fc';
        ctx.font = 'bold 9px monospace';
        ctx.fillText(
          isAr ? '⚡ مسار الأقماع السريع ➔➔➔' : '⚡ EXPRESS CHUTE (DEDICATED) ➔➔➔',
          RAMP_MERGE_X + 25,
          HWY_TOP + 3.7 * LANE_H
        );

        // Police Traffic Marshal Patrol Car at ramp gore
        const copX = 205;
        const copY = HWY_TOP + 3 * LANE_H - 12;

        ctx.fillStyle = '#1e293b';
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(copX, copY, 24, 11, 2);
        ctx.fill();
        ctx.stroke();

        // Flashing blue/red emergency lights on police roof
        const copFlash = Math.floor(simClock * 6) % 2 === 0;
        ctx.fillStyle = copFlash ? '#3b82f6' : '#ef4444';
        ctx.shadowColor = copFlash ? '#3b82f6' : '#ef4444';
        ctx.shadowBlur = 8;
        ctx.fillRect(copX + 8, copY + 3, 8, 4);
        ctx.shadowBlur = 0;
      }

      // 2.5 Draw Speed Heatmap Overlay
      if (showHeatmap) {
        const segW = 60;
        for (let x0 = 0; x0 < W; x0 += segW) {
          for (let l = 0; l < 4; l++) {
            const inSeg = vehiclesRef.current.filter(
              (v) => v.lane === l && v.x >= x0 && v.x < x0 + segW
            );
            const meanSpd =
              inSeg.length > 0
                ? (inSeg.reduce((a, b) => a + b.speed, 0) / inSeg.length / 3.2) * 3.6
                : 75;
            let col = 'rgba(16, 185, 129, 0.18)';
            if (meanSpd < 30) col = 'rgba(239, 68, 68, 0.35)';
            else if (meanSpd < 50) col = 'rgba(245, 158, 11, 0.25)';
            ctx.fillStyle = col;
            ctx.fillRect(x0, HWY_TOP + l * LANE_H, segW, LANE_H);
          }
        }
      }

      // 2.6 DRAW ALL VEHICLES (Module #01 High-Fidelity Standards)
      for (const veh of vehiclesRef.current) {
        if (veh.x < -30 || veh.x > W + 30) continue;

        ctx.save();
        ctx.translate(veh.x, veh.y);
        ctx.rotate(veh.heading);

        const lenPx = veh.lengthPx;
        const widPx = veh.widthPx;

        // Vehicle Drop Shadow
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.beginPath();
        ctx.roundRect(-lenPx / 2 + 2, -widPx / 2 + 2, lenPx, widPx, 2.5);
        ctx.fill();

        // Vehicle Body
        ctx.fillStyle = veh.color;
        ctx.beginPath();
        ctx.roundRect(-lenPx / 2, -widPx / 2, lenPx, widPx, 2.5);
        ctx.fill();

        // Tinted Glass (Windshield & Rear window)
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(lenPx * 0.08, -widPx * 0.35, lenPx * 0.22, widPx * 0.7);
        ctx.fillRect(-lenPx * 0.35, -widPx * 0.35, lenPx * 0.12, widPx * 0.7);

        // Front Headlights
        ctx.fillStyle = '#f8fafc';
        ctx.fillRect(lenPx / 2 - 2, -widPx / 2 + 1, 2.5, 2);
        ctx.fillRect(lenPx / 2 - 2, widPx / 2 - 3, 2.5, 2);

        // Dynamic Glowing Brake Lights when Decelerating
        if (veh.braking) {
          ctx.fillStyle = '#ff2222';
          ctx.shadowColor = '#ff0033';
          ctx.shadowBlur = 10;
          ctx.fillRect(-lenPx / 2 - 1, -widPx / 2 + 1, 3, 2.5);
          ctx.fillRect(-lenPx / 2 - 1, widPx / 2 - 3.5, 3, 2.5);
          ctx.fillRect(-lenPx / 2 - 1, -0.75, 2.5, 1.5);
        } else {
          ctx.fillStyle = '#7f1d1d';
          ctx.fillRect(-lenPx / 2 - 0.5, -widPx / 2 + 1, 1.5, 2);
          ctx.fillRect(-lenPx / 2 - 0.5, widPx / 2 - 3, 1.5, 2);
        }

        ctx.restore();
      }

      // 2.7 Virtual Radar Probes
      if (showRadar) {
        const mainVehs = vehiclesRef.current.filter((v) => v.lane < 3);
        const chuteVehs = vehiclesRef.current.filter((v) => v.lane === 3);

        const mainSpd =
          mainVehs.length > 0
            ? (mainVehs.reduce((a, b) => a + b.speed, 0) / mainVehs.length / 3.2) * 3.6
            : 75;
        const chuteSpd =
          chuteVehs.length > 0
            ? (chuteVehs.reduce((a, b) => a + b.speed, 0) / chuteVehs.length / 3.2) * 3.6
            : 60;

        // Radar line at x = 600
        ctx.strokeStyle = '#a855f7';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(600, HWY_TOP - 12);
        ctx.lineTo(600, HWY_TOP + 4 * LANE_H + 12);
        ctx.stroke();
        ctx.setLineDash([]);

        // Radar badge
        ctx.fillStyle = 'rgba(15, 23, 42, 0.95)';
        ctx.strokeStyle = '#a855f7';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(505, HWY_TOP - 34, 190, 22, 4);
        ctx.fill();
        ctx.stroke();

        ctx.direction = 'ltr';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#c084fc';
        ctx.font = 'bold 9px JetBrains Mono, monospace';
        ctx.fillText(`MAIN: ${Math.round(mainSpd)} km/h | CHUTE: ${Math.round(chuteSpd)} km/h`, 600, HWY_TOP - 20);
      }

      // 2.8 Corridor HUD Badges (Auto-Measured so text never clips or overflows)
      const line1 = expressChute
        ? (isAr ? 'مسار الأقماع السريع: مفعّل' : 'EXPRESS CHUTE: ACTIVE')
        : (isAr ? 'مسار الأقماع: غير مفعّل (خطر تكدس)' : 'EXPRESS CHUTE: OFF (GRIDLOCK RISK)');

      const line2 = isAr
        ? `تفويج: ${staggerMinutes === 0 ? 'عشوائي' : `${staggerMinutes} دقيقة`} | المحور: ${baseFlowPce} PCE/h`
        : `Stagger: ${staggerMinutes === 0 ? 'Uncontrolled' : `${staggerMinutes}m`} | Flow: ${baseFlowPce} PCE/h`;

      ctx.font = 'bold 10px JetBrains Mono, monospace';
      const w1 = ctx.measureText(line1).width;
      ctx.font = '9px JetBrains Mono, monospace';
      const w2 = ctx.measureText(line2).width;
      const hudW = Math.max(260, Math.ceil(Math.max(w1, w2)) + 28);
      const hudX = W - hudW - 14;

      ctx.fillStyle = 'rgba(15, 23, 42, 0.95)';
      ctx.strokeStyle = expressChute ? '#22c55e' : '#ef4444';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(hudX, 12, hudW, 40, 6);
      ctx.fill();
      ctx.stroke();

      ctx.direction = 'ltr';
      ctx.textAlign = 'left';
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 10px JetBrains Mono, monospace';
      ctx.fillText(line1, hudX + 14, 27);

      ctx.fillStyle = expressChute ? '#4ade80' : '#f87171';
      ctx.font = '9px JetBrains Mono, monospace';
      ctx.fillText(line2, hudX + 14, 42);

      animRef.current = requestAnimationFrame(render);
    };

    animRef.current = requestAnimationFrame(render);
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [resetToken, isPlaying, isAr]);

  return (
    <div className="relative rounded-xl overflow-hidden border border-slate-800 bg-slate-950 shadow-2xl">
      <div className="flex flex-wrap items-center justify-between gap-3 p-3 border-b border-slate-800 bg-slate-900/90">
        <div className="flex items-center gap-2">
          <Users className="w-5 h-5 text-purple-400" />
          <h4 className="text-sm font-semibold text-slate-100">
            {isAr
              ? 'المحاكي الميكروسكوبي لتفويج الفعاليات والذروة (مسار الأقماع السريع وتفريغ البوابات)'
              : 'Microscopic Event Egress & Coned Express Chute Simulation (60fps)'}
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
            <span className="hidden sm:inline">{isAr ? 'الرادار الحي' : 'Radar Probes'}</span>
          </button>

          <button
            onClick={() => setIsPlaying(!isPlaying)}
            className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg transition"
            title={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? <Pause className="w-4 h-4 text-amber-400" /> : <Play className="w-4 h-4 text-emerald-400" />}
          </button>

          <button
            onClick={() => {
              vehiclesRef.current = [];
              setResetToken((t) => t + 1);
            }}
            className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg transition"
            title="Reset Simulation"
          >
            <RefreshCw className="w-4 h-4 text-slate-400" />
          </button>
        </div>
      </div>

      <canvas
        ref={canvasRef}
        dir="ltr"
        width={W}
        height={H}
        className="w-full h-[280px] block"
      />

      {/* Legend & Operation Status */}
      <div className="bg-slate-900/90 border-t border-slate-800 px-4 py-2 flex flex-wrap items-center justify-between gap-3 text-[11px] text-slate-300">
        <div className="flex items-center gap-4 flex-wrap">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-purple-400 shrink-0" />
            <span>{isAr ? 'مركبات الفعالية' : 'Event Vehicles'}</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 shrink-0" />
            <span>{isAr ? 'حركة المحور (حارات 1-3)' : 'Corridor Mainline (L1-L3)'}</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400 shrink-0" />
            <span>{isAr ? 'المسار السريع (حارة 4)' : 'Express Chute (Lane 4)'}</span>
          </span>
          {expressChute && (
            <span className="flex items-center gap-1.5 text-emerald-400 font-bold">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span>{isAr ? 'منع شلل المحور' : 'Gridlock Prevented'}</span>
            </span>
          )}
        </div>
        <div className="text-slate-400 font-mono text-[10px]">
          {isAr
            ? 'المحاكاة: تفويج ميكروسكوبي مرحلي (60 FPS)'
            : 'Simulation: Microscopic Staggered Egress (60 FPS)'}
        </div>
      </div>
    </div>
  );
};

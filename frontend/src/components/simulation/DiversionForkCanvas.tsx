import React, { useEffect, useRef, useState } from 'react';
import { Split, Zap, Play, Pause, RefreshCw, AlertTriangle, Radio } from 'lucide-react';
import { Language } from '../../i18n/translations';
import {
  VehicleClassSpec,
  VEHICLE_CLASSES,
  idmAcceleration,
  makeRng,
  sampleVehicleClass,
  pickColor,
} from '../../simulation/microsim';

interface DiversionForkCanvasProps {
  primaryName: string;
  alternateName: string;
  primaryFlowVph: number;
  alternateFlowVph: number;
  primaryTimeMin: number;
  alternateTimeMin: number;
  diversionPct: number;
  vmsActive: boolean;
  incidentFactor: number;
  language?: Language;
}

interface ForkVehicle {
  id: number;
  x: number;
  y: number;
  lane: number;          // Target lane: 0 or 1 for Primary; 2 or 3 for Alternate
  currentLaneY: number;  // Current transverse Y position for smooth lane changing
  speed: number;        // in px/s (1 m ≈ 3.2 px, 60 km/h ≈ 53 px/s, 80 km/h ≈ 71 px/s)
  desiredSpeed: number;
  heading: number;      // Tangent rotation in radians
  branch: 'primary' | 'alternate';
  spec: VehicleClassSpec;
  color: string;
  braking: boolean;
  blinkingRight: boolean;
  blinkingLeft: boolean;
}

const W = 960;
const H = 260;

// Road Geometry Constants
const APPROACH_END_X = 340;
const PRIMARY_MERGE_X = 540;
const ALTERNATE_MERGE_X = 560;

const LANE_W = 20;
const Y_APPROACH_CENTER = 130;

// Approach Lane Centers (Lanes 0, 1, 2, 3)
const LANE_APPROACH_Y = [
  Y_APPROACH_CENTER - 1.5 * LANE_W, // Lane 0: 100 px (Fast through)
  Y_APPROACH_CENTER - 0.5 * LANE_W, // Lane 1: 120 px (Through / Optional exit)
  Y_APPROACH_CENTER + 0.5 * LANE_W, // Lane 2: 140 px (Divergence ramp fast)
  Y_APPROACH_CENTER + 1.5 * LANE_W, // Lane 3: 160 px (Divergence ramp slow)
];

// Upper Corridor (Primary: 2 Lanes)
const Y_PRIMARY_CENTER = 65;
const LANE_PRIMARY_Y = [
  Y_PRIMARY_CENTER - 0.5 * LANE_W, // Upper Lane 0: 55 px
  Y_PRIMARY_CENTER + 0.5 * LANE_W, // Upper Lane 1: 75 px
];

// Lower Corridor (Alternate: 2 Lanes)
const Y_ALTERNATE_CENTER = 195;
const LANE_ALTERNATE_Y = [
  Y_ALTERNATE_CENTER - 0.5 * LANE_W, // Lower Lane 0: 185 px
  Y_ALTERNATE_CENTER + 0.5 * LANE_W, // Lower Lane 1: 205 px
];

/**
 * Calculates exact lane centerline Y coordinate and heading angle θ at any X coordinate
 */
function getLaneTrajectory(laneIndex: number, x: number): { y: number; heading: number } {
  if (laneIndex <= 1) {
    // Primary Branch (Lanes 0 and 1)
    const yStart = LANE_APPROACH_Y[laneIndex];
    const yEnd = LANE_PRIMARY_Y[laneIndex];
    const deltaY = yEnd - yStart; // negative (curves up)

    if (x <= APPROACH_END_X) {
      return { y: yStart, heading: 0 };
    } else if (x >= PRIMARY_MERGE_X) {
      return { y: yEnd, heading: 0 };
    } else {
      const span = PRIMARY_MERGE_X - APPROACH_END_X;
      const u = (x - APPROACH_END_X) / span;
      const s = 3 * u * u - 2 * u * u * u; // Cubic smoothstep
      const ds_du = 6 * u * (1 - u);
      const dy_dx = (deltaY * ds_du) / span;
      return {
        y: yStart + deltaY * s,
        heading: Math.atan(dy_dx),
      };
    }
  } else {
    // Alternate Branch (Lanes 2 and 3)
    const yStart = LANE_APPROACH_Y[laneIndex];
    const yEnd = LANE_ALTERNATE_Y[laneIndex - 2];
    const deltaY = yEnd - yStart; // positive (curves down)

    if (x <= APPROACH_END_X) {
      return { y: yStart, heading: 0 };
    } else if (x >= ALTERNATE_MERGE_X) {
      return { y: yEnd, heading: 0 };
    } else {
      const span = ALTERNATE_MERGE_X - APPROACH_END_X;
      const u = (x - APPROACH_END_X) / span;
      const s = 3 * u * u - 2 * u * u * u;
      const ds_du = 6 * u * (1 - u);
      const dy_dx = (deltaY * ds_du) / span;
      return {
        y: yStart + deltaY * s,
        heading: Math.atan(dy_dx),
      };
    }
  }
}

export const DiversionForkCanvas: React.FC<DiversionForkCanvasProps> = ({
  primaryName,
  alternateName,
  primaryFlowVph,
  alternateFlowVph,
  primaryTimeMin,
  alternateTimeMin,
  diversionPct,
  vmsActive,
  incidentFactor,
  language = 'ar',
}) => {
  const isAr = language === 'ar';
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [resetToken, setResetToken] = useState<number>(0);

  // Keep props in refs so slider adjustments update the 60fps loop smoothly without resetting
  const propsRef = useRef({
    primaryName,
    alternateName,
    primaryFlowVph,
    alternateFlowVph,
    primaryTimeMin,
    alternateTimeMin,
    diversionPct,
    vmsActive,
    incidentFactor,
  });

  useEffect(() => {
    propsRef.current = {
      primaryName,
      alternateName,
      primaryFlowVph,
      alternateFlowVph,
      primaryTimeMin,
      alternateTimeMin,
      diversionPct,
      vmsActive,
      incidentFactor,
    };
  }, [
    primaryName,
    alternateName,
    primaryFlowVph,
    alternateFlowVph,
    primaryTimeMin,
    alternateTimeMin,
    diversionPct,
    vmsActive,
    incidentFactor,
  ]);

  const vehiclesRef = useRef<ForkVehicle[]>([]);
  const nextIdRef = useRef<number>(1);
  const animRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let simClock = 0;
    let lastTime = performance.now();
    const rng = makeRng(4419 + resetToken);
    let nextSpawnTime = 0;

    // Instant prefill routine so traffic is immediately active across all corridors
    const prefillCorridors = () => {
      vehiclesRef.current = [];
      const { diversionPct, incidentFactor } = propsRef.current;

      // 1. Seed Approach lanes (Lanes 0 to 3)
      for (let lane = 0; lane < 4; lane++) {
        let x = 20 + rng() * 35;
        while (x < APPROACH_END_X - 15) {
          const spec = sampleVehicleClass(rng, 10);
          const chooseAlternate = lane >= 2 || rng() < diversionPct / 100;
          const assignedLane = chooseAlternate ? (lane >= 2 ? lane : 2 + (lane % 2)) : (lane < 2 ? lane : lane % 2);

          const { y, heading } = getLaneTrajectory(assignedLane, x);
          vehiclesRef.current.push({
            id: nextIdRef.current++,
            x,
            y,
            lane: assignedLane,
            currentLaneY: y,
            speed: (75 / 3.6) * 3.2 * (0.92 + rng() * 0.16),
            desiredSpeed: (80 / 3.6) * 3.2,
            heading,
            branch: chooseAlternate ? 'alternate' : 'primary',
            spec,
            color: pickColor(rng, spec),
            braking: false,
            blinkingRight: chooseAlternate && lane < 2,
            blinkingLeft: !chooseAlternate && lane >= 2,
          });
          x += 45 + rng() * 35;
        }
      }

      // 2. Seed Primary upper corridor (Lanes 0 and 1)
      for (let lane = 0; lane < 2; lane++) {
        let x = APPROACH_END_X + 20 + rng() * 30;
        while (x < W - 20) {
          const spec = sampleVehicleClass(rng, 10);
          const { y, heading } = getLaneTrajectory(lane, x);
          // If incident is present, vehicles near the incident crawl slowly
          const distToIncident = 740 - x;
          const isNearIncident = incidentFactor > 1.15 && distToIncident < 220 && distToIncident > -30;
          const speedFactor = isNearIncident ? Math.max(0.2, 1.0 / (incidentFactor * 1.5)) : 0.95;

          vehiclesRef.current.push({
            id: nextIdRef.current++,
            x,
            y,
            lane,
            currentLaneY: y,
            speed: (75 / 3.6) * 3.2 * speedFactor * (0.95 + rng() * 0.1),
            desiredSpeed: (80 / 3.6) * 3.2 * speedFactor,
            heading,
            branch: 'primary',
            spec,
            color: pickColor(rng, spec),
            braking: isNearIncident,
            blinkingRight: false,
            blinkingLeft: false,
          });
          x += (isNearIncident ? 22 : 40) + rng() * 30;
        }
      }

      // 3. Seed Alternate lower corridor (Lanes 2 and 3)
      for (let lane = 2; lane < 4; lane++) {
        let x = APPROACH_END_X + 20 + rng() * 30;
        while (x < W - 20) {
          const spec = sampleVehicleClass(rng, 12);
          const { y, heading } = getLaneTrajectory(lane, x);
          vehiclesRef.current.push({
            id: nextIdRef.current++,
            x,
            y,
            lane,
            currentLaneY: y,
            speed: (85 / 3.6) * 3.2 * (0.95 + rng() * 0.1),
            desiredSpeed: (90 / 3.6) * 3.2,
            heading,
            branch: 'alternate',
            spec,
            color: pickColor(rng, spec),
            braking: false,
            blinkingRight: false,
            blinkingLeft: false,
          });
          x += 38 + rng() * 30;
        }
      }
    };

    if (vehiclesRef.current.length === 0) {
      prefillCorridors();
    }

    const render = (time: number) => {
      const dtReal = Math.min((time - lastTime) / 1000, 0.05);
      lastTime = time;

      const {
        primaryName,
        alternateName,
        primaryFlowVph,
        alternateFlowVph,
        primaryTimeMin,
        alternateTimeMin,
        diversionPct,
        vmsActive,
        incidentFactor,
      } = propsRef.current;

      // -----------------------------------------------------------------------
      // 1. VEHICLE DYNAMICS & INJECTION (60 FPS)
      // -----------------------------------------------------------------------
      if (isPlaying) {
        simClock += dtReal * 1.5; // Smooth time scale

        // Total demand injection into the 4 approach lanes
        const totalFlow = Math.max(2000, primaryFlowVph + alternateFlowVph);
        const spawnInterval = 3600 / totalFlow / 4; // per lane average

        if (simClock >= nextSpawnTime && vehiclesRef.current.length < 85) {
          // Choose injection lane 0 to 3
          const spawnLane = Math.floor(rng() * 4);
          const chooseAlternate = rng() < diversionPct / 100;
          // Target corridor lane: if Alternate, must end up in Lane 2 or 3; if Primary, Lane 0 or 1
          const targetLane = chooseAlternate ? 2 + (spawnLane % 2) : spawnLane % 2;

          const spec = sampleVehicleClass(rng, 10);
          const { y, heading } = getLaneTrajectory(spawnLane, -15);

          vehiclesRef.current.push({
            id: nextIdRef.current++,
            x: -15,
            y,
            lane: targetLane,
            currentLaneY: y,
            speed: (70 / 3.6) * 3.2 * (0.92 + rng() * 0.16),
            desiredSpeed: (80 / 3.6) * 3.2,
            heading,
            branch: chooseAlternate ? 'alternate' : 'primary',
            spec,
            color: pickColor(rng, spec),
            braking: false,
            blinkingRight: chooseAlternate && spawnLane < 2,
            blinkingLeft: !chooseAlternate && spawnLane >= 2,
          });

          nextSpawnTime = simClock + Math.max(0.12, spawnInterval * (0.6 + rng() * 0.8));
        }

        // Update Vehicles along exact trajectories
        for (const veh of vehiclesRef.current) {
          // Desired speed modified by corridor & incident
          let desired = (80 / 3.6) * 3.2; // default ~70 km/h in px/s

          if (veh.branch === 'primary') {
            if (incidentFactor > 1.05) {
              // Bottleneck obstruction at x = 740 on Primary
              const distToIncident = 740 - veh.x;
              if (distToIncident > 0 && distToIncident < 240) {
                const severe = Math.min(1, (240 - distToIncident) / 200);
                const crawlSpeed = (20 / 3.6) * 3.2 / (incidentFactor * 0.9);
                desired = desired * (1 - severe) + crawlSpeed * severe;
              } else if (distToIncident <= 0 && distToIncident > -60) {
                desired = (25 / 3.6) * 3.2; // slow crawl past incident
              }
            }
          } else {
            // Alternate corridor: free flow at 90 km/h
            desired = (90 / 3.6) * 3.2;
          }

          // Car-following: detect leader ahead in the same branch/lane
          let gapPx = 250;
          let leaderSpeed = veh.speed;

          for (const other of vehiclesRef.current) {
            if (other.id === veh.id) continue;
            // On approach, compare target lane; after divergence, compare branch
            const sameCorridor =
              veh.x < APPROACH_END_X
                ? other.lane === veh.lane
                : other.branch === veh.branch && Math.abs(other.lane - veh.lane) <= 1;

            if (sameCorridor && other.x > veh.x && other.x - veh.x < gapPx) {
              gapPx = other.x - veh.x;
              leaderSpeed = other.speed;
            }
          }

          // IDM car-following acceleration
          const gapM = Math.max(0.5, (gapPx - 20) / 3.2);
          const currentSpeedMs = veh.speed / 3.2;
          const desiredSpeedMs = desired / 3.2;
          const leaderSpeedMs = leaderSpeed / 3.2;

          const accelMs2 = idmAcceleration(
            currentSpeedMs,
            desiredSpeedMs,
            gapM,
            leaderSpeedMs,
            veh.spec,
            1,
            1
          );

          veh.speed = Math.max(1.5, veh.speed + accelMs2 * 3.2 * dtReal);
          veh.x += veh.speed * dtReal;

          // Smooth lane change transverse translation prior to the fork (X in [60, 300])
          const targetCenter = getLaneTrajectory(veh.lane, veh.x);
          veh.currentLaneY += (targetCenter.y - veh.currentLaneY) * Math.min(1, dtReal * 4.5);
          veh.y = veh.currentLaneY;
          veh.heading = targetCenter.heading;

          // Turn blinkers off once settled into the correct lane before fork
          if (veh.x > APPROACH_END_X - 40) {
            veh.blinkingRight = false;
            veh.blinkingLeft = false;
          }

          veh.braking = accelMs2 < -0.6 || (veh.speed < (25 / 3.6) * 3.2 && incidentFactor > 1.15 && veh.branch === 'primary');
        }

        // Cleanup offscreen vehicles
        vehiclesRef.current = vehiclesRef.current.filter((v) => v.x <= W + 50);
      }

      // -----------------------------------------------------------------------
      // 2. CANVAS DRAWING (CRISP 60 FPS)
      // -----------------------------------------------------------------------
      ctx.clearRect(0, 0, W, H);
      ctx.direction = 'ltr';
      ctx.textAlign = 'left';

      // Deep Dark Backdrop
      ctx.fillStyle = '#060a12';
      ctx.fillRect(0, 0, W, H);

      // 2.1 Draw Approach Road (4 Lanes, X from 0 to APPROACH_END_X)
      const appTop = Y_APPROACH_CENTER - 2 * LANE_W;
      const appH = 4 * LANE_W;

      ctx.fillStyle = '#0f172a'; // Premium asphalt
      ctx.fillRect(0, appTop, APPROACH_END_X, appH);

      // 2.2 Draw Upper Corridor Asphalt (Primary)
      ctx.beginPath();
      ctx.moveTo(APPROACH_END_X, appTop);
      ctx.bezierCurveTo(
        APPROACH_END_X + 90,
        appTop,
        PRIMARY_MERGE_X - 90,
        Y_PRIMARY_CENTER - LANE_W,
        PRIMARY_MERGE_X,
        Y_PRIMARY_CENTER - LANE_W
      );
      ctx.lineTo(W, Y_PRIMARY_CENTER - LANE_W);
      ctx.lineTo(W, Y_PRIMARY_CENTER + LANE_W);
      ctx.lineTo(PRIMARY_MERGE_X, Y_PRIMARY_CENTER + LANE_W);
      ctx.bezierCurveTo(
        PRIMARY_MERGE_X - 90,
        Y_PRIMARY_CENTER + LANE_W,
        APPROACH_END_X + 90,
        Y_APPROACH_CENTER,
        APPROACH_END_X,
        Y_APPROACH_CENTER
      );
      ctx.closePath();
      ctx.fillStyle = '#0f172a';
      ctx.fill();

      // 2.3 Draw Lower Corridor Asphalt (Alternate)
      ctx.beginPath();
      ctx.moveTo(APPROACH_END_X, Y_APPROACH_CENTER);
      ctx.bezierCurveTo(
        APPROACH_END_X + 90,
        Y_APPROACH_CENTER,
        ALTERNATE_MERGE_X - 90,
        Y_ALTERNATE_CENTER - LANE_W,
        ALTERNATE_MERGE_X,
        Y_ALTERNATE_CENTER - LANE_W
      );
      ctx.lineTo(W, Y_ALTERNATE_CENTER - LANE_W);
      ctx.lineTo(W, Y_ALTERNATE_CENTER + LANE_W);
      ctx.lineTo(ALTERNATE_MERGE_X, Y_ALTERNATE_CENTER + LANE_W);
      ctx.bezierCurveTo(
        ALTERNATE_MERGE_X - 90,
        Y_ALTERNATE_CENTER + LANE_W,
        APPROACH_END_X + 90,
        appTop + appH,
        APPROACH_END_X,
        appTop + appH
      );
      ctx.closePath();
      ctx.fillStyle = '#0f172a';
      ctx.fill();

      // 2.4 Draw Paved Gore Area between Primary and Alternate (Chevron safety marking)
      const goreStartX = APPROACH_END_X + 15;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(goreStartX, Y_APPROACH_CENTER);
      ctx.bezierCurveTo(
        goreStartX + 80,
        Y_APPROACH_CENTER,
        PRIMARY_MERGE_X - 80,
        Y_PRIMARY_CENTER + LANE_W,
        PRIMARY_MERGE_X,
        Y_PRIMARY_CENTER + LANE_W
      );
      ctx.lineTo(W, Y_PRIMARY_CENTER + LANE_W);
      ctx.lineTo(W, Y_ALTERNATE_CENTER - LANE_W);
      ctx.lineTo(ALTERNATE_MERGE_X, Y_ALTERNATE_CENTER - LANE_W);
      ctx.bezierCurveTo(
        ALTERNATE_MERGE_X - 80,
        Y_ALTERNATE_CENTER - LANE_W,
        goreStartX + 80,
        Y_APPROACH_CENTER,
        goreStartX,
        Y_APPROACH_CENTER
      );
      ctx.closePath();
      ctx.fillStyle = '#1e293b';
      ctx.fill();
      ctx.clip();

      // Diagonal Chevron hazard stripes in Gore Area
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 2.5;
      for (let cx = goreStartX; cx < W; cx += 22) {
        ctx.beginPath();
        ctx.moveTo(cx, Y_APPROACH_CENTER - 40);
        ctx.lineTo(cx + 25, Y_APPROACH_CENTER + 40);
        ctx.stroke();
      }
      ctx.restore();

      // Crash Cushion / Attenuator at tip of Gore
      ctx.fillStyle = '#f59e0b';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(goreStartX - 6, Y_APPROACH_CENTER - 5, 12, 10, 3);
      ctx.fill();
      ctx.stroke();

      // 2.5 Draw Lane Markings
      // Outer Shoulders (Solid Yellow)
      ctx.strokeStyle = '#eab308';
      ctx.lineWidth = 1.5;

      // Top shoulder (Approach to Primary)
      ctx.beginPath();
      ctx.moveTo(0, appTop);
      ctx.lineTo(APPROACH_END_X, appTop);
      ctx.bezierCurveTo(
        APPROACH_END_X + 90,
        appTop,
        PRIMARY_MERGE_X - 90,
        Y_PRIMARY_CENTER - LANE_W,
        PRIMARY_MERGE_X,
        Y_PRIMARY_CENTER - LANE_W
      );
      ctx.lineTo(W, Y_PRIMARY_CENTER - LANE_W);
      ctx.stroke();

      // Bottom shoulder (Approach to Alternate)
      ctx.beginPath();
      ctx.moveTo(0, appTop + appH);
      ctx.lineTo(APPROACH_END_X, appTop + appH);
      ctx.bezierCurveTo(
        APPROACH_END_X + 90,
        appTop + appH,
        ALTERNATE_MERGE_X - 90,
        Y_ALTERNATE_CENTER + LANE_W,
        ALTERNATE_MERGE_X,
        Y_ALTERNATE_CENTER + LANE_W
      );
      ctx.lineTo(W, Y_ALTERNATE_CENTER + LANE_W);
      ctx.stroke();

      // Inner gore borders (White solid)
      ctx.strokeStyle = '#f8fafc';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(goreStartX, Y_APPROACH_CENTER);
      ctx.bezierCurveTo(
        goreStartX + 80,
        Y_APPROACH_CENTER,
        PRIMARY_MERGE_X - 80,
        Y_PRIMARY_CENTER + LANE_W,
        PRIMARY_MERGE_X,
        Y_PRIMARY_CENTER + LANE_W
      );
      ctx.lineTo(W, Y_PRIMARY_CENTER + LANE_W);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(goreStartX, Y_APPROACH_CENTER);
      ctx.bezierCurveTo(
        goreStartX + 80,
        Y_APPROACH_CENTER,
        ALTERNATE_MERGE_X - 80,
        Y_ALTERNATE_CENTER - LANE_W,
        ALTERNATE_MERGE_X,
        Y_ALTERNATE_CENTER - LANE_W
      );
      ctx.lineTo(W, Y_ALTERNATE_CENTER - LANE_W);
      ctx.stroke();

      // Dashed lane divider lines
      ctx.strokeStyle = '#475569';
      ctx.lineWidth = 1;
      ctx.setLineDash([7, 7]);

      // Approach Lane dividers (between L0-L1 and L2-L3)
      // Divider 1 (L0-L1) extends into Primary
      ctx.beginPath();
      ctx.moveTo(0, LANE_APPROACH_Y[0] + LANE_W / 2);
      ctx.lineTo(APPROACH_END_X, LANE_APPROACH_Y[0] + LANE_W / 2);
      ctx.bezierCurveTo(
        APPROACH_END_X + 90,
        LANE_APPROACH_Y[0] + LANE_W / 2,
        PRIMARY_MERGE_X - 90,
        Y_PRIMARY_CENTER,
        PRIMARY_MERGE_X,
        Y_PRIMARY_CENTER
      );
      ctx.lineTo(W, Y_PRIMARY_CENTER);
      ctx.stroke();

      // Divider 2 (L2-L3) extends into Alternate
      ctx.beginPath();
      ctx.moveTo(0, LANE_APPROACH_Y[2] + LANE_W / 2);
      ctx.lineTo(APPROACH_END_X, LANE_APPROACH_Y[2] + LANE_W / 2);
      ctx.bezierCurveTo(
        APPROACH_END_X + 90,
        LANE_APPROACH_Y[2] + LANE_W / 2,
        ALTERNATE_MERGE_X - 90,
        Y_ALTERNATE_CENTER,
        ALTERNATE_MERGE_X,
        Y_ALTERNATE_CENTER
      );
      ctx.lineTo(W, Y_ALTERNATE_CENTER);
      ctx.stroke();

      // Center Divider on approach (between L1 and L2 up to fork)
      ctx.beginPath();
      ctx.moveTo(0, Y_APPROACH_CENTER);
      ctx.lineTo(goreStartX, Y_APPROACH_CENTER);
      ctx.stroke();
      ctx.setLineDash([]);

      // 2.6 Incident Marker & Bottleneck Representation on Primary
      if (incidentFactor > 1.05) {
        const incX = 740;
        const incY = LANE_PRIMARY_Y[0];

        // Flashing hazard zone glow
        const pulse = (Math.sin(simClock * 6) + 1) / 2;
        ctx.fillStyle = `rgba(239, 68, 68, ${0.15 + pulse * 0.25})`;
        ctx.beginPath();
        ctx.arc(incX, incY, 26, 0, Math.PI * 2);
        ctx.fill();

        // Safety Traffic Cones
        for (let c = -14; c <= 14; c += 7) {
          ctx.fillStyle = '#f97316';
          ctx.fillRect(incX + c - 2, incY + 7, 4, 4);
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(incX + c - 1.5, incY + 8, 3, 1.5);
        }

        // Disabled Vehicle / Incident Van
        ctx.fillStyle = '#ef4444';
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(incX - 10, incY - 5, 20, 10, 2);
        ctx.fill();
        ctx.stroke();

        // Flashing amber emergency beacon on roof
        ctx.fillStyle = pulse > 0.5 ? '#f59e0b' : '#3b82f6';
        ctx.beginPath();
        ctx.arc(incX, incY, 3, 0, Math.PI * 2);
        ctx.fill();

        // Incident Badge Tag
        ctx.fillStyle = '#ef4444';
        ctx.font = 'bold 9px monospace';
        ctx.fillText(`⚠️ BOTTLENECK (x${incidentFactor.toFixed(1)})`, incX - 45, incY - 14);
      }

      // 2.7 OVERHEAD VMS GANTRY AT APPROACH (X = 220)
      const gantryX = 220;
      // Steel support pillars
      ctx.fillStyle = '#475569';
      ctx.fillRect(gantryX - 4, appTop - 18, 8, appH + 36);

      // Overhead VMS Display Screen
      const vmsBoxW = 190;
      const vmsBoxH = 26;
      const vmsBoxX = gantryX - vmsBoxW / 2;
      const vmsBoxY = appTop - 36;

      ctx.fillStyle = '#020617';
      ctx.strokeStyle = vmsActive ? '#38bdf8' : '#64748b';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(vmsBoxX, vmsBoxY, vmsBoxW, vmsBoxH, 5);
      ctx.fill();
      ctx.stroke();

      // VMS Text & LED Beacons
      const blinkAmber = Math.floor(simClock * 3) % 2 === 0;
      ctx.fillStyle = blinkAmber ? '#f59e0b' : '#78350f';
      ctx.beginPath();
      ctx.arc(vmsBoxX + 10, vmsBoxY + vmsBoxH / 2, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(vmsBoxX + vmsBoxW - 10, vmsBoxY + vmsBoxH / 2, 4, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = vmsActive ? '#34d399' : '#f59e0b';
      ctx.font = 'bold 9px JetBrains Mono, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if (vmsActive) {
        ctx.fillText(
          isAr ? `توجيه ذكي: روض الفرج ${Math.round(diversionPct)}%` : `VMS: DIVERT TO ALT ${Math.round(diversionPct)}%`,
          vmsBoxX + vmsBoxW / 2,
          vmsBoxY + vmsBoxH / 2
        );
      } else {
        ctx.fillText(
          isAr ? 'حركة طبيعية بالمحورين' : 'VMS: ALL ROUTES NORMAL',
          vmsBoxX + vmsBoxW / 2,
          vmsBoxY + vmsBoxH / 2
        );
      }
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';

      // Lane Guide Arrows directly on gantry
      const arrowY = appTop - 6;
      ctx.font = 'bold 11px monospace';
      ctx.fillStyle = '#38bdf8';
      ctx.fillText('↑', gantryX - 6, LANE_APPROACH_Y[0] + 4);
      ctx.fillText('↑', gantryX - 6, LANE_APPROACH_Y[1] + 4);
      ctx.fillStyle = '#34d399';
      ctx.fillText('↗', gantryX - 6, LANE_APPROACH_Y[2] + 4);
      ctx.fillText('↗', gantryX - 6, LANE_APPROACH_Y[3] + 4);

      // 2.8 DRAW ALL VEHICLES WITH RICH MODULE #01 AESTHETICS
      const blinkState = Math.floor(simClock * 4) % 2 === 0;

      for (const veh of vehiclesRef.current) {
        if (veh.x < -30 || veh.x > W + 30) continue;

        ctx.save();
        ctx.translate(veh.x, veh.y);
        ctx.rotate(veh.heading);

        const lenPx = veh.spec.lengthM * 3.2;
        const widPx = veh.spec.widthM * 4.2;

        // Vehicle Soft Drop Shadow
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        ctx.beginPath();
        ctx.roundRect(-lenPx / 2 + 2, -widPx / 2 + 2, lenPx, widPx, 2.5);
        ctx.fill();

        // Vehicle Body
        ctx.fillStyle = veh.color;
        ctx.beginPath();
        ctx.roundRect(-lenPx / 2, -widPx / 2, lenPx, widPx, 2.5);
        ctx.fill();

        // Dark Tinted Windshield & Rear Window
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(lenPx * 0.08, -widPx * 0.35, lenPx * 0.22, widPx * 0.7);
        ctx.fillRect(-lenPx * 0.35, -widPx * 0.35, lenPx * 0.12, widPx * 0.7);

        // Dual Front Headlights (White beams)
        ctx.fillStyle = '#f8fafc';
        ctx.fillRect(lenPx / 2 - 2, -widPx / 2 + 1, 2.5, 2);
        ctx.fillRect(lenPx / 2 - 2, widPx / 2 - 3, 2.5, 2);

        // Blinking Amber Turn Signals for Lane Changes
        if (blinkState) {
          ctx.fillStyle = '#f59e0b';
          ctx.shadowColor = '#f59e0b';
          ctx.shadowBlur = 6;
          if (veh.blinkingRight) {
            ctx.fillRect(lenPx / 2 - 2, widPx / 2 - 2.5, 2.5, 2.5);
            ctx.fillRect(-lenPx / 2, widPx / 2 - 2.5, 2.5, 2.5);
          } else if (veh.blinkingLeft) {
            ctx.fillRect(lenPx / 2 - 2, -widPx / 2, 2.5, 2.5);
            ctx.fillRect(-lenPx / 2, -widPx / 2, 2.5, 2.5);
          }
          ctx.shadowBlur = 0;
        }

        // Taillights & Dynamic Red Brake Glow
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

      // 2.9 LIVE HUD BADGES ON CORRIDORS
      // Primary Route HUD (Top Right)
      const hudW = 210;
      const hudH = 34;

      ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
      ctx.strokeStyle = incidentFactor > 1.2 ? '#ef4444' : '#38bdf8';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(W - hudW - 12, 10, hudW, hudH, 6);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 10px JetBrains Mono, monospace';
      ctx.fillText(`PRIMARY: ${primaryName}`, W - hudW - 4, 23);
      ctx.fillStyle = incidentFactor > 1.2 ? '#ef4444' : '#38bdf8';
      ctx.font = '9px JetBrains Mono, monospace';
      ctx.fillText(
        `⏱️ ${primaryTimeMin.toFixed(1)} min | 🚗 ${Math.round(primaryFlowVph)} vph`,
        W - hudW - 4,
        37
      );

      // Alternate Route HUD (Bottom Right)
      ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
      ctx.strokeStyle = '#34d399';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(W - hudW - 12, H - hudH - 10, hudW, hudH, 6);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 10px JetBrains Mono, monospace';
      ctx.fillText(`ALTERNATE: ${alternateName}`, W - hudW - 4, H - hudH + 3);
      ctx.fillStyle = '#34d399';
      ctx.font = '9px JetBrains Mono, monospace';
      ctx.fillText(
        `⏱️ ${alternateTimeMin.toFixed(1)} min | 🚗 ${Math.round(alternateFlowVph)} vph`,
        W - hudW - 4,
        H - hudH + 17
      );

      animRef.current = requestAnimationFrame(render);
    };

    animRef.current = requestAnimationFrame(render);
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [resetToken, isPlaying, isAr]);

  return (
    <div className="relative rounded-xl overflow-hidden border border-slate-800 bg-slate-950 shadow-2xl">
      <div className="absolute top-3 left-3 z-10 flex items-center gap-2">
        <button
          onClick={() => setIsPlaying(!isPlaying)}
          className="p-1.5 bg-slate-900/80 hover:bg-slate-800 text-slate-300 rounded-lg border border-slate-700 backdrop-blur-md transition"
          title={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? <Pause className="w-3.5 h-3.5 text-amber-400" /> : <Play className="w-3.5 h-3.5 text-emerald-400" />}
        </button>

        <button
          onClick={() => {
            vehiclesRef.current = [];
            setResetToken((t) => t + 1);
          }}
          className="p-1.5 bg-slate-900/80 hover:bg-slate-800 text-slate-300 rounded-lg border border-slate-700 backdrop-blur-md transition"
          title="Reset Corridor Traffic"
        >
          <RefreshCw className="w-3.5 h-3.5 text-slate-400" />
        </button>
      </div>

      <canvas
        ref={canvasRef}
        width={W}
        height={H}
        className="w-full h-[260px] block"
      />

      {/* Legend & Physics Specs */}
      <div className="bg-slate-900/90 border-t border-slate-800 px-4 py-2 flex flex-wrap items-center justify-between gap-3 text-[11px] text-slate-400">
        <div className="flex items-center gap-4 flex-wrap">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-cyan-400" />
            <span>{isAr ? 'المحور الرئيسي (26 يوليو)' : 'Primary Corridor (26th July)'}</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
            <span>
              {isAr ? `المحور البديل (تحويل ${Math.round(diversionPct)}%)` : `Diverted via Alternate (${Math.round(diversionPct)}%)`}
            </span>
          </span>
          {incidentFactor > 1.05 && (
            <span className="flex items-center gap-1.5 text-rose-400 font-bold animate-pulse">
              <Zap className="w-3.5 h-3.5 text-rose-400" />
              <span>
                {isAr
                  ? `عائق مروري بالمحور الرئيسي (تأخير x${incidentFactor.toFixed(1)})`
                  : `Primary Bottleneck (x${incidentFactor.toFixed(1)} delay)`}
              </span>
            </span>
          )}
        </div>
        <div className="text-slate-500 font-mono text-[10px]">
          {isAr
            ? 'النمذجة: دالة BPR لسلوك المسارات وتوازن Wardrop الحركي'
            : 'Physics: BPR Link-Performance & Wardrop User Equilibrium'}
        </div>
      </div>
    </div>
  );
};

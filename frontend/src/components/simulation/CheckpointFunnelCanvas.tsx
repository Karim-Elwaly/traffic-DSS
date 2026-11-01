import React, { useEffect, useRef, useState } from 'react';
import { ShieldCheck, Zap, AlertCircle, Play, Pause, RefreshCw, Radio } from 'lucide-react';
import { Language } from '../../i18n/translations';
import {
  VehicleClassSpec,
  VEHICLE_CLASSES,
  idmAcceleration,
  makeRng,
  sampleVehicleClass,
  pickColor,
} from '../../simulation/microsim';

interface CheckpointFunnelCanvasProps {
  totalBooths: number;
  openBooths: number;
  inboundFlowVph: number;
  avgWaitSec: number;
  queueMeters: number;
  greenBypassActive: boolean;
  boothType: string;
  language?: Language;
}

interface PlazaVehicle {
  id: number;
  x: number;
  y: number;
  targetBooth: number;
  approachLane: number;
  downstreamLane: number;
  speed: number;        // px/s (1m ≈ 2.8px, 60km/h ≈ 46px/s)
  desiredSpeed: number;
  heading: number;      // Radians tangent to funnel spline
  state: 'approaching' | 'queued' | 'servicing' | 'departing';
  spec: VehicleClassSpec;
  color: string;
  serviceTimer: number; // Seconds required at the toll window
  braking: boolean;
  lengthPx: number;
  widthPx: number;
}

const W = 960;
const H = 260;

// Longitudinal Plaza Layout Milestones
const X_APPROACH_END = 180;
const X_FUNNEL_END = 450;
const X_GATE = 490;
const X_MERGE_START = 530;
const X_DOWNSTREAM_START = 760;

// Lateral Geometry (Approach & Downstream 4 Lanes)
const Y_CENTER = 130;
const APP_LANE_H = 22;
const APP_TOP_Y = Y_CENTER - 2 * APP_LANE_H; // 86 px
const APP_BOTTOM_Y = Y_CENTER + 2 * APP_LANE_H; // 174 px

const getApproachLaneY = (laneIdx: number) => {
  return APP_TOP_Y + (laneIdx + 0.5) * APP_LANE_H;
};

export const CheckpointFunnelCanvas: React.FC<CheckpointFunnelCanvasProps> = ({
  totalBooths,
  openBooths,
  inboundFlowVph,
  avgWaitSec,
  queueMeters,
  greenBypassActive,
  boothType,
  language = 'ar',
}) => {
  const isAr = language === 'ar';
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [resetToken, setResetToken] = useState<number>(0);

  // Persistent props ref for 60fps real-time updates without restarting the animation loop
  const propsRef = useRef({
    totalBooths,
    openBooths,
    inboundFlowVph,
    avgWaitSec,
    queueMeters,
    greenBypassActive,
    boothType,
  });

  useEffect(() => {
    propsRef.current = {
      totalBooths,
      openBooths,
      inboundFlowVph,
      avgWaitSec,
      queueMeters,
      greenBypassActive,
      boothType,
    };
  }, [totalBooths, openBooths, inboundFlowVph, avgWaitSec, queueMeters, greenBypassActive, boothType]);

  const vehiclesRef = useRef<PlazaVehicle[]>([]);
  const nextIdRef = useRef<number>(1);
  const animRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let simClock = 0;
    let lastTime = performance.now();
    const rng = makeRng(7731 + resetToken);
    let nextSpawnTime = 0;

    // Helper: calculate Booth Center Y
    const getBoothCenterY = (bIdx: number, bTotal: number) => {
      const plazaTotalHeight = 200;
      const spacing = plazaTotalHeight / bTotal;
      const startY = (H - plazaTotalHeight) / 2;
      return startY + (bIdx + 0.5) * spacing;
    };

    // Helper: compute continuous path (x, y, heading) for a vehicle assigned to a booth
    const getTrajectory = (
      veh: { approachLane: number; targetBooth: number; downstreamLane: number },
      x: number,
      bTotal: number
    ): { y: number; heading: number } => {
      const yApp = getApproachLaneY(veh.approachLane);
      const yBooth = getBoothCenterY(veh.targetBooth, bTotal);
      const yDown = getApproachLaneY(veh.downstreamLane);

      if (x <= X_APPROACH_END) {
        return { y: yApp, heading: 0 };
      } else if (x < X_FUNNEL_END) {
        // Approach to Booth Funnel Spline
        const span = X_FUNNEL_END - X_APPROACH_END;
        const u = (x - X_APPROACH_END) / span;
        const s = 3 * u * u - 2 * u * u * u;
        const ds_du = 6 * u * (1 - u);
        const dy_dx = ((yBooth - yApp) * ds_du) / span;
        return {
          y: yApp + (yBooth - yApp) * s,
          heading: Math.atan(dy_dx),
        };
      } else if (x <= X_MERGE_START) {
        // Straight through the toll booth island
        return { y: yBooth, heading: 0 };
      } else if (x < X_DOWNSTREAM_START) {
        // Booth to Downstream Merge Spline
        const span = X_DOWNSTREAM_START - X_MERGE_START;
        const u = (x - X_MERGE_START) / span;
        const s = 3 * u * u - 2 * u * u * u;
        const ds_du = 6 * u * (1 - u);
        const dy_dx = ((yDown - yBooth) * ds_du) / span;
        return {
          y: yBooth + (yDown - yBooth) * s,
          heading: Math.atan(dy_dx),
        };
      } else {
        // Straight downstream highway
        return { y: yDown, heading: 0 };
      }
    };

    // Instant prefill routine to populate approach, queues, and departure lanes on frame 0
    const prefillTollPlaza = () => {
      vehiclesRef.current = [];
      const { totalBooths: bTotal, openBooths: bOpen, boothType: bType, greenBypassActive: gBypass } = propsRef.current;

      // 1. Seed approach highway vehicles
      for (let lane = 0; lane < 4; lane++) {
        let x = 15 + rng() * 25;
        while (x < X_APPROACH_END - 10) {
          const spec = sampleVehicleClass(rng, 15);
          const targetB = Math.floor(rng() * Math.max(1, bOpen));
          const downLane = Math.floor(rng() * 4);
          const traj = getTrajectory({ approachLane: lane, targetBooth: targetB, downstreamLane: downLane }, x, bTotal);

          vehiclesRef.current.push({
            id: nextIdRef.current++,
            x,
            y: traj.y,
            targetBooth: targetB,
            approachLane: lane,
            downstreamLane: downLane,
            speed: (65 / 3.6) * 2.8 * (0.92 + rng() * 0.16),
            desiredSpeed: (70 / 3.6) * 2.8,
            heading: traj.heading,
            state: 'approaching',
            spec,
            color: pickColor(rng, spec),
            serviceTimer: bType === 'rfid' ? 0.35 : bType === 'security' ? 2.0 : 0.8,
            braking: false,
            lengthPx: Math.max(16, spec.lengthM * 2.8),
            widthPx: Math.max(8, spec.widthM * 3.8),
          });
          x += 35 + rng() * 25;
        }
      }

      // 2. Seed Queued vehicles in front of open booths
      for (let b = 0; b < bOpen; b++) {
        // 1 to 3 cars queued per open booth
        const queueCount = gBypass ? 1 : 1 + Math.floor(rng() * 3);
        let curX = X_GATE - 15;

        for (let q = 0; q < queueCount; q++) {
          const spec = sampleVehicleClass(rng, 15);
          const appLane = Math.min(3, Math.floor((b * 4) / bTotal));
          const downLane = appLane;
          const traj = getTrajectory({ approachLane: appLane, targetBooth: b, downstreamLane: downLane }, curX, bTotal);

          const isAtWindow = q === 0;
          vehiclesRef.current.push({
            id: nextIdRef.current++,
            x: curX,
            y: traj.y,
            targetBooth: b,
            approachLane: appLane,
            downstreamLane: downLane,
            speed: isAtWindow && gBypass ? 35 : 0,
            desiredSpeed: (40 / 3.6) * 2.8,
            heading: traj.heading,
            state: isAtWindow ? 'servicing' : 'queued',
            spec,
            color: pickColor(rng, spec),
            serviceTimer: isAtWindow ? (bType === 'rfid' ? 0.25 : 0.6 + rng() * 0.6) : 1.0,
            braking: !gBypass,
            lengthPx: Math.max(16, spec.lengthM * 2.8),
            widthPx: Math.max(8, spec.widthM * 3.8),
          });

          curX -= (Math.max(16, spec.lengthM * 2.8) + 8 + rng() * 6);
        }
      }

      // 3. Seed departing vehicles downstream
      for (let lane = 0; lane < 4; lane++) {
        let x = X_MERGE_START + 25 + rng() * 30;
        while (x < W - 20) {
          const spec = sampleVehicleClass(rng, 12);
          const targetB = Math.min(bTotal - 1, lane * 2);
          const traj = getTrajectory({ approachLane: lane, targetBooth: targetB, downstreamLane: lane }, x, bTotal);

          vehiclesRef.current.push({
            id: nextIdRef.current++,
            x,
            y: traj.y,
            targetBooth: targetB,
            approachLane: lane,
            downstreamLane: lane,
            speed: (60 / 3.6) * 2.8 * (0.95 + rng() * 0.1),
            desiredSpeed: (75 / 3.6) * 2.8,
            heading: traj.heading,
            state: 'departing',
            spec,
            color: pickColor(rng, spec),
            serviceTimer: 0,
            braking: false,
            lengthPx: Math.max(16, spec.lengthM * 2.8),
            widthPx: Math.max(8, spec.widthM * 3.8),
          });
          x += 40 + rng() * 35;
        }
      }
    };

    if (vehiclesRef.current.length === 0) {
      prefillTollPlaza();
    }

    const render = (time: number) => {
      const dtReal = Math.min((time - lastTime) / 1000, 0.05);
      lastTime = time;

      const {
        totalBooths: bTotal,
        openBooths: bOpen,
        inboundFlowVph: flowVph,
        avgWaitSec: waitSec,
        queueMeters: qMeters,
        greenBypassActive: gBypass,
        boothType: bType,
      } = propsRef.current;

      const plazaTotalHeight = 200;
      const boothSpacing = plazaTotalHeight / bTotal;
      const boothStartY = (H - plazaTotalHeight) / 2;

      // -----------------------------------------------------------------------
      // 1. VEHICLE SIMULATION & M/M/c QUEUE PHYSICS (60 FPS)
      // -----------------------------------------------------------------------
      if (isPlaying) {
        simClock += dtReal * 1.6;

        // Vehicle injection based on inbound flow
        const spawnInterval = 3600 / Math.max(600, flowVph) / 4;
        if (simClock >= nextSpawnTime && vehiclesRef.current.length < 85) {
          const lane = Math.floor(rng() * 4);
          // Allocate to an open booth (or closest open booth)
          const targetB = bOpen > 0 ? Math.floor(rng() * bOpen) : 0;
          const downLane = Math.min(3, Math.floor((targetB * 4) / bTotal));
          const spec = sampleVehicleClass(rng, 18);
          const traj = getTrajectory({ approachLane: lane, targetBooth: targetB, downstreamLane: downLane }, -15, bTotal);

          vehiclesRef.current.push({
            id: nextIdRef.current++,
            x: -15,
            y: traj.y,
            targetBooth: targetB,
            approachLane: lane,
            downstreamLane: downLane,
            speed: (65 / 3.6) * 2.8 * (0.92 + rng() * 0.16),
            desiredSpeed: (70 / 3.6) * 2.8,
            heading: traj.heading,
            state: 'approaching',
            spec,
            color: pickColor(rng, spec),
            serviceTimer: bType === 'rfid' ? 0.3 : bType === 'security' ? 2.2 : 0.85,
            braking: false,
            lengthPx: Math.max(16, spec.lengthM * 2.8),
            widthPx: Math.max(8, spec.widthM * 3.8),
          });

          nextSpawnTime = simClock + Math.max(0.12, spawnInterval * (0.6 + rng() * 0.8));
        }

        // Update Vehicles & Manage Queues
        // Group vehicles by booth to calculate physical bumper-to-bumper queueing
        const boothQueues: { [bIdx: number]: PlazaVehicle[] } = {};
        for (let b = 0; b < bTotal; b++) boothQueues[b] = [];

        for (const veh of vehiclesRef.current) {
          if (veh.x < X_MERGE_START) {
            boothQueues[veh.targetBooth]?.push(veh);
          }
        }

        // Sort each booth's queue by X descending (leader in front)
        for (let b = 0; b < bTotal; b++) {
          boothQueues[b].sort((a, b) => b.x - a.x);
        }

        for (const veh of vehiclesRef.current) {
          const traj = getTrajectory(veh, veh.x, bTotal);
          veh.y = traj.y;
          veh.heading = traj.heading;

          if (veh.state === 'approaching') {
            // Find car directly ahead in the same booth lane
            const queue = boothQueues[veh.targetBooth] || [];
            const aheadIdx = queue.findIndex((v) => v.id === veh.id) - 1;
            const carAhead = aheadIdx >= 0 ? queue[aheadIdx] : null;

            let stopTargetX = X_GATE - 15;
            if (carAhead) {
              stopTargetX = carAhead.x - (veh.lengthPx + 8);
            }

            if (gBypass) {
              // Emergency Green Bypass: Free flow through booth without stopping
              veh.desiredSpeed = (55 / 3.6) * 2.8;
              veh.speed += (veh.desiredSpeed - veh.speed) * dtReal * 2;
              veh.x += veh.speed * dtReal;
              veh.braking = false;
              if (veh.x >= X_GATE) {
                veh.state = 'departing';
              }
            } else if (veh.x >= stopTargetX - 2) {
              // Reached stop point or back of queue
              veh.x = Math.min(veh.x, stopTargetX);
              veh.speed = 0;
              veh.braking = true;
              if (!carAhead && veh.x >= X_GATE - 18) {
                veh.state = 'servicing';
              } else {
                veh.state = 'queued';
              }
            } else {
              // Approaching with IDM smooth braking toward stopTargetX
              const distToStop = Math.max(0.5, stopTargetX - veh.x);
              const targetSpeed = Math.min(veh.desiredSpeed, Math.sqrt(2 * 4.5 * (distToStop / 2.8)) * 2.8);
              veh.speed += (targetSpeed - veh.speed) * Math.min(1, dtReal * 4);
              veh.x += veh.speed * dtReal;
              veh.braking = veh.speed < targetSpeed || distToStop < 45;
            }
          } else if (veh.state === 'queued') {
            // In queue waiting for car ahead to advance
            const queue = boothQueues[veh.targetBooth] || [];
            const aheadIdx = queue.findIndex((v) => v.id === veh.id) - 1;
            const carAhead = aheadIdx >= 0 ? queue[aheadIdx] : null;

            const stopTargetX = carAhead ? carAhead.x - (veh.lengthPx + 8) : X_GATE - 15;

            if (gBypass) {
              veh.state = 'approaching';
            } else if (veh.x < stopTargetX - 4) {
              // Gap opened ahead! Move up in queue
              veh.speed = Math.min(18, veh.speed + 12 * dtReal);
              veh.x += veh.speed * dtReal;
              veh.braking = false;
            } else {
              veh.x = stopTargetX;
              veh.speed = 0;
              veh.braking = true;
              if (!carAhead && veh.x >= X_GATE - 18) {
                veh.state = 'servicing';
              }
            }
          } else if (veh.state === 'servicing') {
            // At the toll payment window
            veh.speed = 0;
            veh.braking = true;
            veh.serviceTimer -= dtReal;

            if (gBypass || veh.serviceTimer <= 0) {
              // Transaction complete! Gate lifts and vehicle departs
              veh.state = 'departing';
              veh.desiredSpeed = (65 / 3.6) * 2.8;
              veh.speed = (20 / 3.6) * 2.8;
              veh.braking = false;
            }
          } else if (veh.state === 'departing') {
            // Accelerating downstream into the merge funnel
            const desired = (75 / 3.6) * 2.8;
            veh.speed += (desired - veh.speed) * dtReal * 1.8;
            veh.x += veh.speed * dtReal;
            veh.braking = false;
          }
        }

        // Cleanup departed vehicles
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

      // 2.1 Draw Funnel Pavement Deck
      ctx.fillStyle = '#0f172a'; // Premium dark asphalt
      ctx.beginPath();
      // Approach Highway
      ctx.moveTo(0, APP_TOP_Y);
      ctx.lineTo(X_APPROACH_END, APP_TOP_Y);
      // Flare-out to Toll Plaza
      ctx.bezierCurveTo(
        X_APPROACH_END + 120,
        APP_TOP_Y,
        X_FUNNEL_END - 80,
        boothStartY,
        X_FUNNEL_END,
        boothStartY
      );
      // Through Toll Plaza
      ctx.lineTo(X_MERGE_START, boothStartY);
      // Contraction merge to Downstream Highway
      ctx.bezierCurveTo(
        X_MERGE_START + 80,
        boothStartY,
        X_DOWNSTREAM_START - 120,
        APP_TOP_Y,
        X_DOWNSTREAM_START,
        APP_TOP_Y
      );
      ctx.lineTo(W, APP_TOP_Y);
      ctx.lineTo(W, APP_BOTTOM_Y);
      ctx.lineTo(X_DOWNSTREAM_START, APP_BOTTOM_Y);
      ctx.bezierCurveTo(
        X_DOWNSTREAM_START - 120,
        APP_BOTTOM_Y,
        X_MERGE_START + 80,
        boothStartY + plazaTotalHeight,
        X_MERGE_START,
        boothStartY + plazaTotalHeight
      );
      ctx.lineTo(X_FUNNEL_END, boothStartY + plazaTotalHeight);
      ctx.bezierCurveTo(
        X_FUNNEL_END - 80,
        boothStartY + plazaTotalHeight,
        X_APPROACH_END + 120,
        APP_BOTTOM_Y,
        X_APPROACH_END,
        APP_BOTTOM_Y
      );
      ctx.lineTo(0, APP_BOTTOM_Y);
      ctx.closePath();
      ctx.fill();

      // Outer Road Shoulders (Solid Yellow)
      ctx.strokeStyle = '#eab308';
      ctx.lineWidth = 1.8;
      ctx.stroke();

      // 2.2 Draw Approach & Downstream Dashed Lane Dividers (4 Lanes)
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 1;
      ctx.setLineDash([8, 8]);
      for (let i = 1; i < 4; i++) {
        const y = APP_TOP_Y + i * APP_LANE_H;
        // Approach dashes
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(X_APPROACH_END, y);
        ctx.stroke();
        // Downstream dashes
        ctx.beginPath();
        ctx.moveTo(X_DOWNSTREAM_START, y);
        ctx.lineTo(W, y);
        ctx.stroke();
      }
      ctx.setLineDash([]);

      // 2.3 Draw Channeled Funnel Lane Guide Splines into Each Booth
      ctx.strokeStyle = 'rgba(71, 85, 105, 0.4)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 6]);
      for (let b = 1; b < bTotal; b++) {
        const yB = boothStartY + b * boothSpacing;
        const appLane = Math.min(3, Math.floor((b * 4) / bTotal));
        const yApp = APP_TOP_Y + appLane * APP_LANE_H;

        ctx.beginPath();
        ctx.moveTo(X_APPROACH_END, yApp);
        ctx.bezierCurveTo(
          X_APPROACH_END + 120,
          yApp,
          X_FUNNEL_END - 80,
          yB,
          X_FUNNEL_END,
          yB
        );
        ctx.lineTo(X_MERGE_START, yB);
        ctx.bezierCurveTo(
          X_MERGE_START + 80,
          yB,
          X_DOWNSTREAM_START - 120,
          yApp,
          X_DOWNSTREAM_START,
          yApp
        );
        ctx.stroke();
      }
      ctx.setLineDash([]);

      // 2.4 Draw Toll Plaza Canopy & Physical Concrete Islands
      // Canopy Overhead Shadow
      ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
      ctx.fillRect(X_FUNNEL_END - 10, boothStartY - 8, X_MERGE_START - X_FUNNEL_END + 20, plazaTotalHeight + 16);
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(X_FUNNEL_END - 10, boothStartY - 8, X_MERGE_START - X_FUNNEL_END + 20, plazaTotalHeight + 16);

      // Stop Line across all open booths
      ctx.strokeStyle = '#f8fafc';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(X_GATE - 12, boothStartY);
      ctx.lineTo(X_GATE - 12, boothStartY + plazaTotalHeight);
      ctx.stroke();

      const blink = Math.floor(simClock * 4) % 2 === 0;

      // Draw Individual Booth Cabins, Islands, & Gates
      for (let b = 0; b < bTotal; b++) {
        const by = getBoothCenterY(b, bTotal);
        const isOpen = b < bOpen;

        // Concrete Island Separator between lanes
        if (b < bTotal - 1) {
          const islandY = boothStartY + (b + 1) * boothSpacing;
          ctx.fillStyle = '#334155';
          ctx.beginPath();
          ctx.roundRect(X_GATE - 30, islandY - 3, 50, 6, 2);
          ctx.fill();

          // Yellow hazard stripes on island nose
          ctx.fillStyle = '#f59e0b';
          ctx.fillRect(X_GATE - 30, islandY - 2.5, 8, 5);
        }

        // Toll Booth Attendant Cabin
        ctx.fillStyle = '#1e293b';
        ctx.strokeStyle = isOpen ? '#0284c7' : '#991b1b';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(X_GATE - 8, by - 6, 16, 12, 2);
        ctx.fill();
        ctx.stroke();

        // Lane Number Badge
        ctx.fillStyle = isOpen ? '#38bdf8' : '#64748b';
        ctx.font = 'bold 8px monospace';
        ctx.fillText(`B${b + 1}`, X_GATE - 26, by + 3);

        // Electronic Gate Light & Barrier Arm
        if (gBypass) {
          // Emergency Green Bypass: All gates fully raised with flashing emerald beacons
          ctx.fillStyle = blink ? '#22c55e' : '#15803d';
          ctx.beginPath();
          ctx.arc(X_GATE + 14, by, 4.5, 0, Math.PI * 2);
          ctx.fill();

          // Barrier Arm lifted 60 deg up
          ctx.strokeStyle = '#22c55e';
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.moveTo(X_GATE + 8, by - 4);
          ctx.lineTo(X_GATE + 18, by - 14);
          ctx.stroke();
        } else if (isOpen) {
          // Normal Open Booth
          let beaconCol = '#38bdf8'; // Blue for cash
          if (bType === 'rfid' || (bType === 'mixed' && b % 2 === 0)) beaconCol = '#10b981'; // Emerald for ETC
          if (bType === 'security') beaconCol = '#f59e0b'; // Amber for Security

          ctx.fillStyle = beaconCol;
          ctx.beginPath();
          ctx.arc(X_GATE + 14, by, 4, 0, Math.PI * 2);
          ctx.fill();

          // Check if any car is actively servicing at this booth
          const isServicing = vehiclesRef.current.some((v) => v.targetBooth === b && v.state === 'servicing');
          const isDeparting = vehiclesRef.current.some((v) => v.targetBooth === b && v.state === 'departing' && v.x < X_GATE + 30);

          if (isDeparting) {
            // Gate arm opened up
            ctx.strokeStyle = '#10b981';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(X_GATE + 8, by - 4);
            ctx.lineTo(X_GATE + 18, by - 14);
            ctx.stroke();
          } else {
            // Gate arm down across the lane
            ctx.strokeStyle = isServicing ? '#ef4444' : '#e2e8f0';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(X_GATE + 8, by - boothSpacing * 0.35);
            ctx.lineTo(X_GATE + 8, by + boothSpacing * 0.35);
            ctx.stroke();
          }
        } else {
          // Closed Booth: Red 'X' and closed barrier
          ctx.strokeStyle = '#ef4444';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(X_GATE + 10, by - 4);
          ctx.lineTo(X_GATE + 18, by + 4);
          ctx.moveTo(X_GATE + 18, by - 4);
          ctx.lineTo(X_GATE + 10, by + 4);
          ctx.stroke();

          // Red barrier bar down
          ctx.strokeStyle = '#7f1d1d';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(X_GATE + 8, by - boothSpacing * 0.35);
          ctx.lineTo(X_GATE + 8, by + boothSpacing * 0.35);
          ctx.stroke();
        }
      }

      // 2.5 DRAW ALL VEHICLES WITH RICH MODULE #01 AESTHETICS
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

        // Dynamic Glowing Brake Lights when Queued or Braking
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

      // 2.6 Overhead Electronic VMS Approach Signage (X = 90)
      const vmsX = 90;
      ctx.fillStyle = '#334155';
      ctx.fillRect(vmsX - 3, APP_TOP_Y - 14, 6, 4 * APP_LANE_H + 28);

      ctx.fillStyle = 'rgba(15, 23, 42, 0.95)';
      ctx.strokeStyle = '#0284c7';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(vmsX - 60, APP_TOP_Y - 28, 120, 22, 4);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#38bdf8';
      ctx.font = 'bold 9px JetBrains Mono, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(isAr ? 'محطة تحصيل الرسوم (بوابات 8)' : 'TOLL PLAZA AHEAD (8 BOOTHS)', vmsX, APP_TOP_Y - 14);
      ctx.textAlign = 'left';

      // 2.7 180s Green Bypass Emergency Banner Overlay
      if (gBypass) {
        ctx.save();
        ctx.fillStyle = 'rgba(21, 128, 61, 0.95)';
        ctx.strokeStyle = '#4ade80';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(X_GATE - 110, 8, 220, 28, 6);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 11px JetBrains Mono, monospace';
        ctx.textAlign = 'center';
        ctx.fillText(
          isAr ? '⚡ تفعيل التفريغ التلقائي (تجاوز 180 ثانية)' : '⚡ 180s GREEN BYPASS ACTIVE',
          X_GATE,
          26
        );
        ctx.textAlign = 'left';
        ctx.restore();
      }

      // 2.8 Queue Tail Sensor & Length Marker
      if (!gBypass && qMeters > 30) {
        const queuePx = Math.min(220, qMeters * 0.75);
        const queueTailX = X_GATE - 20 - queuePx;

        ctx.strokeStyle = qMeters > 150 ? '#ef4444' : '#f59e0b';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(queueTailX, APP_TOP_Y - 8);
        ctx.lineTo(queueTailX, APP_BOTTOM_Y + 8);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = qMeters > 150 ? '#ef4444' : '#f59e0b';
        ctx.font = 'bold 9px JetBrains Mono, monospace';
        ctx.fillText(`Queue Tail: ~${Math.round(qMeters)}m (${waitSec.toFixed(0)}s)`, queueTailX - 70, APP_TOP_Y - 12);
      }

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
          title="Reset Toll Traffic"
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

      {/* Legend & Operation Status */}
      <div className="bg-slate-900/90 border-t border-slate-800 px-4 py-2 flex flex-wrap items-center justify-between gap-3 text-[11px] text-slate-400">
        <div className="flex items-center gap-4 flex-wrap">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
            <span>{isAr ? 'حارات إلكترونية / RFID (سريعة)' : 'RFID / Electronic (Fast)'}</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-cyan-400" />
            <span>{isAr ? 'حارات تحصيل نقدي (كاش)' : 'Manual Cash Booths'}</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
            <span>{isAr ? 'تفتيش أمني ووزن محوري' : 'Security Check / Axle Scale'}</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500" />
            <span>{isAr ? 'بوابات مغلقة (Closed)' : 'Closed Booths'}</span>
          </span>
        </div>
        <div className="text-slate-500 font-mono text-[10px]">
          {isAr ? 'النمذجة: نظرية طوابير M/M/c ومحاكاة ميكروسكوبية للقمع' : 'Queuing Theory: M/M/c & Toll Funnel Microsim'}
        </div>
      </div>
    </div>
  );
};

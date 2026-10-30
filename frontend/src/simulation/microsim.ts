/**
 * Deterministic microscopic traffic primitives shared by the 60 fps canvases.
 *
 * The models here are intentionally small but physically grounded:
 *  - Seeded Poisson arrivals (reproducible demand).
 *  - Egyptian vehicle mix with PCE weighting (trucks/buses consume more capacity).
 *  - Intelligent Driver Model (IDM) car-following, Treiber & Kesting.
 *  - Webster fixed-time signal optimisation with lost time and saturation flow.
 *  - HCM delay-based Level of Service.
 *
 * All functions are pure and deterministic for a given seed.
 */

export type VehicleKind = 'car' | 'microbus' | 'bus' | 'truck';

export interface VehicleClassSpec {
  kind: VehicleKind;
  /** Physical length in metres. */
  lengthM: number;
  /** Physical width in metres. */
  widthM: number;
  /** Passenger-car-equivalent factor used by Egyptian capacity analysis. */
  pce: number;
  /** Maximum acceleration m/s^2. */
  accel: number;
  /** Comfortable deceleration m/s^2. */
  decel: number;
  /** Stopped bumper-to-bumper gap, metres. */
  minGapM: number;
  /** Desired time headway, seconds. */
  headwayS: number;
  /** Free-flow speed factor relative to the posted limit. */
  speedFactor: number;
  /** Relative share of the Egyptian fleet. */
  weight: number;
  colors: string[];
}

export const VEHICLE_CLASSES: VehicleClassSpec[] = [
  {
    kind: 'car',
    lengthM: 4.6,
    widthM: 1.85,
    pce: 1.0,
    accel: 2.6,
    decel: 4.2,
    minGapM: 2.0,
    headwayS: 1.15,
    speedFactor: 1.0,
    weight: 0.63,
    colors: ['#06b6d4', '#38bdf8', '#3b82f6', '#94a3b8'],
  },
  {
    kind: 'microbus',
    lengthM: 5.5,
    widthM: 2.05,
    pce: 1.5,
    accel: 2.2,
    decel: 4.0,
    minGapM: 1.8,
    headwayS: 1.25,
    speedFactor: 0.96,
    weight: 0.25,
    colors: ['#f59e0b', '#fbbf24', '#d97706'],
  },
  {
    kind: 'bus',
    lengthM: 12.0,
    widthM: 2.55,
    pce: 2.5,
    accel: 1.3,
    decel: 3.4,
    minGapM: 2.5,
    headwayS: 1.7,
    speedFactor: 0.78,
    weight: 0.05,
    colors: ['#10b981', '#059669'],
  },
  {
    kind: 'truck',
    lengthM: 14.0,
    widthM: 2.55,
    pce: 3.0,
    accel: 1.05,
    decel: 3.1,
    minGapM: 3.0,
    headwayS: 1.9,
    speedFactor: 0.72,
    weight: 0.07,
    colors: ['#f43f5e', '#ef4444', '#e11d48'],
  },
];

/** Seedable PRNG: mulberry32. Returns values in [0, 1). */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Exponential inter-arrival sample for a Poisson process with the given mean (seconds). */
export function exponential(rng: () => number, meanSec: number): number {
  const u = Math.max(1e-9, 1 - rng());
  return -Math.log(u) * Math.max(0.001, meanSec);
}

/** Normalised vehicle mix that respects the user's heavy-vehicle share. */
export function getVehicleMix(heavyPct: number): Array<{ spec: VehicleClassSpec; weight: number }> {
  const hv = Math.max(0.02, Math.min(0.4, heavyPct / 100));
  const raw: Array<{ spec: VehicleClassSpec; weight: number }> = [
    { spec: VEHICLE_CLASSES[0], weight: Math.max(0.35, 1 - hv - 0.25) },
    { spec: VEHICLE_CLASSES[1], weight: 0.25 },
    { spec: VEHICLE_CLASSES[2], weight: hv * 0.4 },
    { spec: VEHICLE_CLASSES[3], weight: hv * 0.6 },
  ];
  const total = raw.reduce((sum, item) => sum + item.weight, 0);
  return raw.map((item) => ({ ...item, weight: item.weight / total }));
}

/** Capacity-weighted mean PCE of the fleet mix. */
export function averagePce(heavyPct: number): number {
  return getVehicleMix(heavyPct).reduce((sum, item) => sum + item.spec.pce * item.weight, 0);
}

/** Convert a PCE/h demand into a physical vehicle/h insertion rate. */
export function pceToVehicleFlow(pcePerHour: number, heavyPct: number): number {
  return pcePerHour / Math.max(0.5, averagePce(heavyPct));
}

export function sampleVehicleClass(
  rng: () => number,
  heavyPct: number
): VehicleClassSpec {
  const mix = getVehicleMix(heavyPct);
  const r = rng();
  let cumulative = 0;
  for (const item of mix) {
    cumulative += item.weight;
    if (r <= cumulative) return item.spec;
  }
  return mix[0].spec;
}

export function pickColor(rng: () => number, spec: VehicleClassSpec): string {
  return spec.colors[Math.floor(rng() * spec.colors.length) % spec.colors.length];
}

/** IDM acceleration. All quantities must share the same length/time units. */
export function idmAcceleration(
  speed: number,
  desiredSpeed: number,
  gap: number,
  leaderSpeed: number,
  spec: Pick<VehicleClassSpec, 'accel' | 'decel' | 'minGapM' | 'headwayS'>,
  scaleM = 1
): number {
  const v0 = Math.max(0.1, desiredSpeed);
  const freeTerm = 1 - Math.pow(Math.max(0, speed) / v0, 4);
  const minGap = spec.minGapM * scaleM;
  const headway = spec.headwayS;
  const dv = speed - leaderSpeed;
  const sStar =
    minGap +
    Math.max(
      0,
      speed * headway + (speed * dv) / (2 * Math.sqrt(spec.accel * spec.decel))
    );
  const safeGap = Math.max(0.05, gap);
  const interaction = Math.pow(sStar / safeGap, 2);
  const accel = spec.accel * scaleM * (freeTerm - interaction);
  const maxDecel = spec.decel * scaleM * 1.5;
  const maxAccel = spec.accel * scaleM;
  return Math.max(-maxDecel, Math.min(maxAccel, accel));
}

export interface WebsterTiming {
  cycleSec: number;
  mainGreenSec: number;
  crossGreenSec: number;
  yellowSec: number;
  allRedSec: number;
  lostTimeSec: number;
  criticalRatio: number;
  saturationMainPce: number;
  saturationCrossPce: number;
  capacityMainVeh: number;
  capacityCrossVeh: number;
  vcMain: number;
  vcCross: number;
  oversaturated: boolean;
}

/**
 * Webster fixed-time timing plan, matching the analytical engine's assumptions:
 * 3 main lanes @ 1900 PCE/h and 2 cross lanes @ 1800 PCE/h, adjusted for heavy
 * vehicles and turning friction. Lost time is 16 s per cycle.
 */
export function websterTiming(
  mainFlow: number,
  crossFlow: number,
  turningPct: number,
  heavyPct: number
): WebsterTiming {
  const heavyRatio = Math.max(0.02, Math.min(0.4, heavyPct / 100));
  const saturationMain = 1900 * 3 * (1 - heavyRatio / 2);
  const saturationCross = 1800 * 2 * (1 - heavyRatio / 2);
  const yRaw =
    (mainFlow * 0.55) / saturationMain +
    (crossFlow * 0.65) / saturationCross +
    turningPct / 250;
  const criticalRatio = Math.min(0.94, Math.max(0.05, yRaw));
  const lostTime = 16;
  const rawCycle = (1.5 * lostTime + 5) / (1 - criticalRatio);
  const cycle = Math.max(45, Math.min(160, rawCycle));
  const effectiveGreen = Math.max(20, cycle - lostTime);
  const mainShare = mainFlow / Math.max(1, mainFlow + crossFlow);
  let mainGreen = Math.max(8, effectiveGreen * mainShare);
  let crossGreen = Math.max(8, effectiveGreen - mainGreen);
  // Rebuild the cycle after enforcing minimum greens.
  const finalCycle = mainGreen + crossGreen + lostTime;
  const yellow = 3.5;
  const allRed = 2.0;
  const capacityMain = saturationMain * (mainGreen / finalCycle);
  const capacityCross = saturationCross * (crossGreen / finalCycle);

  return {
    cycleSec: finalCycle,
    mainGreenSec: mainGreen,
    crossGreenSec: crossGreen,
    yellowSec: yellow,
    allRedSec: allRed,
    lostTimeSec: lostTime,
    criticalRatio,
    saturationMainPce: saturationMain,
    saturationCrossPce: saturationCross,
    capacityMainVeh: capacityMain,
    capacityCrossVeh: capacityCross,
    vcMain: mainFlow / Math.max(1, capacityMain),
    vcCross: crossFlow / Math.max(1, capacityCross),
    oversaturated: criticalRatio >= 0.94,
  };
}

/** HCM delay thresholds. */
export function losFromDelay(delaySec: number, signalized = true): 'A' | 'B' | 'C' | 'D' | 'E' | 'F' {
  if (!Number.isFinite(delaySec) || delaySec <= 0) return 'A';
  if (signalized) {
    if (delaySec <= 10) return 'A';
    if (delaySec <= 20) return 'B';
    if (delaySec <= 35) return 'C';
    if (delaySec <= 55) return 'D';
    if (delaySec <= 80) return 'E';
    return 'F';
  }
  if (delaySec <= 10) return 'A';
  if (delaySec <= 15) return 'B';
  if (delaySec <= 25) return 'C';
  if (delaySec <= 35) return 'D';
  if (delaySec <= 50) return 'E';
  return 'F';
}

export function kmhToMs(kmh: number): number {
  return kmh / 3.6;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

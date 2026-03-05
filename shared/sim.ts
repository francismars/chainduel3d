import type {
  ChainClass,
  GameMode,
  ItemId,
  RouteArenaObstacle,
  RouteArenaShape,
  RouteLayoutType,
} from './types';

export interface SimInput {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  drift: boolean;
}

export interface SimRuntimeState {
  speedBoostMs: number;
  slowMs: number;
  drifting: boolean;
  driftDirection: -1 | 0 | 1;
  driftCharge: number;
}

export interface SimPlayerKinematics {
  heading: number;
  speed: number;
  chainLength: number;
}

export interface ChainClassTuning {
  acceleration: number;
  maxSpeed: number;
  turnRate: number;
  turnRateHigh: number;
}

export interface SimStepResult {
  moveAngle: number;
  driftStarted: boolean;
  driftEnded: boolean;
  driftBoostMs: number;
  driftBoostSpeed: number;
}

const START_BLOCKS = 5;
const BRAKE_STRENGTH = 35;
const REVERSE_MAX = 10;
const COAST_DRAG = 0.98;
const DRIFT_MIN_SPEED = 6;
const DRIFT_BASE_TURN = 2.0;
const DRIFT_TIGHTEN = 3.2;
const DRIFT_WIDEN = 0.8;
const DRIFT_SLIDE_ANGLE = 0.25;
const DERBY_MAX_TIME_MS = 6 * 60 * 1000;

export interface SimRandomState {
  value: number;
}

export function createSimRandomState(seed: number): SimRandomState {
  return { value: (seed >>> 0) || 1 };
}

export function nextSimRandom(state: SimRandomState): number {
  let t = (state.value += 0x6d2b79f5);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const out = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return out;
}

export function getChainClassTuning(chainClass: ChainClass): ChainClassTuning {
  if (chainClass === 'light') {
    return { acceleration: 30, maxSpeed: 29, turnRate: 2.75, turnRateHigh: 1.52 };
  }
  if (chainClass === 'heavy') {
    return { acceleration: 26, maxSpeed: 27, turnRate: 2.45, turnRateHigh: 1.32 };
  }
  return { acceleration: 28, maxSpeed: 28, turnRate: 2.6, turnRateHigh: 1.4 };
}

export function tickRuntimeTimers(runtime: SimRuntimeState, dtMs: number) {
  runtime.speedBoostMs = Math.max(0, runtime.speedBoostMs - dtMs);
  runtime.slowMs = Math.max(0, runtime.slowMs - dtMs);
}

export function stepPlayerKinematics(
  state: SimPlayerKinematics,
  runtime: SimRuntimeState,
  input: SimInput,
  dt: number,
  tuning: ChainClassTuning,
  raceBalanceAssist = 1,
): SimStepResult {
  let speedMult = 1;
  if (runtime.speedBoostMs > 0) speedMult = 1.8;
  if (runtime.slowMs > 0) speedMult = 0.4;
  const chainPenalty = Math.max(0.65, 1 - (state.chainLength - START_BLOCKS) * 0.03);
  const effMax = tuning.maxSpeed * speedMult * chainPenalty * raceBalanceAssist;
  const effAccel = tuning.acceleration * speedMult * (0.7 + raceBalanceAssist * 0.3);
  const effRev = REVERSE_MAX * speedMult;

  if (input.forward) {
    state.speed += effAccel * dt;
    if (state.speed > effMax) state.speed = effMax;
  } else if (input.backward) {
    if (state.speed > 0.5) {
      state.speed -= BRAKE_STRENGTH * dt;
      if (state.speed < 0) state.speed = 0;
    } else {
      state.speed -= effAccel * 0.5 * dt;
      if (state.speed < -effRev) state.speed = -effRev;
    }
  } else {
    state.speed *= COAST_DRAG;
    if (Math.abs(state.speed) < 0.1) state.speed = 0;
  }

  const turning = input.left || input.right;
  const canDrift = input.drift && turning && state.speed >= DRIFT_MIN_SPEED;
  const driftStarted = canDrift && !runtime.drifting;
  if (driftStarted) {
    runtime.drifting = true;
    runtime.driftDirection = input.left ? 1 : -1;
    runtime.driftCharge = 0;
  }

  let driftEnded = false;
  let driftBoostMs = 0;
  let driftBoostSpeed = 0;
  if (runtime.drifting) {
    if (!input.drift || state.speed < DRIFT_MIN_SPEED * 0.3) {
      driftEnded = true;
      if (runtime.driftCharge >= 2.0) {
        driftBoostMs = 2500;
        driftBoostSpeed = 6 * 1.8;
      } else if (runtime.driftCharge >= 1.2) {
        driftBoostMs = 1500;
        driftBoostSpeed = 6 * 1.2;
      } else if (runtime.driftCharge >= 0.5) {
        driftBoostMs = 800;
        driftBoostSpeed = 6 * 0.7;
      }
      runtime.drifting = false;
      runtime.driftDirection = 0;
      runtime.driftCharge = 0;
    } else {
      runtime.driftCharge += dt;
      let driftTurn = DRIFT_BASE_TURN;
      const into = (runtime.driftDirection > 0 && input.left) || (runtime.driftDirection < 0 && input.right);
      const away = (runtime.driftDirection > 0 && input.right) || (runtime.driftDirection < 0 && input.left);
      if (into) driftTurn = DRIFT_TIGHTEN;
      else if (away) driftTurn = DRIFT_WIDEN;
      state.heading += runtime.driftDirection * driftTurn * dt;
    }
  } else {
    const abs = Math.abs(state.speed);
    if (abs > 0.3) {
      const t = Math.min(abs / tuning.maxSpeed, 1);
      const turn = tuning.turnRate + (tuning.turnRateHigh - tuning.turnRate) * t;
      const sign = state.speed >= 0 ? 1 : -1;
      if (input.left) state.heading += turn * sign * dt;
      if (input.right) state.heading -= turn * sign * dt;
    }
  }

  const moveAngle = runtime.drifting
    ? state.heading - runtime.driftDirection * DRIFT_SLIDE_ANGLE
    : state.heading;
  return { moveAngle, driftStarted, driftEnded, driftBoostMs, driftBoostSpeed };
}

export interface SimRoutePoint {
  x: number;
  y: number;
  z: number;
  dirX: number;
  dirZ: number;
  width: number;
  ramp: boolean;
  boost: boolean;
  loop: boolean;
  tunnel: boolean;
  tunnelWall: boolean;
  tunnelWallSide: 'bottom' | 'left' | 'right';
}
export interface SimRouteControlPoint {
  x: number;
  z: number;
  w: number;
  e: number;
  ramp?: boolean;
  boost?: boolean;
  loop?: boolean;
  tunnel?: boolean;
  tunnelWall?: boolean;
  tunnelWallSide?: 'bottom' | 'left' | 'right';
}
export interface SimRouteShortcutControlPoint {
  x: number;
  z: number;
  e: number;
}
export interface SimRouteLayout {
  main: SimRouteControlPoint[];
  shortcut?: SimRouteShortcutControlPoint[];
  layoutType?: RouteLayoutType;
  arenaShape?: RouteArenaShape;
  arenaRadiusX?: number;
  arenaRadiusZ?: number;
  arenaFloorY?: number;
  arenaWallHeight?: number;
  arenaObstacleDensity?: number;
  interiorObstacles?: RouteArenaObstacle[];
}
export interface SimDefaultRouteParams {
  numSegments: number;
  baseRadius: number;
  radiusWaveA: number;
  radiusWaveB: number;
  radiusWaveC: number;
  loopLiftAmp: number;
  undulationA: number;
  undulationB: number;
  widthBase: number;
  widthWaveA: number;
  widthWaveB: number;
}
const DEFAULT_SIM_ROUTE_PARAMS: SimDefaultRouteParams = {
  numSegments: 360,
  baseRadius: 104,
  radiusWaveA: 6,
  radiusWaveB: 4,
  radiusWaveC: 2.2,
  loopLiftAmp: 8,
  undulationA: 1.4,
  undulationB: 1.1,
  widthBase: 11.8,
  widthWaveA: 0.9,
  widthWaveB: 0.5,
};

const DEFAULT_ARENA_RADIUS_X = 84;
const DEFAULT_ARENA_RADIUS_Z = 74;
const DEFAULT_ARENA_FLOOR_Y = 4;
const DEFAULT_ARENA_WALL_HEIGHT = 7;
const DEFAULT_ARENA_BOWL_RISE = 2.6;

export interface SimCheckpoint {
  x: number;
  z: number;
  width: number;
}

export interface SimItemBoxPosition {
  x: number;
  y: number;
  z: number;
}

export interface SimStartFrame {
  x: number;
  z: number;
  y: number;
  dirX: number;
  dirZ: number;
  rightX: number;
  rightZ: number;
  heading: number;
}

export interface SimStartSlotPose {
  x: number;
  y: number;
  z: number;
  heading: number;
}

export interface SimPlayerState extends SimPlayerKinematics {
  x: number;
  y: number;
  z: number;
  chainClass: ChainClass;
  drifting: boolean;
  driftDirection: number;
  driftCharge: number;
  lap: number;
  lastCheckpoint: number;
  finished: boolean;
  eliminated: boolean;
  speedBoostActive: boolean;
  slowActive: boolean;
}

export interface SimPlayerRuntimeState extends SimRuntimeState {
  airborne: boolean;
  airborneElapsed: number;
  vy: number;
  tunnelAngle: number;
  aiItemCooldownMs: number;
  aiLastWaypointIdx: number;
  aiSteerNoise: number;
  aiNoiseCooldown: number;
}

export interface SimRaceState {
  tick: number;
  timeMs: number;
  totalLaps: number;
  layoutType?: RouteLayoutType;
  interiorObstacles?: RouteArenaObstacle[];
  routeMain: SimRoutePoint[];
  routeAll: SimRoutePoint[];
  checkpoints: SimCheckpoint[];
  players: SimPlayerState[];
  runtime: SimPlayerRuntimeState[];
}

export type SimRaceEventType =
  | 'drift_start'
  | 'drift_end'
  | 'jump_start'
  | 'land'
  | 'checkpoint'
  | 'lap'
  | 'finish'
  | 'item_used'
  | 'steal_hit'
  | 'sacrifice_boost';

export interface SimRaceEvent {
  type: SimRaceEventType;
  playerIndex: number;
  targetPlayerIndex?: number;
  itemId?: ItemId;
}

export interface SimRaceStepResult {
  state: SimRaceState;
  events: SimRaceEvent[];
}

export interface SimRaceActionInput {
  useItem: boolean;
  sacrificeBoost: boolean;
}

export interface SimRaceActionPressState {
  prevUseItemPressed: boolean;
  prevSacrificePressed: boolean;
}

export interface SimRaceActionEdges {
  useItemJustPressed: boolean;
  sacrificeJustPressed: boolean;
}

export interface SimPlacementPlayer {
  finished: boolean;
  eliminated: boolean;
  lap: number;
  lastCheckpoint: number;
  chainLength: number;
  finishTime?: number;
}

export interface SimEffectPlayerState {
  x: number;
  y: number;
  z: number;
  heading: number;
  speed: number;
  finished: boolean;
  chainLength: number;
}

export interface SimItemBoxState {
  x: number;
  y: number;
  z: number;
  active: boolean;
  respawnMs: number;
  previewItem: ItemId;
}

export interface SimObstacleState {
  x: number;
  y: number;
  z: number;
  lifetimeMs: number;
}

export interface SimItemPlayerState extends SimEffectPlayerState {
  heldItemId: ItemId | null;
}

export interface SimRouteInfo {
  elevation: number;
  centerX: number;
  centerZ: number;
  rightX: number;
  rightZ: number;
  offset: number;
  halfWidth: number;
  ramp: boolean;
  boost: boolean;
  loop: boolean;
  loopBlend: number;
  tunnel: boolean;
  tunnelBlend: number;
  tunnelWall: boolean;
  tunnelWallSide: 'bottom' | 'left' | 'right';
  dirX: number;
  dirZ: number;
}

export interface SimBasicAiState {
  x: number;
  y: number;
  z: number;
  heading: number;
}

export interface SimAdvancedAiState extends SimBasicAiState {
  speed: number;
  chainLength: number;
}

export interface SimAdvancedAiRuntime {
  aiLastWaypointIdx: number;
  aiSteerNoise: number;
  aiNoiseCooldown: number;
}

export function createDefaultRuntimeState(): SimPlayerRuntimeState {
  return {
    speedBoostMs: 0,
    slowMs: 0,
    drifting: false,
    driftDirection: 0,
    driftCharge: 0,
    airborne: false,
    airborneElapsed: 0,
    vy: 0,
    tunnelAngle: 0,
    aiItemCooldownMs: 0,
    aiLastWaypointIdx: 0,
    aiSteerNoise: 0,
    aiNoiseCooldown: 0,
  };
}

export function getRouteInfo(
  x: number,
  y: number,
  z: number,
  mainPoints: SimRoutePoint[],
  allPoints: SimRoutePoint[],
): SimRouteInfo {
  const n = allPoints.length;
  let bestDist = Infinity;
  let bestIdx = 0;
  for (let i = 0; i < n; i++) {
    const tp = allPoints[i];
    const dx = x - tp.x;
    const dy = y - tp.y;
    const dz = z - tp.z;
    const d = dx * dx + dy * dy * 0.5 + dz * dz;
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }

  const mainN = mainPoints.length;
  const shortcutPoints = allPoints.slice(mainN);
  const useMain = bestIdx < mainN || shortcutPoints.length < 2;
  const points = useMain ? mainPoints : shortcutPoints;
  const closed = useMain;
  const localIdx = useMain ? bestIdx : Math.max(0, bestIdx - mainN);
  const localN = points.length;
  const tp = points[localIdx];
  const rightX = tp.dirZ;
  const rightZ = -tp.dirX;
  const toKartX = x - tp.x;
  const toKartZ = z - tp.z;
  const offset = toKartX * rightX + toKartZ * rightZ;

  const fwdDot = toKartX * tp.dirX + toKartZ * tp.dirZ;
  const nextIdx = closed ? (localIdx + 1) % localN : Math.min(localIdx + 1, localN - 1);
  const prevIdx = closed ? (localIdx - 1 + localN) % localN : Math.max(localIdx - 1, 0);
  const idxA = fwdDot >= 0 ? localIdx : prevIdx;
  const idxB = fwdDot >= 0 ? nextIdx : localIdx;

  const pA = points[idxA];
  const pB = points[idxB];
  const segDx = pB.x - pA.x;
  const segDz = pB.z - pA.z;
  const segLen2 = segDx * segDx + segDz * segDz;
  let t = 0;
  if (segLen2 > 0.001) {
    const projDx = x - pA.x;
    const projDz = z - pA.z;
    t = Math.max(0, Math.min(1, (projDx * segDx + projDz * segDz) / segLen2));
  }

  const idxPrev = closed ? (idxA - 1 + localN) % localN : Math.max(idxA - 1, 0);
  const idxNext = closed ? (idxB + 1) % localN : Math.min(idxB + 1, localN - 1);
  const y0 = points[idxPrev].y;
  const y1 = points[idxA].y;
  const y2 = points[idxB].y;
  const y3 = points[idxNext].y;
  const t2 = t * t;
  const t3 = t2 * t;
  const elevation = 0.5 * (
    (2 * y1) +
    (-y0 + y2) * t +
    (2 * y0 - 5 * y1 + 4 * y2 - y3) * t2 +
    (-y0 + 3 * y1 - 3 * y2 + y3) * t3
  );

  // Blend strictly across the active segment to avoid wide-window popping.
  const loopA = pA.loop ? 1 : 0;
  const loopB = pB.loop ? 1 : 0;
  const loopBlend = loopA * (1 - t) + loopB * t;
  const tunnelA = pA.tunnel ? 1 : 0;
  const tunnelB = pB.tunnel ? 1 : 0;
  const tunnelBlend = tunnelA * (1 - t) + tunnelB * t;
  const wallA = pA.tunnelWall ? 1 : 0;
  const wallB = pB.tunnelWall ? 1 : 0;
  const wallBlend = wallA * (1 - t) + wallB * t;
  const tunnelWall = wallBlend > 0.5;
  const sideWeight = (side: 'bottom' | 'left' | 'right') =>
    (pA.tunnelWallSide === side ? (1 - t) : 0) + (pB.tunnelWallSide === side ? t : 0);
  const sideBottomAcc = sideWeight('bottom');
  const sideLeftAcc = sideWeight('left');
  const sideRightAcc = sideWeight('right');
  const wallSide: 'bottom' | 'left' | 'right' =
    sideLeftAcc > sideRightAcc && sideLeftAcc > sideBottomAcc
      ? 'left'
      : sideRightAcc > sideBottomAcc
        ? 'right'
        : 'bottom';

  return {
    elevation,
    centerX: tp.x,
    centerZ: tp.z,
    rightX,
    rightZ,
    offset,
    halfWidth: tp.width / 2,
    ramp: !!tp.ramp,
    boost: !!tp.boost,
    loop: !!tp.loop,
    loopBlend,
    tunnel: !!tp.tunnel,
    tunnelBlend,
    tunnelWall,
    tunnelWallSide: wallSide,
    dirX: tp.dirX,
    dirZ: tp.dirZ,
  };
}

function getSimLayoutType(layout: SimRouteLayout | null | undefined): RouteLayoutType {
  return layout?.layoutType === 'arena' ? 'arena' : 'loop';
}

export function buildSimArenaMainRoutePoints(layout: SimRouteLayout | null): SimRoutePoint[] {
  const radiusX = Math.max(26, Number(layout?.arenaRadiusX) || DEFAULT_ARENA_RADIUS_X);
  const radiusZ = Math.max(26, Number(layout?.arenaRadiusZ) || DEFAULT_ARENA_RADIUS_Z);
  const floorY = Number(layout?.arenaFloorY) || DEFAULT_ARENA_FLOOR_Y;
  const wallHeight = Math.max(3, Number(layout?.arenaWallHeight) || DEFAULT_ARENA_WALL_HEIGHT);
  const segCount = 240;
  const points: SimRoutePoint[] = [];
  for (let i = 0; i < segCount; i++) {
    const t = i / segCount;
    const ang = t * Math.PI * 2;
    const x = Math.cos(ang) * radiusX;
    const z = Math.sin(ang) * radiusZ;
    const nx = -Math.sin(ang) * radiusX;
    const nz = Math.cos(ang) * radiusZ;
    const nlen = Math.hypot(nx, nz) || 1;
    const dirX = nx / nlen;
    const dirZ = nz / nlen;
    points.push({
      x,
      y: floorY,
      z,
      dirX,
      dirZ,
      width: Math.max(14, wallHeight * 2.2),
      ramp: false,
      boost: false,
      loop: false,
      tunnel: false,
      tunnelWall: false,
      tunnelWallSide: 'bottom',
    });
  }
  return points;
}


export function buildSimRoutePointsFromControlPoints(controlPoints: SimRouteControlPoint[]): SimRoutePoint[] {
  const segCount = Math.max(180, Math.min(900, controlPoints.length * 18));
  const points: SimRoutePoint[] = [];
  const n = controlPoints.length;
  const wrap = (i: number) => (i % n + n) % n;
  const catmull = (p0: number, p1: number, p2: number, p3: number, t: number) => {
    const t2 = t * t;
    const t3 = t2 * t;
    return 0.5 * (
      (2 * p1) +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3
    );
  };
  const sample = (u: number) => {
    const cpFloat = u * n;
    const i1 = Math.floor(cpFloat);
    const t = cpFloat - i1;
    const i0 = wrap(i1 - 1);
    const i2 = wrap(i1 + 1);
    const i3 = wrap(i1 + 2);
    const p0 = controlPoints[i0];
    const p1 = controlPoints[wrap(i1)];
    const p2 = controlPoints[i2];
    const p3 = controlPoints[i3];
    return {
      x: catmull(p0.x, p1.x, p2.x, p3.x, t),
      y: catmull(p0.e, p1.e, p2.e, p3.e, t),
      z: catmull(p0.z, p1.z, p2.z, p3.z, t),
      w: p1.w * (1 - t) + p2.w * t,
    };
  };

  for (let i = 0; i < segCount; i++) {
    const t = i / segCount;
    const cur = sample(t);
    const nxt = sample((i + 1) / segCount);
    const cpFloat = t * n;
    const nearestCp = Math.round(cpFloat) % n;
    let dirX = nxt.x - cur.x;
    let dirZ = nxt.z - cur.z;
    const len = Math.hypot(dirX, dirZ) || 1;
    dirX /= len;
    dirZ /= len;
    points.push({
      x: cur.x,
      y: cur.y,
      z: cur.z,
      dirX,
      dirZ,
      width: cur.w,
      ramp: !!controlPoints[nearestCp]?.ramp,
      boost: !!controlPoints[nearestCp]?.boost,
      loop: !!controlPoints[nearestCp]?.loop,
      tunnel: !!controlPoints[nearestCp]?.tunnel,
      tunnelWall: !!controlPoints[nearestCp]?.tunnelWall,
      tunnelWallSide: controlPoints[nearestCp]?.tunnelWallSide ?? 'bottom',
    });
  }
  return points;
}

export function buildDefaultSimMainRoutePoints(
  params?: Partial<SimDefaultRouteParams>,
): SimRoutePoint[] {
  const p = { ...DEFAULT_SIM_ROUTE_PARAMS, ...(params ?? {}) };
  const numSegments = Math.max(220, Math.min(720, Math.round(p.numSegments)));
  const points: SimRoutePoint[] = [];
  for (let i = 0; i < numSegments; i++) {
    const t = i / numSegments;
    const theta = t * Math.PI * 4;
    const radius = p.baseRadius
      + Math.sin(theta * 0.5 + 0.9) * p.radiusWaveA
      + Math.sin(theta * 1.8) * p.radiusWaveB
      + Math.sin(theta * 3.6 + 0.4) * p.radiusWaveC;
    const x = Math.cos(theta) * radius;
    const z = Math.sin(theta) * radius;
    const loopLift = -p.loopLiftAmp * Math.sin(theta * 0.5);
    const localUndulation = Math.sin(theta * 2.4) * p.undulationA + Math.sin(theta * 0.9 + 0.6) * p.undulationB;
    const y = 7 + loopLift + localUndulation;
    const nextTheta = ((i + 1) % numSegments) / numSegments * Math.PI * 4;
    const nextRadius = p.baseRadius
      + Math.sin(nextTheta * 0.5 + 0.9) * p.radiusWaveA
      + Math.sin(nextTheta * 1.8) * p.radiusWaveB
      + Math.sin(nextTheta * 3.6 + 0.4) * p.radiusWaveC;
    const nx = Math.cos(nextTheta) * nextRadius;
    const nz = Math.sin(nextTheta) * nextRadius;
    let dirX = nx - x;
    let dirZ = nz - z;
    const len = Math.hypot(dirX, dirZ) || 1;
    dirX /= len;
    dirZ /= len;
    const width = p.widthBase + Math.sin(theta * 0.7 + 1.1) * p.widthWaveA + Math.sin(theta * 1.4) * p.widthWaveB;
    const phase = ((theta % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const ramp = (phase > 1.02 && phase < 1.18) || (phase > 4.18 && phase < 4.34);
    const boost = (phase > 0.28 && phase < 0.41) || (phase > 3.42 && phase < 3.56);
    const loop = (phase > 1.62 && phase < 1.9);
    const tunnel = (phase > 2.05 && phase < 2.34);
    points.push({ x, y, z, dirX, dirZ, width, ramp, boost, loop, tunnel, tunnelWall: false, tunnelWallSide: 'bottom' });
  }
  return points;
}

export function buildSimShortcutRoutePoints(layout: SimRouteLayout | null): SimRoutePoint[] {
  if (getSimLayoutType(layout) === 'arena') return [];
  const fromControl = (control: SimRouteShortcutControlPoint[]) => {
    const segCount = Math.max(24, control.length * 10);
    const n = control.length;
    const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
    const points: SimRoutePoint[] = [];
    for (let i = 0; i < segCount; i++) {
      const t = i / Math.max(1, segCount - 1);
      const f = t * (n - 1);
      const i1 = Math.floor(f);
      const i2 = clamp(i1 + 1, 0, n - 1);
      const p1 = control[i1];
      const p2 = control[i2];
      const lt = f - i1;
      const x = p1.x * (1 - lt) + p2.x * lt;
      const y = p1.e * (1 - lt) + p2.e * lt;
      const z = p1.z * (1 - lt) + p2.z * lt;
      const nf = clamp(f + 0.03, 0, n - 1);
      const ni1 = Math.floor(nf);
      const ni2 = clamp(ni1 + 1, 0, n - 1);
      const np1 = control[ni1];
      const np2 = control[ni2];
      const nlt = nf - ni1;
      const nx = np1.x * (1 - nlt) + np2.x * nlt;
      const nz = np1.z * (1 - nlt) + np2.z * nlt;
      let dirX = nx - x;
      let dirZ = nz - z;
      const len = Math.hypot(dirX, dirZ) || 1;
      dirX /= len;
      dirZ /= len;
      points.push({ x, y, z, dirX, dirZ, width: 6, ramp: false, boost: false, loop: false, tunnel: false, tunnelWall: false, tunnelWallSide: 'bottom' });
    }
    return points;
  };

  if (layout?.shortcut && layout.shortcut.length >= 3) {
    return fromControl(layout.shortcut);
  }
  if (layout?.main && layout.main.length >= 4) {
    return [];
  }
  return fromControl([
    { x: -18, z: -76, e: 4.5 },
    { x: 20, z: -62, e: 5.3 },
    { x: 42, z: -30, e: 6.6 },
    { x: 40, z: 8, e: 7.9 },
    { x: 22, z: 42, e: 9.2 },
    { x: -8, z: 66, e: 8.5 },
    { x: -34, z: 74, e: 7.4 },
  ]);
}

export function buildSimMainRoutePoints(
  layout: SimRouteLayout | null,
  defaultParams?: Partial<SimDefaultRouteParams>,
): SimRoutePoint[] {
  if (getSimLayoutType(layout) === 'arena') {
    return buildSimArenaMainRoutePoints(layout);
  }
  if (layout?.main && layout.main.length >= 4) {
    return buildSimRoutePointsFromControlPoints(layout.main);
  }
  return buildDefaultSimMainRoutePoints(defaultParams);
}

export function buildSimRoutePoints(
  layout: SimRouteLayout | null,
  mainPoints: SimRoutePoint[],
): SimRoutePoint[] {
  const shortcut = buildSimShortcutRoutePoints(layout);
  if (shortcut.length === 0) return mainPoints;
  return [...mainPoints, ...shortcut];
}

export function buildSimCheckpoints(
  routePoints: SimRoutePoint[],
  numCheckpoints = 14,
  layout: SimRouteLayout | null = null,
): SimCheckpoint[] {
  const checkpoints: SimCheckpoint[] = [];
  if (getSimLayoutType(layout) === 'arena') return checkpoints;
  if (routePoints.length <= 0 || numCheckpoints <= 0) return checkpoints;
  const interval = Math.max(1, Math.floor(routePoints.length / numCheckpoints));
  for (let i = 0; i < numCheckpoints; i++) {
    const idx = Math.min(routePoints.length - 1, i * interval);
    const p = routePoints[idx];
    checkpoints.push({ x: p.x, z: p.z, width: p.width });
  }
  return checkpoints;
}

export function buildItemBoxPositions(
  routePoints: SimRoutePoint[],
  numBoxes = 10,
  layout: SimRouteLayout | null = null,
): SimItemBoxPosition[] {
  const positions: SimItemBoxPosition[] = [];
  if (routePoints.length <= 0 || numBoxes <= 0) return positions;
  if (getSimLayoutType(layout) === 'arena') {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    let floorYAcc = 0;
    for (const p of routePoints) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
      floorYAcc += p.y;
    }
    const centerX = (minX + maxX) * 0.5;
    const centerZ = (minZ + maxZ) * 0.5;
    const radiusX = Math.max(12, (maxX - minX) * 0.5 - 4);
    const radiusZ = Math.max(12, (maxZ - minZ) * 0.5 - 4);
    const floorY = floorYAcc / Math.max(1, routePoints.length);
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < numBoxes; i++) {
      const angle = i * golden + 0.41;
      const radial = 0.22 + 0.68 * Math.sqrt((((i + 1) * 0.61803398875) % 1 + 1) % 1);
      const x = centerX + Math.cos(angle) * radiusX * radial;
      const z = centerZ + Math.sin(angle) * radiusZ * radial;
      const nx = (x - centerX) / Math.max(1, radiusX);
      const nz = (z - centerZ) / Math.max(1, radiusZ);
      const radialNorm = Math.min(1, Math.hypot(nx, nz));
      const bowlY = floorY + radialNorm * radialNorm * DEFAULT_ARENA_BOWL_RISE;
      positions.push({ x, y: bowlY + 1.0, z });
    }
    return positions;
  }
  const n = routePoints.length;
  const startZoneRadius = Math.max(6, Math.floor(n * 0.06));
  const isInStartZone = (idx: number) => {
    const wrapped = ((idx % n) + n) % n;
    const distToStart = Math.min(wrapped, n - wrapped);
    return distToStart <= startZoneRadius;
  };
  const findUsablePoint = (baseIdx: number): SimRoutePoint | null => {
    const idx0 = ((baseIdx % n) + n) % n;
    const base = routePoints[idx0];
    if (base && !base.ramp && !isInStartZone(idx0)) return base;
    const maxSearch = Math.max(6, Math.floor(n * 0.04));
    for (let step = 1; step <= maxSearch; step++) {
      const fwdIdx = (idx0 + step) % n;
      const fwd = routePoints[fwdIdx];
      if (fwd && !fwd.ramp && !isInStartZone(fwdIdx)) return fwd;
      const backIdx = (idx0 - step + n) % n;
      const back = routePoints[backIdx];
      if (back && !back.ramp && !isInStartZone(backIdx)) return back;
    }
    return null;
  };

  // Spawn in side-by-side gates. Wider track sections can use 3-wide gates.
  const gateCount = Math.max(1, Math.ceil(numBoxes / 2));
  const gateInterval = n / gateCount;
  const centerToSide = (laneOffset: number, lane: number, laneCount: number) => {
    if (laneCount <= 1) return 0;
    if (laneCount === 2) return lane === 0 ? -laneOffset : laneOffset;
    return lane === 0 ? -laneOffset : lane === 1 ? 0 : laneOffset;
  };
  for (let gate = 0; gate < gateCount && positions.length < numBoxes; gate++) {
    const gateIdx = Math.floor((gate + 1) * gateInterval) % n;
    const p = findUsablePoint(gateIdx);
    if (!p) continue;
    const rightX = p.dirZ;
    const rightZ = -p.dirX;
    const halfWidth = Math.max(2.2, p.width * 0.5);
    const canThreeWide = halfWidth >= 6.2;
    const remaining = numBoxes - positions.length;
    const laneCount = canThreeWide && remaining >= 3 ? 3 : Math.min(2, remaining);
    const laneOffset = Math.min(3.0, Math.max(1.2, halfWidth * 0.36));
    for (let lane = 0; lane < laneCount && positions.length < numBoxes; lane++) {
      const offset = centerToSide(laneOffset, lane, laneCount);
      positions.push({
        x: p.x + rightX * offset,
        y: p.y + 1.0,
        z: p.z + rightZ * offset,
      });
    }
  }

  // Keep requested count even when ramps remove candidates.
  if (positions.length < numBoxes) {
    const interval = Math.max(1, Math.floor(n / numBoxes));
    for (let i = 1; i <= numBoxes && positions.length < numBoxes; i++) {
      const p = findUsablePoint((i * interval) % n);
      if (!p) continue;
      positions.push({ x: p.x, y: p.y + 1.0, z: p.z });
    }
  }
  return positions;
}

export function buildSimItemBoxes(
  routePoints: SimRoutePoint[],
  numBoxes = 10,
  previewItemFn: () => ItemId = rollPreviewItem,
  layout: SimRouteLayout | null = null,
): SimItemBoxState[] {
  return buildItemBoxPositions(routePoints, numBoxes, layout).map(pos => ({
    x: pos.x,
    y: pos.y,
    z: pos.z,
    active: true,
    respawnMs: 0,
    previewItem: previewItemFn(),
  }));
}

export function buildSimStartFrame(routePoints: SimRoutePoint[], layout: SimRouteLayout | null = null): SimStartFrame {
  const start = routePoints[0];
  if (!start) {
    return {
      x: 0,
      z: 0,
      y: 0.5,
      dirX: 0,
      dirZ: 1,
      rightX: 1,
      rightZ: 0,
      heading: 0,
    };
  }
  const n = routePoints.length;
  let dirX = start.dirX;
  let dirZ = start.dirZ;
  if (getSimLayoutType(layout) === 'arena') {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const p of routePoints) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }
    const centerX = (minX + maxX) * 0.5;
    const centerZ = (minZ + maxZ) * 0.5;
    const toCenterX = centerX - start.x;
    const toCenterZ = centerZ - start.z;
    const inwardLen = Math.hypot(toCenterX, toCenterZ);
    if (inwardLen > 1e-5) {
      dirX = toCenterX / inwardLen;
      dirZ = toCenterZ / inwardLen;
    }
  } else if (n >= 3) {
    const prev = routePoints[n - 1];
    const next = routePoints[1];
    const sx = next.x - prev.x;
    const sz = next.z - prev.z;
    const sl = Math.hypot(sx, sz);
    if (sl > 1e-5) {
      dirX = sx / sl;
      dirZ = sz / sl;
    }
  }
  const rightX = dirZ;
  const rightZ = -dirX;
  return {
    x: start.x,
    z: start.z,
    y: start.y + 0.5,
    dirX,
    dirZ,
    rightX,
    rightZ,
    heading: Math.atan2(dirX, dirZ),
  };
}

export function buildSimStartSlotPose(
  routePoints: SimRoutePoint[],
  slotIndex: number,
  lateralOffsets: number[] = [4.2, 1.4, -1.4, -4.2],
  layout: SimRouteLayout | null = null,
): SimStartSlotPose {
  const safeSlotIndex = Math.max(0, slotIndex | 0);
  if (getSimLayoutType(layout) === 'arena' && routePoints.length > 0) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    let floorYAcc = 0;
    for (const p of routePoints) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
      floorYAcc += p.y;
    }
    const centerX = (minX + maxX) * 0.5;
    const centerZ = (minZ + maxZ) * 0.5;
    const radiusX = Math.max(12, (maxX - minX) * 0.5);
    const radiusZ = Math.max(12, (maxZ - minZ) * 0.5);
    const floorY = floorYAcc / Math.max(1, routePoints.length);
    // Keep corner starts clearly away from perimeter so trailing chain
    // segments can settle and rotate without immediate wall pressure.
    const wallInset = 14;
    const safeRadiusX = Math.max(10, radiusX - wallInset);
    const safeRadiusZ = Math.max(10, radiusZ - wallInset);
    const corners = [
      { sx: -1, sz: -1 },
      { sx: 1, sz: -1 },
      { sx: -1, sz: 1 },
      { sx: 1, sz: 1 },
    ];
    const ringCols = 4;
    const row = Math.floor(safeSlotIndex / ringCols);
    const col = safeSlotIndex % ringCols;
    const c = corners[col];
    // Multi-row starts: each additional row moves inward toward center.
    const ringScale = Math.max(0.42, 0.68 - row * 0.16);
    const x = centerX + c.sx * safeRadiusX * ringScale;
    const z = centerZ + c.sz * safeRadiusZ * ringScale;
    const toCenterX = centerX - x;
    const toCenterZ = centerZ - z;
    const heading = Math.atan2(toCenterX, toCenterZ);
    const nx = (x - centerX) / Math.max(1, radiusX);
    const nz = (z - centerZ) / Math.max(1, radiusZ);
    const radialNorm = Math.min(1, Math.hypot(nx, nz));
    const bowlY = floorY + radialNorm * radialNorm * DEFAULT_ARENA_BOWL_RISE;
    return { x, y: bowlY + 0.5, z, heading };
  }
  const frame = buildSimStartFrame(routePoints, layout);
  const sampleCount = Math.max(1, Math.min(12, routePoints.length));
  let widthAcc = 0;
  for (let i = 0; i < sampleCount; i++) widthAcc += Math.max(6, routePoints[i]?.width ?? 10);
  const startWidth = widthAcc / sampleCount;
  const usableHalfWidth = Math.max(2.2, startWidth * 0.5 - 1.15);
  const minLaneSpacing = 2.45;
  let gridCols = 4;
  while (gridCols > 2) {
    const requiredHalf = ((gridCols - 1) * 0.5) * minLaneSpacing + 0.5;
    if (requiredHalf <= usableHalfWidth) break;
    gridCols -= 1;
  }
  const row = Math.floor(safeSlotIndex / gridCols);
  const col = safeSlotIndex % gridCols;
  const maxReach = Math.max(0.1, usableHalfWidth - 0.35);
  const defaultSpacing = gridCols <= 1 ? 0 : (maxReach * 2) / Math.max(1, gridCols - 1);
  const spacing = Math.max(minLaneSpacing, Math.min(3.15, defaultSpacing));
  const centeredCol = col - (gridCols - 1) * 0.5;
  const defaultOffset = centeredCol * spacing;
  const row0LegacyOffset = lateralOffsets[safeSlotIndex];
  const o = (row === 0 && Number.isFinite(row0LegacyOffset))
    ? Math.max(-maxReach, Math.min(maxReach, row0LegacyOffset))
    : Math.max(-maxReach, Math.min(maxReach, defaultOffset));
  // Wider starts can afford more front-to-back spacing; tighter starts keep rows compact.
  const rowSpacing = Math.max(3.0, Math.min(4.8, startWidth * 0.34));
  const rowBack = row * rowSpacing;
  return {
    x: frame.x + frame.rightX * o - frame.dirX * rowBack,
    y: frame.y,
    z: frame.z + frame.rightZ * o - frame.dirZ * rowBack,
    heading: frame.heading,
  };
}

export function getBasicAiInput(
  state: SimBasicAiState,
  mainPoints: SimRoutePoint[],
  allPoints: SimRoutePoint[],
): SimInput {
  const info = getRouteInfo(state.x, state.y, state.z, mainPoints, allPoints);
  const desired = Math.atan2(info.dirX, info.dirZ);
  let delta = desired - state.heading;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return {
    forward: true,
    backward: false,
    left: delta > 0.08,
    right: delta < -0.08,
    drift: Math.abs(delta) > 0.28,
  };
}

export function getAdvancedAiInput(
  state: SimAdvancedAiState,
  routePoints: SimRoutePoint[],
  runtime: SimAdvancedAiRuntime,
  dtSec: number,
  mode: GameMode = 'classic',
  opponents: Array<{ x: number; y: number; z: number; finished: boolean; chainLength: number }> = [],
  playerIndex = -1,
  randomFn: () => number = Math.random,
  arenaLayout = false,
): SimInput {
  const n = routePoints.length;
  if (n <= 0) {
    return { forward: true, backward: false, left: false, right: false, drift: false };
  }

  let bestDist = Infinity;
  let bestIdx = 0;
  for (let i = 0; i < n; i++) {
    const dx = state.x - routePoints[i].x;
    const dz = state.z - routePoints[i].z;
    const d = dx * dx + dz * dz;
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  runtime.aiLastWaypointIdx = bestIdx;
  const lookAhead = Math.min(8, Math.max(5, Math.floor(state.speed * 0.3)));
  const targetIdx = (bestIdx + lookAhead) % n;
  const target = routePoints[targetIdx];
  let targetAngle = Math.atan2(target.x - state.x, target.z - state.z);
  let arenaCenterX = 0;
  let arenaCenterZ = 0;
  let arenaRadiusX = 84;
  let arenaRadiusZ = 74;
  if (arenaLayout && n > 0) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const p of routePoints) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }
    arenaCenterX = (minX + maxX) * 0.5;
    arenaCenterZ = (minZ + maxZ) * 0.5;
    arenaRadiusX = Math.max(12, (maxX - minX) * 0.5);
    arenaRadiusZ = Math.max(12, (maxZ - minZ) * 0.5);
  }
  if (mode === 'derby' && playerIndex >= 0 && state.chainLength >= 3) {
    let nearestIdx = -1;
    let nearestDist2 = 42 * 42;
    for (let i = 0; i < opponents.length; i++) {
      if (i === playerIndex) continue;
      const opp = opponents[i];
      if (!opp || opp.finished || opp.chainLength <= 0) continue;
      const odx = opp.x - state.x;
      const odz = opp.z - state.z;
      const d2 = odx * odx + odz * odz;
      if (d2 < nearestDist2) {
        nearestDist2 = d2;
        nearestIdx = i;
      }
    }
    if (nearestIdx >= 0) {
      const opp = opponents[nearestIdx];
      const attackAngle = Math.atan2(opp.x - state.x, opp.z - state.z);
      const blend = arenaLayout ? 0.8 : 0.45;
      targetAngle = targetAngle + Math.atan2(Math.sin(attackAngle - targetAngle), Math.cos(attackAngle - targetAngle)) * blend;
    } else if (arenaLayout) {
      const centerAngle = Math.atan2(arenaCenterX - state.x, arenaCenterZ - state.z);
      targetAngle = centerAngle;
    }
  }
  if (arenaLayout) {
    const nx = (state.x - arenaCenterX) / Math.max(1, arenaRadiusX);
    const nz = (state.z - arenaCenterZ) / Math.max(1, arenaRadiusZ);
    const edgePressure = Math.hypot(nx, nz);
    if (edgePressure > 0.8) {
      const centerAngle = Math.atan2(arenaCenterX - state.x, arenaCenterZ - state.z);
      const edgeBlend = Math.min(1, (edgePressure - 0.8) / 0.2);
      targetAngle = targetAngle + Math.atan2(Math.sin(centerAngle - targetAngle), Math.cos(centerAngle - targetAngle)) * edgeBlend;
    }
  }
  let angleDiff = targetAngle - state.heading;
  while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
  while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

  runtime.aiNoiseCooldown -= dtSec;
  if (runtime.aiNoiseCooldown <= 0) {
    runtime.aiSteerNoise = (randomFn() - 0.5) * 0.15;
    runtime.aiNoiseCooldown = 0.3 + randomFn() * 0.5;
  }
  angleDiff += runtime.aiSteerNoise;

  const steerThreshold = 0.05;
  const left = angleDiff > steerThreshold;
  const right = angleDiff < -steerThreshold;
  const driftThreshold = mode === 'derby'
    ? (state.chainLength <= 2 ? 0.9 : 0.62)
    : (state.chainLength <= 2 ? 0.75 : 0.5);
  const sharpCorner = Math.abs(angleDiff) > driftThreshold && state.speed > 12;
  const veryWrong = Math.abs(angleDiff) > 1.2 && state.speed > 15;

  return {
    forward: !veryWrong,
    backward: veryWrong,
    left,
    right,
    drift: sharpCorner,
  };
}

export function stepRace(
  state: SimRaceState,
  inputs: SimInput[],
  dtSec: number,
  raceBalanceAssistByPlayer?: number[],
  mode: GameMode = 'classic',
): SimRaceStepResult {
  const events: SimRaceEvent[] = [];
  state.tick += 1;
  state.timeMs += dtSec * 1000;
  const isArenaLayout = state.layoutType === 'arena';
  const arenaObstacles = isArenaLayout ? (state.interiorObstacles ?? []) : [];

  let arenaCenterX = 0;
  let arenaCenterZ = 0;
  let arenaRadiusX = 84;
  let arenaRadiusZ = 74;
  if (isArenaLayout && state.routeMain.length > 0) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const p of state.routeMain) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }
    arenaCenterX = (minX + maxX) * 0.5;
    arenaCenterZ = (minZ + maxZ) * 0.5;
    arenaRadiusX = Math.max(20, (maxX - minX) * 0.5 - 1.2);
    arenaRadiusZ = Math.max(20, (maxZ - minZ) * 0.5 - 1.2);
  }

  for (let i = 0; i < state.players.length; i++) {
    const p = state.players[i];
    const rt = state.runtime[i] ?? createDefaultRuntimeState();
    state.runtime[i] = rt;
    p.eliminated = p.chainLength <= 0;
    if (p.eliminated) {
      p.speed = 0;
      p.speedBoostActive = false;
      p.slowActive = false;
      rt.airborne = false;
      rt.vy = 0;
      rt.airborneElapsed = 0;
      continue;
    }

    tickRuntimeTimers(rt, dtSec * 1000);
    p.speedBoostActive = rt.speedBoostMs > 0;
    p.slowActive = rt.slowMs > 0;
    const tuning = getChainClassTuning(p.chainClass);
    const simInput = inputs[i] ?? { forward: false, backward: false, left: false, right: false, drift: false };
    const balanceAssist = raceBalanceAssistByPlayer?.[i] ?? 1;
    const res = stepPlayerKinematics(p, rt, simInput, dtSec, tuning, balanceAssist);
    if (!p.finished && res.driftStarted) events.push({ type: 'drift_start', playerIndex: i });
    if (!p.finished && res.driftEnded) events.push({ type: 'drift_end', playerIndex: i });
    if (res.driftBoostMs > 0) {
      rt.speedBoostMs = Math.max(rt.speedBoostMs, res.driftBoostMs);
      p.speed = Math.min(p.speed + res.driftBoostSpeed, tuning.maxSpeed * 1.6);
    }

    p.drifting = rt.drifting;
    p.driftDirection = rt.driftDirection;
    p.driftCharge = rt.driftCharge;

    p.x += Math.sin(res.moveAngle) * p.speed * dtSec;
    p.z += Math.cos(res.moveAngle) * p.speed * dtSec;
    const info = getRouteInfo(p.x, p.y, p.z, state.routeMain, state.routeAll);

    const loopInfluence = Math.min(1, Math.max(0, info.loopBlend));
    const tunnelInfluence = Math.min(1, Math.max(0, info.tunnelBlend));
    let arenaRoadY = info.elevation + 0.5;
    if (isArenaLayout) {
      // Resolve collisions against arena interior obstacle cylinders.
      for (const obs of arenaObstacles) {
        const ox = arenaCenterX + obs.x;
        const oz = arenaCenterZ + obs.z;
        const dx = p.x - ox;
        const dz = p.z - oz;
        const dist = Math.hypot(dx, dz);
        const kartRadius = 1.05;
        const hitRadius = Math.max(1, obs.radius) + kartRadius;
        if (dist < hitRadius) {
          const nx = dist > 1e-5 ? dx / dist : 1;
          const nz = dist > 1e-5 ? dz / dist : 0;
          p.x = ox + nx * hitRadius;
          p.z = oz + nz * hitRadius;
          p.speed *= 0.72;
          rt.slowMs = Math.max(rt.slowMs, 220);
        }
      }
      const dx = p.x - arenaCenterX;
      const dz = p.z - arenaCenterZ;
      const nx = dx / Math.max(1, arenaRadiusX);
      const nz = dz / Math.max(1, arenaRadiusZ);
      const nLen = Math.hypot(nx, nz);
      if (nLen > 1) {
        const inv = 1 / nLen;
        p.x = arenaCenterX + dx * inv;
        p.z = arenaCenterZ + dz * inv;
        p.speed *= 0.92;
      }
      const nx2 = (p.x - arenaCenterX) / Math.max(1, arenaRadiusX);
      const nz2 = (p.z - arenaCenterZ) / Math.max(1, arenaRadiusZ);
      const radialNorm = Math.min(1, Math.hypot(nx2, nz2));
      arenaRoadY = info.elevation + 0.5 + radialNorm * radialNorm * DEFAULT_ARENA_BOWL_RISE;
    } else {
      const margin = info.halfWidth - (tunnelInfluence > 0.01 ? 0.15 : 0.8);
      if (Math.abs(info.offset) > margin) {
        const sign = info.offset > 0 ? 1 : -1;
        const push = Math.abs(info.offset) - margin;
        p.x -= info.rightX * sign * push;
        p.z -= info.rightZ * sign * push;
      }
    }
    if (tunnelInfluence > 0.01) {
      // Tunnel ring steering should match player expectation:
      // left input moves toward left side of tunnel, right toward right side.
      const steer = (simInput.left ? 1 : 0) - (simInput.right ? 1 : 0);
      const speedRatio = Math.min(1, Math.abs(p.speed) / Math.max(1, tuning.maxSpeed));
      const rollRate = 2.8 + speedRatio * 1.7;
      const normalizeAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
      const prevAngle = rt.tunnelAngle;
      if (steer !== 0) rt.tunnelAngle += steer * rollRate * dtSec;
      rt.tunnelAngle = normalizeAngle(rt.tunnelAngle);
      // Tunnel half-wall acts as a hard blocker in ring-space: no side teleport.
      if (info.tunnelWall) {
        const blockedHalfAngle = 1.02;
        const centerAngle =
          info.tunnelWallSide === 'left'
            ? -Math.PI * 0.5
            : info.tunnelWallSide === 'right'
              ? Math.PI * 0.5
              : 0;
        const delta = normalizeAngle(rt.tunnelAngle - centerAngle);
        const prevDelta = normalizeAngle(prevAngle - centerAngle);
        if (Math.abs(delta) < blockedHalfAngle) {
          const edgeSign = Math.sign(prevDelta) !== 0
            ? Math.sign(prevDelta)
            : Math.sign(delta) !== 0
              ? Math.sign(delta)
              : (steer >= 0 ? 1 : -1);
          const edgeAngle = centerAngle + edgeSign * blockedHalfAngle;
          // Pin to nearest allowed edge with tiny outward bias so next step remains outside.
          rt.tunnelAngle = normalizeAngle(edgeAngle + edgeSign * 0.03);
          p.speed *= 0.62;
          rt.slowMs = Math.max(rt.slowMs, 120);
        }
      }
      const tunnelRadius = Math.max(2.4, info.halfWidth * 0.8);
      const kartContactInset = 0.34;
      const contactRadius = Math.max(1.25, tunnelRadius - kartContactInset);
      // As tunnel influence fades near exits, gradually unwind ring angle so
      // karts rejoin road orientation instead of dropping from side/top wall.
      const exitAssist = Math.min(1, Math.max(0, (0.55 - tunnelInfluence) / 0.55));
      if (exitAssist > 0) {
        const unwind = Math.min(1, dtSec * 8 * exitAssist);
        rt.tunnelAngle += (0 - rt.tunnelAngle) * unwind;
      }
      const relX = p.x - info.centerX;
      const relZ = p.z - info.centerZ;
      // Preserve forward travel along tunnel while steering only changes ring position.
      const along = relX * info.dirX + relZ * info.dirZ;
      const lateral = Math.sin(rt.tunnelAngle) * contactRadius;
      const targetX = info.centerX + info.dirX * along + info.rightX * lateral;
      const targetZ = info.centerZ + info.dirZ * along + info.rightZ * lateral;
      const tunnelCenterY = info.elevation + 0.5 + tunnelRadius;
      const tunnelY = tunnelCenterY - Math.cos(rt.tunnelAngle) * contactRadius;
      const roadY = info.elevation + 0.5;
      const targetY = tunnelY * (1 - exitAssist) + roadY * exitAssist;
      const blend = Math.min(1, Math.max(0.04, Math.pow(tunnelInfluence, 1.6)));
      p.x = p.x + (targetX - p.x) * blend;
      p.z = p.z + (targetZ - p.z) * blend;
      p.y = p.y + (targetY - p.y) * blend;
      // In tunnel, keep heading aligned with road direction for straight-driving feel.
      const tunnelHeading = Math.atan2(info.dirX, info.dirZ);
      const headingDelta = Math.atan2(Math.sin(tunnelHeading - p.heading), Math.cos(tunnelHeading - p.heading));
      p.heading += headingDelta * blend;
      rt.airborne = false;
      rt.vy = 0;
      rt.airborneElapsed = 0;
    } else if (loopInfluence > 0.01) {
      // Magnetic adhesion for loops: hold kart to track when geometry gets steep.
      const roadY = info.elevation + 0.5;
      const stick = Math.min(1, 0.45 + loopInfluence * 0.55);
      p.y = p.y + (roadY - p.y) * stick;
      const loopMargin = Math.max(0.3, info.halfWidth - 0.45);
      if (Math.abs(info.offset) > loopMargin) {
        const sign = info.offset > 0 ? 1 : -1;
        const push = Math.abs(info.offset) - loopMargin;
        p.x -= info.rightX * sign * push;
        p.z -= info.rightZ * sign * push;
        p.speed *= 0.96;
      }
      const loopHeading = Math.atan2(info.dirX, info.dirZ);
      const headingDelta = Math.atan2(Math.sin(loopHeading - p.heading), Math.cos(loopHeading - p.heading));
      p.heading += headingDelta * Math.min(1, 0.2 + loopInfluence * 0.5);
      p.speed = Math.max(p.speed, tuning.maxSpeed * (0.52 + 0.22 * loopInfluence));
      rt.airborne = false;
      rt.vy = 0;
      rt.airborneElapsed = 0;
    } else if (rt.tunnelAngle !== 0) {
      rt.tunnelAngle *= Math.max(0, 1 - dtSec * 4);
      if (Math.abs(rt.tunnelAngle) < 0.01) rt.tunnelAngle = 0;
    }

    if (!rt.airborne && info.ramp && p.speed > 10 && loopInfluence < 0.08 && tunnelInfluence < 0.08) {
      rt.airborne = true;
      rt.airborneElapsed = 0;
      rt.vy = 12 + p.speed * 0.3;
      events.push({ type: 'jump_start', playerIndex: i });
    }
    if (!rt.airborne && info.boost) {
      // Track boost strips continuously top up short boost time and enforce a strong minimum speed.
      rt.speedBoostMs = Math.max(rt.speedBoostMs, 120);
      p.speed = Math.max(p.speed, tuning.maxSpeed * 1.25);
    }
    if (rt.airborne) {
      rt.airborneElapsed += dtSec;
      rt.vy -= 20 * dtSec;
      p.y += rt.vy * dtSec;
      if (rt.airborneElapsed > 0.15 && p.y <= info.elevation + 0.6) {
        rt.airborne = false;
        rt.vy = 0;
        rt.airborneElapsed = 0;
        p.y = info.elevation + 0.5;
        events.push({ type: 'land', playerIndex: i });
      }
    } else if (tunnelInfluence <= 0.01) {
      const roadY = isArenaLayout ? arenaRoadY : info.elevation + 0.5;
      // Smooth settle after leaving tunnel so exit doesn't snap.
      if (Math.abs(rt.tunnelAngle) > 0.01) {
        const settle = Math.min(1, dtSec * 10);
        p.y += (roadY - p.y) * settle;
      } else {
        p.y = roadY;
      }
    }
    if (!rt.airborne) {
      const roadY = isArenaLayout ? arenaRoadY : info.elevation + 0.5;
      // Safety clamp: avoid non-physical post-tunnel "drop" artifacts.
      if (p.y > roadY + 0.55) {
        p.y = roadY + (p.y - roadY) * Math.max(0, 1 - dtSec * 18);
      } else if (p.y < roadY - 0.55) {
        p.y = roadY;
      }
    }

    const cpCount = state.checkpoints.length;
    if (!p.finished && cpCount > 0 && mode === 'classic') {
      const oldCp = p.lastCheckpoint;
      const next = (oldCp + 1 + cpCount) % cpCount;
      const cp = state.checkpoints[next];
      const dx = p.x - cp.x;
      const dz = p.z - cp.z;
      if (dx * dx + dz * dz < (cp.width * 0.85) * (cp.width * 0.85)) {
        p.lastCheckpoint = next;
        events.push({ type: 'checkpoint', playerIndex: i });
        if (next === 0 && (oldCp === cpCount - 1 || cpCount === 1)) {
          p.lap += 1;
          events.push({ type: 'lap', playerIndex: i });
          if (p.lap >= state.totalLaps) {
            p.finished = true;
            events.push({ type: 'finish', playerIndex: i });
          }
        }
      }
    }
  }

  return { state, events };
}

export function trySacrificeBoost(
  playerIndex: number,
  players: SimEffectPlayerState[],
  runtime: Array<{ speedBoostMs: number }>,
  sacrificeCooldownMs: number[],
  maxSpeedByPlayer: number[],
  options?: {
    minChainRequired?: number;
    cooldownMs?: number;
    boostDurationMs?: number;
  },
): boolean {
  const minChainRequired = options?.minChainRequired ?? 3;
  const cooldownMs = options?.cooldownMs ?? 2200;
  const boostDurationMs = options?.boostDurationMs ?? 1700;
  const p = players[playerIndex];
  if (!p || p.finished || p.chainLength <= 0) return false;
  if ((sacrificeCooldownMs[playerIndex] ?? 0) > 0) return false;
  if (p.chainLength < minChainRequired) return false;
  p.chainLength = Math.max(1, p.chainLength - 1);
  p.speed = Math.max(p.speed, (maxSpeedByPlayer[playerIndex] ?? 28) * 0.62);
  runtime[playerIndex].speedBoostMs = Math.max(runtime[playerIndex].speedBoostMs, boostDurationMs);
  sacrificeCooldownMs[playerIndex] = cooldownMs;
  return true;
}

function attackerHitsVictimBody(
  attacker: SimEffectPlayerState,
  victim: SimEffectPlayerState,
  segmentSpacing: number,
  headToBodyHitDistance: number,
): boolean {
  const ax = attacker.x;
  const ay = attacker.y;
  const az = attacker.z;
  const fx = Math.sin(victim.heading);
  const fz = Math.cos(victim.heading);
  for (let seg = 1; seg < victim.chainLength; seg++) {
    const sx = victim.x - fx * seg * segmentSpacing;
    const sy = victim.y;
    const sz = victim.z - fz * seg * segmentSpacing;
    const dx = ax - sx;
    const dy = ay - sy;
    const dz = az - sz;
    if (dx * dx + dy * dy + dz * dz <= headToBodyHitDistance * headToBodyHitDistance) return true;
  }
  return false;
}

export function stepStealCollisions(
  players: SimEffectPlayerState[],
  activeSlots: boolean[],
  runtime: Array<{ slowMs: number }>,
  stealCooldownMs: number[][],
  dtSec: number,
  events: SimRaceEvent[],
  options?: {
    maxBlocks?: number;
    cooldownMs?: number;
    segmentSpacing?: number;
    headToBodyHitDistance?: number;
  },
) {
  const maxBlocks = options?.maxBlocks ?? 12;
  const cooldownMs = options?.cooldownMs ?? 1100;
  const segmentSpacing = options?.segmentSpacing ?? 0.88;
  const headToBodyHitDistance = options?.headToBodyHitDistance ?? 1.0;
  const deltaMs = dtSec * 1000;
  for (let i = 0; i < players.length; i++) {
    for (let j = 0; j < players.length; j++) {
      if ((stealCooldownMs[i]?.[j] ?? 0) > 0) {
        stealCooldownMs[i][j] = Math.max(0, stealCooldownMs[i][j] - deltaMs);
      }
    }
  }

  for (let attacker = 0; attacker < players.length; attacker++) {
    if (!activeSlots[attacker]) continue;
    const atk = players[attacker];
    if (atk.finished || atk.chainLength <= 0) continue;
    for (let victim = 0; victim < players.length; victim++) {
      if (attacker === victim) continue;
      if (!activeSlots[victim]) continue;
      if ((stealCooldownMs[attacker]?.[victim] ?? 0) > 0 || (stealCooldownMs[victim]?.[attacker] ?? 0) > 0) continue;
      const vic = players[victim];
      if (vic.finished || vic.chainLength <= 1) continue;

      if (!attackerHitsVictimBody(atk, vic, segmentSpacing, headToBodyHitDistance)) continue;

      atk.chainLength = Math.max(0, atk.chainLength - 1);
      vic.chainLength = Math.min(maxBlocks, vic.chainLength + 1);
      atk.speed = Math.min(atk.speed * 0.35, 3.5);
      runtime[attacker].slowMs = Math.max(runtime[attacker].slowMs, 700);
      vic.speed = Math.min(28 * 1.35, vic.speed + 2.2);
      events.push({ type: 'steal_hit', playerIndex: attacker, targetPlayerIndex: victim });

      stealCooldownMs[attacker][victim] = cooldownMs;
      stealCooldownMs[victim][attacker] = cooldownMs;
    }
  }
}

export function rollPreviewItem(randomFn: () => number = Math.random): ItemId {
  const weights: Array<[ItemId, number]> = [
    ['ln_turbo', 0.24],
    ['mempool_mine', 0.18],
    ['fee_spike', 0.24],
    ['sats_siphon', 0.20],
    ['nostr_zap', 0.14],
  ];
  const total = weights.reduce((s, [, w]) => s + w, 0);
  let r = randomFn() * total;
  for (const [id, w] of weights) {
    r -= w;
    if (r <= 0) return id;
  }
  return 'ln_turbo';
}

export function stepItemBoxes(
  itemBoxes: SimItemBoxState[],
  dtSec: number,
  finalLapIntensity: boolean,
  randomFn: () => number = Math.random,
) {
  const deltaMs = dtSec * 1000;
  for (const box of itemBoxes) {
    if (!box.active) {
      box.respawnMs -= deltaMs;
      if (box.respawnMs <= 0) {
        box.active = true;
        box.previewItem = rollPreviewItem(randomFn);
      }
    } else {
      box.respawnMs -= deltaMs;
      if (box.respawnMs <= 0) {
        box.previewItem = rollPreviewItem(randomFn);
        box.respawnMs = finalLapIntensity ? 1100 : 2200;
      }
    }
  }
}

export function collectNearbyItem(
  playerIndex: number,
  players: SimItemPlayerState[],
  itemBoxes: SimItemBoxState[],
  finalLapIntensity: boolean,
): boolean {
  const p = players[playerIndex];
  if (!p || p.finished || p.chainLength <= 0 || p.heldItemId) return false;
  for (const box of itemBoxes) {
    if (!box.active) continue;
    const dx = p.x - box.x;
    const dy = p.y - box.y;
    const dz = p.z - box.z;
    const planarDist2 = dx * dx + dz * dz;
    if (planarDist2 > 3.4 * 3.4) continue;
    if (Math.abs(dy) > 4.0) continue;
    p.heldItemId = box.previewItem;
    box.active = false;
    box.respawnMs = finalLapIntensity ? 3500 : 5000;
    return true;
  }
  return false;
}

function findNearestOpponent(
  playerIndex: number,
  players: SimItemPlayerState[],
  requireStealable = false,
): number {
  const user = players[playerIndex];
  let nearest = -1;
  let bestDist2 = Infinity;
  for (let i = 0; i < players.length; i++) {
    if (i === playerIndex) continue;
    const opp = players[i];
    if (opp.finished || opp.chainLength <= 0) continue;
    if (requireStealable && opp.chainLength <= 1) continue;
    const dx = user.x - opp.x;
    const dy = user.y - opp.y;
    const dz = user.z - opp.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < bestDist2) {
      bestDist2 = d2;
      nearest = i;
    }
  }
  return nearest;
}

export function useHeldItem(
  playerIndex: number,
  players: SimItemPlayerState[],
  runtime: Array<{ speedBoostMs: number; slowMs: number }>,
  obstacles: SimObstacleState[],
  finalLapIntensity: boolean,
  events: SimRaceEvent[],
  maxBlocks = 12,
): boolean {
  const user = players[playerIndex];
  const item = user?.heldItemId ?? null;
  if (!item) return false;

  if (item === 'ln_turbo') {
    runtime[playerIndex].speedBoostMs = Math.max(
      runtime[playerIndex].speedBoostMs,
      (finalLapIntensity ? 1.2 : 1) * 2200,
    );
    events.push({ type: 'item_used', playerIndex, itemId: item });
  } else if (item === 'mempool_mine') {
    const fx = Math.sin(user.heading);
    const fz = Math.cos(user.heading);
    obstacles.push({
      x: user.x - fx * 3,
      y: user.y,
      z: user.z - fz * 3,
      lifetimeMs: 15000,
    });
    events.push({ type: 'item_used', playerIndex, itemId: item });
  } else if (item === 'fee_spike') {
    const nearest = findNearestOpponent(playerIndex, players);
    if (nearest >= 0) {
      runtime[nearest].slowMs = Math.max(runtime[nearest].slowMs, (finalLapIntensity ? 1.25 : 1) * 2400);
      events.push({ type: 'item_used', playerIndex, itemId: item, targetPlayerIndex: nearest });
    }
  } else if (item === 'sats_siphon') {
    const nearest = findNearestOpponent(playerIndex, players, true);
    if (nearest >= 0) {
      const target = players[nearest];
      if (target.chainLength > 1) {
        target.chainLength = Math.max(1, target.chainLength - 1);
        user.chainLength = Math.min(maxBlocks, user.chainLength + 1);
        user.speed = Math.min(28 * 1.35, user.speed + 2.2);
        runtime[nearest].slowMs = Math.max(runtime[nearest].slowMs, 700);
        target.speed = Math.min(target.speed * 0.35, 3.5);
        events.push({ type: 'item_used', playerIndex, itemId: item, targetPlayerIndex: nearest });
      }
    }
  } else if (item === 'nostr_zap') {
    let hitCount = 0;
    for (let i = 0; i < players.length; i++) {
      if (i === playerIndex) continue;
      const opp = players[i];
      if (opp.finished || opp.chainLength <= 0) continue;
      const dx = user.x - opp.x;
      const dy = user.y - opp.y;
      const dz = user.z - opp.z;
      if (dx * dx + dy * dy + dz * dz <= 18 * 18) {
        runtime[i].slowMs = Math.max(runtime[i].slowMs, (finalLapIntensity ? 1.3 : 1) * 1600);
        hitCount++;
        events.push({ type: 'item_used', playerIndex, itemId: item, targetPlayerIndex: i });
      }
    }
    if (hitCount === 0) {
      runtime[playerIndex].speedBoostMs = Math.max(runtime[playerIndex].speedBoostMs, 500);
      events.push({ type: 'item_used', playerIndex, itemId: item });
    }
  }
  user.heldItemId = null;
  return true;
}

export function shouldAiUseItem(
  playerIndex: number,
  players: SimItemPlayerState[],
  item: ItemId,
  mode: GameMode = 'classic',
  randomFn: () => number = Math.random,
): boolean {
  const derbyBias = mode === 'derby';
  if (item === 'ln_turbo') return randomFn() < (derbyBias ? 0.34 : 0.22);
  if (item === 'mempool_mine') return randomFn() < (derbyBias ? 0.26 : 0.18);
  if (item === 'fee_spike') return findNearestOpponent(playerIndex, players) >= 0 && randomFn() < (derbyBias ? 0.48 : 0.35);
  if (item === 'sats_siphon') return findNearestOpponent(playerIndex, players, true) >= 0 && randomFn() < (derbyBias ? 0.52 : 0.38);
  if (item === 'nostr_zap') {
    const p = players[playerIndex];
    for (let i = 0; i < players.length; i++) {
      if (i === playerIndex) continue;
      const opp = players[i];
      if (opp.finished || opp.chainLength <= 0) continue;
      const dx = p.x - opp.x;
      const dy = p.y - opp.y;
      const dz = p.z - opp.z;
      if (dx * dx + dy * dy + dz * dz <= 18 * 18) return true;
    }
    return randomFn() < (derbyBias ? 0.22 : 0.14);
  }
  return false;
}

export function consumeRaceActionEdges(
  input: SimRaceActionInput,
  pressState: SimRaceActionPressState,
): SimRaceActionEdges {
  const usePressed = !!input.useItem;
  const sacrificePressed = !!input.sacrificeBoost;
  const edges: SimRaceActionEdges = {
    useItemJustPressed: usePressed && !pressState.prevUseItemPressed,
    sacrificeJustPressed: sacrificePressed && !pressState.prevSacrificePressed,
  };
  pressState.prevUseItemPressed = usePressed;
  pressState.prevSacrificePressed = sacrificePressed;
  return edges;
}

export function getRaceBalanceAssist(
  rank: number,
  chainLength: number,
  startChainBlocks = 5,
): number {
  const rankAssist = [0.95, 0.99, 1.03, 1.07];
  const clampedRank = Math.max(0, Math.min(rankAssist.length - 1, rank | 0));
  const byRank = rankAssist[clampedRank] ?? 1;
  const deltaBlocks = chainLength - startChainBlocks;
  let chainAssist = 1;
  if (deltaBlocks < 0) chainAssist += Math.min(0.05, Math.abs(deltaBlocks) * 0.02);
  else if (deltaBlocks > 0) chainAssist -= Math.min(0.03, deltaBlocks * 0.0075);
  return byRank * chainAssist;
}

export function stepObstacles(
  obstacles: SimObstacleState[],
  players: SimItemPlayerState[],
  dtSec: number,
) {
  const deltaMs = dtSec * 1000;
  for (let i = obstacles.length - 1; i >= 0; i--) {
    const obs = obstacles[i];
    obs.lifetimeMs -= deltaMs;
    if (obs.lifetimeMs <= 0) {
      obstacles.splice(i, 1);
      continue;
    }
    for (const p of players) {
      if (p.finished || p.chainLength <= 0) continue;
      const dx = p.x - obs.x;
      const dy = p.y - obs.y;
      const dz = p.z - obs.z;
      if (dx * dx + dy * dy + dz * dz < 2.0 * 2.0) {
        p.speed *= 0.3;
        p.heading += Math.PI * 0.25;
        obstacles.splice(i, 1);
        break;
      }
    }
  }
}

export function shouldEnableFinalLapIntensity(
  players: Array<{ lap: number; finished: boolean; chainLength: number }>,
  totalLaps: number,
): boolean {
  return players.some(p => !p.finished && p.chainLength > 0 && p.lap >= totalLaps - 1);
}

export function computePlacements(
  players: SimPlacementPlayer[],
  checkpointCount: number,
  mode: GameMode = 'classic',
): number[] {
  const rows = players.map((p, i) => ({
    i,
    finished: !!p.finished,
    eliminated: !!p.eliminated,
    finishTime: p.finishTime ?? Number.POSITIVE_INFINITY,
    progress: p.lap * checkpointCount + p.lastCheckpoint,
    chainLength: p.chainLength,
  }));
  rows.sort((a, b) => {
    if (mode === 'derby') {
      if (a.eliminated !== b.eliminated) return a.eliminated ? 1 : -1;
      if (a.chainLength !== b.chainLength) return b.chainLength - a.chainLength;
      if (a.progress !== b.progress) return b.progress - a.progress;
      return a.i - b.i;
    }
    if (a.finished !== b.finished) return a.finished ? -1 : 1;
    if (a.finished && b.finished && a.finishTime !== b.finishTime) return a.finishTime - b.finishTime;
    if (a.eliminated !== b.eliminated) return a.eliminated ? 1 : -1;
    if (a.progress !== b.progress) return b.progress - a.progress;
    return b.chainLength - a.chainLength;
  });
  return rows.map(r => r.i);
}

export function shouldEndRace(
  players: Array<{ finished: boolean; eliminated: boolean }>,
  minFinishers = 3,
  mode: GameMode = 'classic',
  raceTimeMs = 0,
): boolean {
  if (mode === 'derby') {
    const aliveCount = players.filter(p => !p.eliminated).length;
    if (aliveCount <= 1) return true;
    if (aliveCount === 0) return true;
    if (raceTimeMs >= DERBY_MAX_TIME_MS) return true;
    return false;
  }
  const finishedCount = players.filter(p => p.finished).length;
  const aliveCount = players.filter(p => !p.eliminated).length;
  const canStillReachMinFinishers = aliveCount >= minFinishers;
  if (finishedCount >= minFinishers) return true;
  if (finishedCount >= 1 && !canStillReachMinFinishers) return true;
  if (aliveCount === 0) return true;
  return false;
}

const sim = {
  getChainClassTuning,
  tickRuntimeTimers,
  stepPlayerKinematics,
  createSimRandomState,
  nextSimRandom,
  createDefaultRuntimeState,
  getRouteInfo,
  buildSimArenaMainRoutePoints,
  buildSimRoutePointsFromControlPoints,
  buildDefaultSimMainRoutePoints,
  buildSimShortcutRoutePoints,
  buildSimMainRoutePoints,
  buildSimRoutePoints,
  buildSimCheckpoints,
  buildItemBoxPositions,
  buildSimItemBoxes,
  buildSimStartFrame,
  buildSimStartSlotPose,
  getBasicAiInput,
  getAdvancedAiInput,
  stepRace,
  trySacrificeBoost,
  stepStealCollisions,
  rollPreviewItem,
  stepItemBoxes,
  collectNearbyItem,
  useHeldItem,
  shouldAiUseItem,
  consumeRaceActionEdges,
  getRaceBalanceAssist,
  stepObstacles,
  shouldEnableFinalLapIntensity,
  computePlacements,
  shouldEndRace,
};

export default sim;

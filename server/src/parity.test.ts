import sim from '../../shared/sim';
import type { SimInput, SimRaceState } from '../../shared/sim';

const {
  buildSimCheckpoints,
  buildSimMainRoutePoints,
  buildSimStartSlotPose,
  createDefaultRuntimeState,
  createSimRandomState,
  nextSimRandom,
  stepRace,
} = sim as any;

function runTrace(seed: number): string {
  const rng = createSimRandomState(seed);
  const routeMain = buildSimMainRoutePoints(null);
  const checkpoints = buildSimCheckpoints(routeMain, 14);
  const players = Array.from({ length: 4 }, (_, i) => {
    const start = buildSimStartSlotPose(routeMain, i);
    return {
      x: start.x,
      y: start.y,
      z: start.z,
      heading: start.heading,
      speed: 0,
      chainLength: 5,
      chainClass: 'balanced' as const,
      drifting: false,
      driftDirection: 0,
      driftCharge: 0,
      lap: 0,
      lastCheckpoint: -1,
      finished: false,
      eliminated: false,
      speedBoostActive: false,
      slowActive: false,
    };
  });
  const runtime = Array.from({ length: 4 }, () => createDefaultRuntimeState());
  let state: SimRaceState = {
    tick: 0,
    timeMs: 0,
    totalLaps: 3,
    routeMain: routeMain,
    routeAll: routeMain,
    checkpoints,
    players,
    runtime,
  };
  for (let t = 0; t < 300; t++) {
    const inputs: SimInput[] = Array.from({ length: 4 }, () => {
      const r = nextSimRandom(rng);
      return {
        forward: true,
        backward: false,
        left: r < 0.28,
        right: r > 0.72,
        drift: r > 0.45 && r < 0.9,
      };
    });
    state = stepRace(state, inputs, 1 / 30, [1, 1, 1, 1]).state;
  }
  return JSON.stringify(
    state.players.map(p => [
      p.x.toFixed(3),
      p.y.toFixed(3),
      p.z.toFixed(3),
      p.heading.toFixed(3),
      p.speed.toFixed(3),
      p.lap,
      p.lastCheckpoint,
      p.chainLength,
      Number(p.finished),
      Number(p.eliminated),
    ]),
  );
}

function runDerbyTrace(seed: number): string {
  const rng = createSimRandomState(seed);
  const routeMain = buildSimMainRoutePoints(null);
  const checkpoints = buildSimCheckpoints(routeMain, 14);
  const players = Array.from({ length: 4 }, (_, i) => {
    const start = buildSimStartSlotPose(routeMain, i);
    return {
      x: start.x,
      y: start.y,
      z: start.z,
      heading: start.heading,
      speed: 0,
      chainLength: 5,
      chainClass: 'balanced' as const,
      drifting: false,
      driftDirection: 0,
      driftCharge: 0,
      lap: 0,
      lastCheckpoint: -1,
      finished: false,
      eliminated: false,
      speedBoostActive: false,
      slowActive: false,
    };
  });
  const runtime = Array.from({ length: 4 }, () => createDefaultRuntimeState());
  let state: SimRaceState = {
    tick: 0,
    timeMs: 0,
    totalLaps: 99,
    routeMain,
    routeAll: routeMain,
    checkpoints,
    players,
    runtime,
  };
  for (let t = 0; t < 360; t++) {
    const inputs: SimInput[] = Array.from({ length: 4 }, () => {
      const r = nextSimRandom(rng);
      return {
        forward: true,
        backward: false,
        left: r < 0.24,
        right: r > 0.76,
        drift: r > 0.5 && r < 0.94,
      };
    });
    state = stepRace(state, inputs, 1 / 30, [1, 1, 1, 1], 'derby').state;
    // deterministic attrition pressure for derby parity coverage
    if (t > 40 && t % 45 === 0) {
      const target = Math.floor(nextSimRandom(rng) * 4) % 4;
      state.players[target].chainLength = Math.max(0, state.players[target].chainLength - 1);
      state.players[target].eliminated = state.players[target].chainLength <= 0;
    }
  }
  return JSON.stringify(
    state.players.map(p => [
      p.x.toFixed(3),
      p.y.toFixed(3),
      p.z.toFixed(3),
      p.heading.toFixed(3),
      p.speed.toFixed(3),
      p.chainLength,
      Number(p.eliminated),
    ]),
  );
}

function runArenaDerbyTrace(seed: number): string {
  const rng = createSimRandomState(seed);
  const layout = {
    layoutType: 'arena' as const,
    arenaShape: 'circle' as const,
    arenaRadiusX: 92,
    arenaRadiusZ: 78,
    arenaFloorY: 4,
    arenaWallHeight: 8,
    main: [],
    shortcut: [],
  };
  const routeMain = buildSimMainRoutePoints(layout as any);
  const checkpoints = buildSimCheckpoints(routeMain, 14, layout as any);
  const players = Array.from({ length: 4 }, (_, i) => {
    const start = buildSimStartSlotPose(routeMain, i, undefined, layout as any);
    return {
      x: start.x,
      y: start.y,
      z: start.z,
      heading: start.heading,
      speed: 0,
      chainLength: 5,
      chainClass: 'balanced' as const,
      drifting: false,
      driftDirection: 0,
      driftCharge: 0,
      lap: 0,
      lastCheckpoint: -1,
      finished: false,
      eliminated: false,
      speedBoostActive: false,
      slowActive: false,
    };
  });
  const runtime = Array.from({ length: 4 }, () => createDefaultRuntimeState());
  let state: SimRaceState = {
    tick: 0,
    timeMs: 0,
    totalLaps: 99,
    routeMain,
    routeAll: routeMain,
    checkpoints,
    players,
    runtime,
  };
  for (let t = 0; t < 420; t++) {
    const inputs: SimInput[] = Array.from({ length: 4 }, () => {
      const r = nextSimRandom(rng);
      return {
        forward: true,
        backward: false,
        left: r < 0.27,
        right: r > 0.73,
        drift: r > 0.54 && r < 0.94,
      };
    });
    state = stepRace(state, inputs, 1 / 30, [1, 1, 1, 1], 'derby').state;
  }
  return JSON.stringify(
    state.players.map(p => [
      p.x.toFixed(3),
      p.y.toFixed(3),
      p.z.toFixed(3),
      p.heading.toFixed(3),
      p.speed.toFixed(3),
      p.chainLength,
      Number(p.eliminated),
    ]),
  );
}

const a = runTrace(1337);
const b = runTrace(1337);
const c = runTrace(7331);
const d = runDerbyTrace(1337);
const e = runDerbyTrace(1337);
const f = runDerbyTrace(7331);
const g = runArenaDerbyTrace(1337);
const h = runArenaDerbyTrace(1337);
const i = runArenaDerbyTrace(7331);

if (a !== b) {
  throw new Error('Deterministic parity failed: same seed produced different traces.');
}
if (a === c) {
  throw new Error('Deterministic parity failed: different seeds produced identical traces.');
}
if (d !== e) {
  throw new Error('Derby deterministic parity failed: same seed produced different traces.');
}
if (d === f) {
  throw new Error('Derby deterministic parity failed: different seeds produced identical traces.');
}
if (g !== h) {
  throw new Error('Arena derby deterministic parity failed: same seed produced different traces.');
}
if (g === i) {
  throw new Error('Arena derby deterministic parity failed: different seeds produced identical traces.');
}

console.log('Parity test passed.');

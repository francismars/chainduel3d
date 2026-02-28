import sim from '../../shared/sim';
import type { SimInput, SimRaceState } from '../../shared/sim';

const {
  buildSimCheckpoints,
  buildSimMainTrackPoints,
  buildSimStartSlotPose,
  createDefaultRuntimeState,
  createSimRandomState,
  nextSimRandom,
  stepRace,
} = sim as any;

function runTrace(seed: number): string {
  const rng = createSimRandomState(seed);
  const trackMain = buildSimMainTrackPoints(null);
  const checkpoints = buildSimCheckpoints(trackMain, 14);
  const players = Array.from({ length: 4 }, (_, i) => {
    const start = buildSimStartSlotPose(trackMain, i);
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
    trackMain,
    trackAll: trackMain,
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

const a = runTrace(1337);
const b = runTrace(1337);
const c = runTrace(7331);

if (a !== b) {
  throw new Error('Deterministic parity failed: same seed produced different traces.');
}
if (a === c) {
  throw new Error('Deterministic parity failed: different seeds produced identical traces.');
}

console.log('Parity test passed.');

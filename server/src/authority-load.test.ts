import { RoomManager } from './room.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[idx];
}

function run() {
  const rooms = new RoomManager();
  const roomCount = Number(process.env.LOAD_ROOMS || 24);
  const ticks = Number(process.env.LOAD_TICKS || 240);
  const samples: number[] = [];
  for (let i = 0; i < roomCount; i++) {
    const created = rooms.create({
      hostName: `LoadHost${i + 1}`,
      settings: {
        laps: 3,
        aiCount: 3,
        maxHumans: 4,
        chainClasses: ['balanced', 'balanced', 'balanced', 'balanced'],
        routeId: 'default',
        mode: 'classic',
      },
    });
    rooms.startRace(created.room.roomId, created.memberId, created.memberToken, null, 'default');
    // Move countdown to racing quickly for benchmark.
    const state = rooms.get(created.room.roomId);
    if (state?.race) {
      state.race.startedAt = Date.now() - 100;
    }
  }

  for (let t = 0; t < ticks; t++) {
    const startedAt = Date.now();
    for (const roomId of rooms.listActiveRaceRoomIds()) {
      rooms.tickRace(roomId, 1 / 30);
    }
    samples.push(Date.now() - startedAt);
  }

  const p95 = percentile(samples, 0.95);
  const p99 = percentile(samples, 0.99);
  const avg = samples.reduce((acc, n) => acc + n, 0) / Math.max(1, samples.length);
  console.log(`[authority-load] rooms=${roomCount} ticks=${ticks} avg_ms=${avg.toFixed(2)} p95_ms=${p95.toFixed(2)} p99_ms=${p99.toFixed(2)}`);
  assert(p95 < 40, `Authority loop p95 too high: ${p95.toFixed(2)}ms`);
}

run();


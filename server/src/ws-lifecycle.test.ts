import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocket } from 'ws';

type JsonValue = Record<string, unknown>;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function request(baseUrl: string, path: string, init?: RequestInit) {
  const res = await fetch(`${baseUrl}${path}`, init);
  const text = await res.text();
  const json = text ? (JSON.parse(text) as JsonValue) : {};
  return { res, json };
}

async function waitForHealthy(baseUrl: string, timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`${baseUrl}/health`);
      if (res.ok) return;
    } catch {
      // keep polling
    }
    await delay(200);
  }
  throw new Error('Server did not become healthy in time');
}

async function openSocket(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.on('open', () => resolve(ws));
    ws.on('error', (err) => reject(err));
  });
}

async function onceMessage(ws: WebSocket, timeoutMs = 4000): Promise<JsonValue> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for ws message')), timeoutMs);
    ws.once('message', (data) => {
      clearTimeout(timer);
      resolve(JSON.parse(data.toString()) as JsonValue);
    });
  });
}

async function run() {
  const port = 3511;
  const baseUrl = `http://127.0.0.1:${port}`;
  const wsUrl = `ws://127.0.0.1:${port}/ws`;
  const server = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'test',
      ROUTE_ADMIN_SECRET: 'test-secret',
      RUNTIME_STATE_FILE: 'server/data/runtime/test-state.json',
    },
    stdio: 'pipe',
  });
  try {
    await waitForHealthy(baseUrl);
    const created = await request(baseUrl, '/api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hostName: 'WsHost',
        settings: { laps: 3, aiCount: 1, routeId: 'default', mode: 'classic' },
      }),
    });
    assert(created.res.ok, 'Failed to create room');
    const room = created.json.room as JsonValue;
    const roomId = String(room.roomId || '');
    const memberId = String(created.json.memberId || '');
    const memberToken = String(created.json.memberToken || '');
    assert(roomId && memberId && memberToken, 'Missing room credentials');

    const ws = await openSocket(wsUrl);
    ws.send(JSON.stringify({
      type: 'room_subscribe',
      roomId,
      memberId,
      memberToken,
    }));
    const roomState = await onceMessage(ws);
    assert(roomState.type === 'room_state', 'Expected room_state after subscribe');

    ws.send(JSON.stringify({
      type: 'room_chat_send',
      roomId,
      memberId,
      memberToken,
      text: 'hello',
    }));
    const chat = await onceMessage(ws);
    assert(chat.type === 'chat_message', 'Expected chat_message');

    const start = await request(baseUrl, `/api/rooms/${encodeURIComponent(roomId)}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberId, memberToken, routeId: 'default' }),
    });
    assert(start.res.ok, 'Failed to start race');

    let sawSnapshot = false;
    for (let i = 0; i < 20; i++) {
      const msg = await onceMessage(ws, 1500);
      if (msg.type === 'race_snapshot') {
        sawSnapshot = true;
        break;
      }
    }
    assert(sawSnapshot, 'Expected at least one race_snapshot');

    ws.close();
  } finally {
    server.kill('SIGINT');
  }
}

run().catch((err) => {
  console.error('[ws-lifecycle] Failure:', err instanceof Error ? err.message : err);
  process.exit(1);
});


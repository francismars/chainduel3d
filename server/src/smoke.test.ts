type JsonValue = Record<string, unknown>;

const baseUrl = (process.env.SMOKE_BASE_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
const adminSecret = process.env.SMOKE_ADMIN_SECRET || '';

async function request(path: string, init?: RequestInit) {
  const res = await fetch(`${baseUrl}${path}`, init);
  const text = await res.text();
  let json: JsonValue | null = null;
  try {
    json = text ? (JSON.parse(text) as JsonValue) : null;
  } catch {
    json = null;
  }
  return { res, json, text };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function run() {
  console.log(`[smoke] Base URL: ${baseUrl}`);

  const health = await request('/health');
  assert(health.res.ok, `Health check failed: ${health.res.status}`);
  assert(health.json?.ok === true, 'Health check payload missing ok=true');

  const routes = await request('/api/routes');
  assert(routes.res.ok, `Routes list failed: ${routes.res.status}`);
  assert(Array.isArray(routes.json?.routes), 'Routes payload missing routes array');

  const unauthorizedAdmin = await request('/api/admin/routes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Smoke Route', layout: null }),
  });
  assert(unauthorizedAdmin.res.status === 401, `Expected 401 for unauthorized admin route call, got ${unauthorizedAdmin.res.status}`);

  const roomCreate = await request('/api/rooms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      hostName: 'SmokeHost',
      settings: { laps: 3, aiCount: 1, routeId: 'default', mode: 'classic' },
      spectatorHost: false,
    }),
  });
  assert(roomCreate.res.ok, `Room creation failed: ${roomCreate.res.status}`);
  const roomPayload = roomCreate.json as JsonValue;
  const room = roomPayload?.room as JsonValue;
  const roomId = String(room?.roomId || '');
  const memberId = String(roomPayload?.memberId || '');
  const memberToken = String(roomPayload?.memberToken || '');
  assert(roomId && memberId && memberToken, 'Room creation payload missing member credentials');

  const roomStart = await request(`/api/rooms/${encodeURIComponent(roomId)}/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      memberId,
      memberToken,
      routeId: 'default',
      routeLayout: null,
    }),
  });
  assert(roomStart.res.ok, `Room start failed: ${roomStart.res.status}`);

  const sessionCreate = await request('/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ wagerAmount: 10, playerNames: ['Smoke P1', 'Smoke P2'] }),
  });
  assert(sessionCreate.res.ok, `Session creation failed: ${sessionCreate.res.status}`);
  const sessionId = String((sessionCreate.json as JsonValue)?.sessionId || '');
  assert(sessionId, 'Session creation did not return sessionId');

  const sessionResult = await request(`/api/sessions/${encodeURIComponent(sessionId)}/result`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ winnerId: 'player1' }),
  });
  assert(sessionResult.res.ok, `Session result failed: ${sessionResult.res.status}`);

  if (adminSecret) {
    const createAdminRoute = await request('/api/admin/routes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-secret': adminSecret,
      },
      body: JSON.stringify({ name: 'Smoke Admin Route', layout: null }),
    });
    assert(createAdminRoute.res.ok, `Authorized admin route create failed: ${createAdminRoute.res.status}`);
    const routeId = String((createAdminRoute.json as JsonValue)?.route && ((createAdminRoute.json as JsonValue).route as JsonValue).id || '');
    assert(routeId, 'Authorized admin route create missing route id');

    const deleteAdminRoute = await request(`/api/admin/routes/${encodeURIComponent(routeId)}`, {
      method: 'DELETE',
      headers: { 'x-admin-secret': adminSecret },
    });
    assert(deleteAdminRoute.res.ok, `Authorized admin route delete failed: ${deleteAdminRoute.res.status}`);
  } else {
    console.log('[smoke] SMOKE_ADMIN_SECRET not set; skipped authorized admin API checks.');
  }

  console.log('[smoke] Smoke checks passed.');
}

run().catch((err) => {
  console.error('[smoke] Failure:', err instanceof Error ? err.message : err);
  process.exit(1);
});

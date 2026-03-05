import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { SessionManager } from './session.js';
import { LNBitsClient } from './lnbits.js';
import { EscrowManager } from './escrow.js';
import { RoomManager } from './room.js';
import { RaceAuthority } from './race-authority.js';
import { RouteCatalog } from './routes.js';
import { RuntimePersistence } from './persistence.js';
import { Observability } from './observability.js';
import { SettlementManager } from './settlement.js';
import type {
  ChainClass,
  GameMode,
  RoomClientMessage,
  RoomServerMessage,
  StartRoomRequest,
  RouteCustomLayout,
  KickRoomMemberRequest,
  SetReadyRequest,
  SetRoomNameRequest,
} from '../../shared/types.js';

type JoinRoomRequest = { code: string; name: string };

dotenv.config();

const PORT = parseInt(process.env.PORT || '3000');
const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_PRODUCTION = NODE_ENV === 'production';
const MAX_PLAYERS = 8;

const app = express();
app.use(helmet());
app.use(express.json({ limit: '100kb' }));
app.disable('x-powered-by');
app.set('trust proxy', 1);
const obs = new Observability();
app.use(obs.middleware());

const adminRateLimiter = rateLimit({
  windowMs: 60_000,
  max: IS_PRODUCTION ? 60 : 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many admin requests, please retry later.' },
});
const claimRateLimiter = rateLimit({
  windowMs: 60_000,
  max: IS_PRODUCTION ? 25 : 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many claim requests, please retry later.' },
});

// LNBits client
const lnbits = new LNBitsClient({
  url: process.env.LNBITS_URL || 'https://legend.lnbits.com',
  adminKey: process.env.LNBITS_ADMIN_KEY || '',
  invoiceKey: process.env.LNBITS_INVOICE_KEY || '',
});

const sessions = new SessionManager();
const escrow = new EscrowManager(lnbits, sessions);
const rooms = new RoomManager();
const settlements = new SettlementManager(lnbits);
const routes = new RouteCatalog();
const ROUTE_ADMIN_SECRET = process.env.ROUTE_ADMIN_SECRET || '';
const runtimeStore = new RuntimePersistence(process.env.RUNTIME_STATE_FILE || 'server/data/runtime/state.json');
const ADMIN_TOKEN_TTL_MS = Math.max(60_000, Number(process.env.ADMIN_TOKEN_TTL_MS || 15 * 60 * 1000));
const ADMIN_TOKEN_ISSUER = 'chainduel3d-admin';
if (!ROUTE_ADMIN_SECRET) {
  console.warn('[admin] ROUTE_ADMIN_SECRET is not set; admin route endpoints are disabled.');
}
const loadedRuntime = runtimeStore.load();
if (loadedRuntime) {
  try {
    rooms.restoreSnapshots(loadedRuntime.rooms);
    sessions.restoreSnapshots(loadedRuntime.sessions);
    obs.log('runtime_restored', {
      rooms: loadedRuntime.rooms.length,
      sessions: loadedRuntime.sessions.length,
      savedAt: loadedRuntime.savedAt,
    });
  } catch (err) {
    obs.log('runtime_restore_failed', { error: err instanceof Error ? err.message : String(err) });
  }
}

if (IS_PRODUCTION) {
  const requiredEnv = ['LNBITS_URL', 'LNBITS_ADMIN_KEY', 'LNBITS_INVOICE_KEY', 'ROUTE_ADMIN_SECRET', 'REVENUE_SPLIT_PERCENT'];
  const missing = requiredEnv.filter((key) => !process.env[key] || String(process.env[key]).trim().length === 0);
  if (missing.length > 0) {
    console.error(`[startup] Missing required production env vars: ${missing.join(', ')}`);
    process.exit(1);
  }
}

// --- REST API ---

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    uptimeSec: Math.floor(process.uptime()),
    env: NODE_ENV,
    timestamp: new Date().toISOString(),
    observability: obs.snapshot(),
  });
});

app.post('/api/sessions', async (req, res) => {
  try {
    const { wagerAmount, playerNames } = req.body;
    const idempotencyKey = String(req.header('x-idempotency-key') || '').trim() || undefined;

    if (!wagerAmount || !playerNames || playerNames.length !== 2) {
      res.status(400).json({ error: 'Invalid request' });
      return;
    }

    const session = sessions.getOrCreate(wagerAmount, playerNames, idempotencyKey);

    try {
      const invoices = await escrow.createDeposits(session.id);
      persistRuntimeState();
      obs.increment('sessions.created');
      res.json({ sessionId: session.id, invoices });
    } catch (err) {
      // LNBits might not be configured; return session anyway
      obs.increment('payments.fallback.invoice_create_failed');
      obs.log('lnbits_invoice_failed', { error: err instanceof Error ? err.message : String(err) });
      persistRuntimeState();
      res.json({
        sessionId: session.id,
        invoices: {
          player1: { bolt11: 'lnbits_not_configured', paymentHash: 'n/a' },
          player2: { bolt11: 'lnbits_not_configured', paymentHash: 'n/a' },
        },
      });
    }
  } catch (err) {
    console.error('Session creation error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/sessions/:id', (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  res.json({ session });
});

app.post('/api/sessions/:id/result', async (req, res) => {
  try {
    const { winnerId } = req.body;
    const resultIdempotencyKey = String(req.header('x-idempotency-key') || '').trim() || `session:${req.params.id}`;
    const session = sessions.get(req.params.id);

    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    const idempotentSessionId = sessions.recordResultIdempotency(session.id, resultIdempotencyKey);
    if (idempotentSessionId && idempotentSessionId !== session.id) {
      res.status(409).json({ error: 'Idempotency key already used for different session' });
      return;
    }
    if (session.status === 'payout_complete' && session.winner === winnerId) {
      res.json({
        lnurl: session.payoutLnurl ?? null,
        amount: session.payoutAmount ?? session.wagerAmount * 2 * (1 - 0.05),
      });
      return;
    }

    try {
      const payout = await escrow.processWinnerPayout(session.id, winnerId);
      persistRuntimeState();
      obs.increment('payments.payout.success');
      res.json(payout);
    } catch {
      sessions.setWinner(session.id, winnerId);
      sessions.setStatus(session.id, 'finished');
      persistRuntimeState();
      obs.increment('payments.payout.fallback');
      res.json({
        lnurl: null,
        amount: session.wagerAmount * 2 * (1 - 0.05),
      });
    }
  } catch (err) {
    console.error('Result processing error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/rooms', (req, res) => {
  try {
    const hostName = String(req.body?.hostName || 'Host');
    const settings = req.body?.settings ?? {};
    const spectatorHost = !!req.body?.spectatorHost;
    const created = rooms.create({
      hostName,
      settings: {
        laps: settings.laps ?? 3,
        aiCount: settings.aiCount ?? 3,
        maxHumans: MAX_PLAYERS,
        chainClasses: Array.isArray(settings.chainClasses)
          ? settings.chainClasses.slice(0, MAX_PLAYERS)
          : Array.from({ length: MAX_PLAYERS }, () => 'balanced'),
        routeId: typeof settings.routeId === 'string' ? settings.routeId : 'default',
        mode: settings.mode === 'derby' ? 'derby' : settings.mode === 'capture_sats' ? 'capture_sats' : 'classic',
        wager: settings.wager,
      },
      spectatorHost,
    });
    persistRuntimeState();
    obs.increment('rooms.created');
    res.json(created);
  } catch (err) {
    console.error('Room create error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/rooms/join', (req, res) => {
  try {
    const body = req.body as JoinRoomRequest;
    if (!body?.code || !body?.name) {
      res.status(400).json({ error: 'Missing code or name' });
      return;
    }
    const joined = rooms.joinByCode(body.code, body.name);
    persistRuntimeState();
    obs.increment('rooms.joined');
    res.json(joined);
  } catch (err: any) {
    res.status(400).json({ error: err?.message ?? 'Join failed' });
  }
});

app.get('/api/rooms/:roomId', (req, res) => {
  const room = rooms.get(req.params.roomId);
  if (!room) {
    res.status(404).json({ error: 'Room not found' });
    return;
  }
  res.json({ room });
});

app.post('/api/rooms/:roomId/deposits/create', async (req, res) => {
  const room = rooms.getState(req.params.roomId);
  if (!room) {
    res.status(404).json({ error: 'Room not found' });
    return;
  }
  const memberId = String(req.body?.memberId || '');
  const memberToken = String(req.body?.memberToken || '');
  if (!rooms.validateMember(req.params.roomId, memberId, memberToken)) {
    res.status(401).json({ error: 'Unauthorized room member' });
    return;
  }
  const wager = room.settings.wager;
  if (!wager?.enabled || wager.amountSat <= 0 || wager.practiceOnly) {
    res.status(400).json({ error: 'Wagering not enabled for this room' });
    return;
  }
  let byMember = roomDeposits.get(room.roomId);
  if (!byMember) {
    byMember = new Map();
    roomDeposits.set(room.roomId, byMember);
  }
  const existing = byMember.get(memberId);
  if (existing) {
    res.json({ invoice: existing });
    return;
  }
  try {
    const invoice = await lnbits.createInvoice(
      wager.amountSat,
      `CHAINDUEL3D room deposit ${room.roomId.slice(0, 8)}`
    );
    const payload = {
      paymentHash: invoice.paymentHash,
      bolt11: invoice.bolt11,
      amountSat: wager.amountSat,
      paid: false,
    };
    byMember.set(memberId, payload);
    persistRuntimeState();
    res.json({ invoice: payload });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'Failed to create deposit invoice' });
  }
});

app.get('/api/rooms/:roomId/deposits/status', async (req, res) => {
  const room = rooms.getState(req.params.roomId);
  if (!room) {
    res.status(404).json({ error: 'Room not found' });
    return;
  }
  const memberId = String(req.query.memberId || '');
  const memberToken = String(req.query.memberToken || '');
  if (!rooms.validateMember(req.params.roomId, memberId, memberToken)) {
    res.status(401).json({ error: 'Unauthorized room member' });
    return;
  }
  const byMember = roomDeposits.get(room.roomId) ?? new Map();
  for (const [mId, dep] of byMember.entries()) {
    if (dep.paid) continue;
    try {
      const paid = await lnbits.checkPayment(dep.paymentHash);
      if (paid) dep.paid = true;
      byMember.set(mId, dep);
    } catch {
      // best-effort payment status polling
    }
  }
  roomDeposits.set(room.roomId, byMember);
  const status = Array.from(byMember.entries()).map(([mId, dep]) => ({
    memberId: mId,
    amountSat: dep.amountSat,
    paid: dep.paid,
  }));
  res.json({ deposits: status });
});

app.post('/api/rooms/:roomId/settings', (req, res) => {
  try {
    const body = req.body as StartRoomRequest & { settings?: { laps?: number; aiCount?: number; chainClasses?: ChainClass[]; routeId?: string; mode?: GameMode; wager?: unknown } };
    const room = rooms.patchSettings(
      req.params.roomId,
      body.memberId,
      body.memberToken,
      (body.settings ?? {}) as any,
    );
    broadcastRoomState(room.roomId);
    persistRuntimeState();
    res.json({ room });
  } catch (err: any) {
    res.status(400).json({ error: err?.message ?? 'Patch settings failed' });
  }
});

app.post('/api/rooms/:roomId/start', (req, res) => {
  try {
    const body = req.body as StartRoomRequest;
    if (!isValidRouteLayoutInput(body.routeLayout)) {
      res.status(400).json({ error: 'Invalid route layout payload' });
      return;
    }
    const roomState = rooms.get(req.params.roomId);
    if (roomState?.settings.wager?.enabled && roomState.settings.wager.amountSat > 0 && !roomState.settings.wager.practiceOnly) {
      const byMember = roomDeposits.get(req.params.roomId) ?? new Map();
      const requiredMemberIds = roomState.members.filter(m => m.slotIndex >= 0).map(m => m.memberId);
      const missing = requiredMemberIds.filter(mId => !byMember.get(mId)?.paid);
      if (missing.length > 0) {
        res.status(400).json({ error: 'All active players must complete deposits before race start' });
        return;
      }
    }
    const selectedRouteId = body.routeId ?? roomState?.settings.routeId ?? 'default';
    let resolvedLayout: RouteCustomLayout | null = body.routeLayout ?? null;
    if (selectedRouteId) {
      const selected = routes.get(selectedRouteId);
      if (!selected) {
        res.status(400).json({ error: 'Route not found' });
        return;
      }
      resolvedLayout = selected.layout;
    }
    const room = rooms.startRace(
      req.params.roomId,
      body.memberId,
      body.memberToken,
      resolvedLayout,
      selectedRouteId,
    );
    broadcastRoomState(room.roomId);
    persistRuntimeState();
    res.json({ room });
  } catch (err: any) {
    res.status(400).json({ error: err?.message ?? 'Start failed' });
  }
});

app.post('/api/rooms/:roomId/kick', (req, res) => {
  try {
    const body = req.body as KickRoomMemberRequest;
    if (!body?.targetMemberId) {
      res.status(400).json({ error: 'Missing target member' });
      return;
    }
    const room = rooms.kickMember(
      req.params.roomId,
      body.memberId,
      body.memberToken,
      body.targetMemberId,
    );
    evictRoomMemberConnections(room.roomId, body.targetMemberId, 'You were removed by the host');
    broadcastRoomState(room.roomId);
    persistRuntimeState();
    res.json({ room });
  } catch (err: any) {
    res.status(400).json({ error: err?.message ?? 'Kick failed' });
  }
});

app.post('/api/rooms/:roomId/ready', (req, res) => {
  try {
    const body = req.body as SetReadyRequest;
    const room = rooms.setReady(
      req.params.roomId,
      body.memberId,
      body.memberToken,
      !!body.ready,
    );
    broadcastRoomState(room.roomId);
    persistRuntimeState();
    res.json({ room });
  } catch (err: any) {
    res.status(400).json({ error: err?.message ?? 'Ready update failed' });
  }
});

app.post('/api/rooms/:roomId/name', (req, res) => {
  try {
    const body = req.body as SetRoomNameRequest;
    const room = rooms.setMemberName(
      req.params.roomId,
      body.memberId,
      body.memberToken,
      body.name,
    );
    broadcastRoomState(room.roomId);
    persistRuntimeState();
    res.json({ room });
  } catch (err: any) {
    res.status(400).json({ error: err?.message ?? 'Name update failed' });
  }
});

app.post('/api/rooms/:roomId/rematch', (req, res) => {
  try {
    const body = req.body as StartRoomRequest;
    const room = rooms.rematch(
      req.params.roomId,
      body.memberId,
      body.memberToken,
    );
    broadcastRoomState(room.roomId);
    persistRuntimeState();
    res.json({ room });
  } catch (err: any) {
    res.status(400).json({ error: err?.message ?? 'Rematch failed' });
  }
});

app.get('/api/rooms/:roomId/settlement', (req, res) => {
  const room = rooms.getState(req.params.roomId);
  if (!room) {
    res.status(404).json({ error: 'Room not found' });
    return;
  }
  const memberId = String(req.query.memberId || '');
  const memberToken = String(req.query.memberToken || '');
  if (!rooms.validateMember(req.params.roomId, memberId, memberToken)) {
    res.status(401).json({ error: 'Unauthorized room member' });
    return;
  }
  const summary = settlements.ensureSettlement(room);
  if (summary) {
    rooms.setRaceSettlement(room.roomId, summary);
    persistRuntimeState();
  }
  res.json({ settlement: summary });
});

app.post('/api/rooms/:roomId/settlement/claim', claimRateLimiter, (req, res) => {
  const roomId = String(req.params.roomId || '');
  const memberId = String(req.body?.memberId || '');
  const memberToken = String(req.body?.memberToken || '');
  if (!rooms.validateMember(roomId, memberId, memberToken)) {
    res.status(401).json({ error: 'Unauthorized room member' });
    return;
  }
  const room = rooms.getState(roomId);
  if (!room) {
    res.status(404).json({ error: 'Room not found' });
    return;
  }
  const summary = settlements.ensureSettlement(room);
  if (!summary) {
    res.status(400).json({ error: 'Settlement not ready' });
    return;
  }
  const claim = settlements.issueClaimTicket(roomId, memberId);
  if (!claim) {
    res.status(400).json({ error: 'No claimable winnings for this member' });
    return;
  }
  rooms.setRaceSettlement(room.roomId, summary);
  persistRuntimeState();
  res.json(claim);
});

app.post('/api/rooms/:roomId/settlement/withdraw', claimRateLimiter, async (req, res) => {
  const roomId = String(req.params.roomId || '');
  const memberId = String(req.body?.memberId || '');
  const memberToken = String(req.body?.memberToken || '');
  const claimToken = String(req.body?.claimToken || '');
  if (!rooms.validateMember(roomId, memberId, memberToken)) {
    res.status(401).json({ error: 'Unauthorized room member' });
    return;
  }
  if (!claimToken) {
    res.status(400).json({ error: 'Missing claim token' });
    return;
  }
  try {
    const payout = await settlements.redeemClaimTicket(claimToken, memberId);
    persistRuntimeState();
    res.json(payout);
  } catch (err: any) {
    res.status(400).json({ error: err?.message ?? 'Withdraw failed' });
  }
});

app.get('/api/routes', (_req, res) => {
  res.json({ routes: routes.list() });
});

app.get('/api/routes/:routeId', (req, res) => {
  const route = routes.get(req.params.routeId);
  if (!route) {
    res.status(404).json({ error: 'Route not found' });
    return;
  }
  res.json({ route });
});

app.post('/api/admin/auth/login', adminRateLimiter, (req, res) => {
  if (!ROUTE_ADMIN_SECRET) {
    res.status(503).json({ error: 'Admin auth disabled' });
    return;
  }
  const submitted = String(req.body?.secret || '').trim();
  if (!submitted || submitted !== ROUTE_ADMIN_SECRET.trim()) {
    obs.increment('admin.auth.failed');
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const now = Date.now();
  const expiresAt = now + ADMIN_TOKEN_TTL_MS;
  const payload = `${ADMIN_TOKEN_ISSUER}.${expiresAt}`;
  const signature = crypto
    .createHmac('sha256', ROUTE_ADMIN_SECRET.trim())
    .update(payload)
    .digest('hex');
  obs.increment('admin.auth.success');
  res.json({
    token: `${payload}.${signature}`,
    expiresAt,
    tokenType: 'Bearer',
  });
});

app.use('/api/admin/routes', adminRateLimiter);

app.post('/api/admin/routes', (req, res) => {
  if (!isAdminAuthorized(req)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const name = String(req.body?.name || '').trim();
  const layout = (req.body?.layout ?? null) as RouteCustomLayout | null;
  if (!isValidRouteLayoutInput(layout)) {
    res.status(400).json({ error: 'Invalid route layout payload' });
    return;
  }
  const id = typeof req.body?.id === 'string' ? req.body.id : undefined;
  if (!name) {
    res.status(400).json({ error: 'Missing track name' });
    return;
  }
  const route = id ? routes.upsert({ id, name, layout }) : routes.create(name, layout);
  persistRuntimeState();
  res.json({ route });
});

app.put('/api/admin/routes/:routeId', (req, res) => {
  if (!isAdminAuthorized(req)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const existing = routes.get(req.params.routeId);
  if (!existing) {
    res.status(404).json({ error: 'Route not found' });
    return;
  }
  const name = String(req.body?.name || existing.name).trim();
  const layout = (req.body?.layout ?? existing.layout ?? null) as RouteCustomLayout | null;
  if (!isValidRouteLayoutInput(layout)) {
    res.status(400).json({ error: 'Invalid route layout payload' });
    return;
  }
  const route = routes.upsert({ id: req.params.routeId, name, layout });
  persistRuntimeState();
  res.json({ route });
});

app.delete('/api/admin/routes/:routeId', (req, res) => {
  if (!isAdminAuthorized(req)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  if (!routes.remove(req.params.routeId)) {
    res.status(400).json({ error: 'Cannot delete route' });
    return;
  }
  persistRuntimeState();
  res.json({ ok: true });
});

// --- WebSocket for real-time updates ---

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const raceAuthority = new RaceAuthority(rooms, (roomId, race) => {
  if (race.tick % 5 === 0 || rooms.getState(roomId)?.phase === 'finished') {
    broadcastRoomState(roomId);
  }
  const snapshot = rooms.getAuthoritativeSnapshot(roomId);
  if (snapshot) {
    broadcastToRoom(roomId, {
      type: 'race_snapshot',
      roomId,
      snapshot,
    });
  }
  const roomState = rooms.getState(roomId);
  if (roomState?.phase === 'finished') {
    const summary = settlements.ensureSettlement(roomState);
    if (summary) {
      rooms.setRaceSettlement(roomId, summary);
    }
  }
  persistRuntimeState(1200);
}, ({ activeRooms, loopDurationMs }) => {
  obs.timing('race.tick_loop_ms', loopDurationMs);
  if (activeRooms > 0) {
    obs.increment('race.tick.active_rooms_total', activeRooms);
  }
  if (loopDurationMs > 20) {
    obs.increment('race.tick.slow_loops');
  }
});
raceAuthority.start();

const wsRoom = new Map<WebSocket, { roomId: string; memberId: string; memberToken: string }>();
const wsPingSentAt = new Map<WebSocket, number>();
const wsMsgBucket = new Map<WebSocket, { startedAt: number; count: number }>();
const raceInputAtByMember = new Map<string, number>();
const roomDeposits = new Map<string, Map<string, { paymentHash: string; bolt11: string; amountSat: number; paid: boolean }>>();

wss.on('connection', (ws: WebSocket) => {
  wsMsgBucket.set(ws, { startedAt: Date.now(), count: 0 });
  obs.increment('ws.connection.open');
  ws.on('message', (data: Buffer) => {
    try {
      if (data.length > 24_000) {
        obs.increment('ws.message.rejected_too_large');
        send(ws, { type: 'error', message: 'Payload too large' });
        return;
      }
      const bucket = wsMsgBucket.get(ws);
      if (bucket) {
        const now = Date.now();
        if (now - bucket.startedAt >= 1000) {
          bucket.startedAt = now;
          bucket.count = 0;
        }
        bucket.count += 1;
        if (bucket.count > 80) {
          obs.increment('ws.message.rate_limited');
          send(ws, { type: 'error', message: 'Rate limit exceeded' });
          return;
        }
      }
      const msg = JSON.parse(data.toString()) as RoomClientMessage;
      if (msg.type === 'subscribe' && msg.sessionId) {
        (ws as any).sessionId = msg.sessionId;
        return;
      }

      if (msg.type === 'room_subscribe') {
        if (!isSafeId(msg.roomId) || !isSafeId(msg.memberId) || !isSafeId(msg.memberToken)) {
          send(ws, { type: 'error', message: 'Invalid room subscription payload' });
          return;
        }
        if (!rooms.validateMember(msg.roomId, msg.memberId, msg.memberToken)) {
          send(ws, { type: 'error', message: 'Unauthorized room member' });
          return;
        }
        // single active connection per member for clean reconnect semantics
        evictRoomMemberConnections(msg.roomId, msg.memberId, 'Reconnected from another client');
        wsRoom.set(ws, {
          roomId: msg.roomId,
          memberId: msg.memberId,
          memberToken: msg.memberToken,
        });
        rooms.markConnected(msg.roomId, msg.memberId);
        broadcastRoomState(msg.roomId);
        return;
      }

      if (msg.type === 'room_chat_send') {
        if (typeof msg.text !== 'string' || msg.text.trim().length === 0 || msg.text.length > 220) {
          send(ws, { type: 'error', message: 'Invalid chat payload' });
          return;
        }
        const chat = rooms.addChat(msg.roomId, msg.memberId, msg.memberToken, msg.text);
        broadcastToRoom(msg.roomId, { type: 'chat_message', roomId: msg.roomId, message: chat });
        persistRuntimeState();
        return;
      }

      if (msg.type === 'room_leave') {
        const room = rooms.leave(msg.roomId, msg.memberId, msg.memberToken);
        wsRoom.delete(ws);
        wsPingSentAt.delete(ws);
        wsMsgBucket.delete(ws);
        if (room) broadcastRoomState(room.roomId);
        persistRuntimeState();
        return;
      }

      if (msg.type === 'room_pong') {
        const sub = wsRoom.get(ws);
        if (!sub) return;
        const sentAt = wsPingSentAt.get(ws);
        if (!sentAt) return;
        wsPingSentAt.delete(ws);
        const pingMs = Date.now() - sentAt;
        const room = rooms.setMemberPing(sub.roomId, sub.memberId, pingMs);
        if (room) {
          broadcastToRoom(room.roomId, {
            type: 'room_member_ping',
            roomId: room.roomId,
            memberId: sub.memberId,
            pingMs,
          });
        }
        return;
      }

      if (msg.type === 'race_input') {
        if (!isValidRaceInputPayload(msg.input)) {
          obs.increment('ws.race_input.invalid_payload');
          send(ws, { type: 'error', message: 'Invalid race input payload' });
          return;
        }
        const memberKey = `${msg.roomId}:${msg.memberId}`;
        const now = Date.now();
        const lastAt = raceInputAtByMember.get(memberKey) ?? 0;
        if (now - lastAt < 14) {
          obs.increment('ws.race_input.rate_limited');
          return;
        }
        raceInputAtByMember.set(memberKey, now);
        rooms.setRaceInput(msg.roomId, msg.memberId, msg.memberToken, msg.input);
        return;
      }
    } catch { /* ignore malformed messages */ }
  });

  ws.on('close', () => {
    const sub = wsRoom.get(ws);
    wsPingSentAt.delete(ws);
    wsMsgBucket.delete(ws);
    if (!sub) return;
    rooms.markDisconnected(sub.roomId, sub.memberId);
    wsRoom.delete(ws);
    persistRuntimeState();
    broadcastRoomState(sub.roomId);
  });
});

// Broadcast session updates
const sessionBroadcastInterval = setInterval(() => {
  wss.clients.forEach((client) => {
    if (client.readyState !== WebSocket.OPEN) return;
    const sessionId = (client as any).sessionId;
    if (!sessionId) return;

    const session = sessions.get(sessionId);
    if (session) {
      client.send(JSON.stringify({ type: 'session_update', session }));
    }
  });
}, 2000);

const lobbyDisconnectCleanupInterval = setInterval(() => {
  const changedRoomIds = rooms.pruneDisconnectedLobbyMembers(rooms.disconnectGraceMs);
  for (const roomId of changedRoomIds) {
    broadcastRoomState(roomId);
  }
  if (changedRoomIds.length > 0) {
    obs.increment('rooms.pruned_disconnected', changedRoomIds.length);
    persistRuntimeState();
  }
}, 5000);

const pingProbeInterval = setInterval(() => {
  const now = Date.now();
  wss.clients.forEach(client => {
    if (client.readyState !== WebSocket.OPEN) return;
    const sub = wsRoom.get(client);
    if (!sub) return;
    wsPingSentAt.set(client, now);
    send(client, { type: 'room_ping', sentAt: now });
  });
}, 3000);

function send(ws: WebSocket, payload: RoomServerMessage) {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(payload));
}

function broadcastToRoom(roomId: string, payload: RoomServerMessage) {
  wss.clients.forEach(client => {
    const sub = wsRoom.get(client);
    if (!sub || sub.roomId !== roomId) return;
    send(client, payload);
  });
}

function broadcastRoomState(roomId: string) {
  const room = rooms.getState(roomId);
  if (!room) return;
  broadcastToRoom(roomId, { type: 'room_state', room });
}

function evictRoomMemberConnections(roomId: string, memberId: string, message: string) {
  wss.clients.forEach(client => {
    const sub = wsRoom.get(client);
    if (!sub) return;
    if (sub.roomId !== roomId || sub.memberId !== memberId) return;
    send(client, { type: 'error', message });
    wsRoom.delete(client);
    wsPingSentAt.delete(client);
    try {
      client.close(4001, 'kicked');
    } catch {
      // ignore close errors
    }
  });
}

function isAdminAuthorized(req: express.Request): boolean {
  if (!ROUTE_ADMIN_SECRET) return false;
  const authHeader = String(req.header('authorization') || '').trim();
  const bearerSecret = authHeader.toLowerCase().startsWith('bearer ')
    ? authHeader.slice(7).trim()
    : '';
  if (!bearerSecret) return false;
  return verifyAdminToken(bearerSecret);
}

function isValidRouteLayoutInput(layout: unknown): boolean {
  if (layout == null) return true;
  if (typeof layout !== 'object') return false;
  const v = layout as Record<string, unknown>;
  if (!Array.isArray(v.main)) return false;
  const layoutType = v.layoutType === 'arena' ? 'arena' : 'loop';
  if (layoutType === 'loop' && v.main.length < 4) return false;
  if (layoutType === 'arena') {
    const rx = Number(v.arenaRadiusX ?? 84);
    const rz = Number(v.arenaRadiusZ ?? 74);
    if (!Number.isFinite(rx) || !Number.isFinite(rz) || rx < 24 || rz < 24) return false;
  }
  return true;
}

server.listen(PORT, () => {
  console.log(`CHAINDUEL3D server running on port ${PORT}`);
  console.log(`LNBits URL: ${process.env.LNBITS_URL || 'not configured'}`);
  obs.log('server_started', { port: PORT, env: NODE_ENV });
});

function persistRuntimeState(delayMs = 300) {
  runtimeStore.scheduleSave({
    rooms: rooms.listSnapshots(),
    sessions: sessions.listSnapshots(),
  }, delayMs);
}

function verifyAdminToken(token: string): boolean {
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [issuer, expRaw, signature] = parts;
  if (issuer !== ADMIN_TOKEN_ISSUER) return false;
  const expiresAt = Number(expRaw);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return false;
  const payload = `${issuer}.${expiresAt}`;
  const expected = crypto
    .createHmac('sha256', ROUTE_ADMIN_SECRET.trim())
    .update(payload)
    .digest('hex');
  return signature === expected;
}

function isSafeId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128 && /^[a-zA-Z0-9:_-]+$/.test(value);
}

function isValidRaceInputPayload(input: unknown): boolean {
  if (!input || typeof input !== 'object') return false;
  const v = input as Record<string, unknown>;
  const keys = ['forward', 'backward', 'left', 'right', 'useItem', 'lookBack', 'drift', 'sacrificeBoost'];
  return keys.every((key) => typeof v[key] === 'boolean');
}

function shutdown(signal: string) {
  console.log(`[shutdown] Received ${signal}, draining server...`);
  clearInterval(sessionBroadcastInterval);
  clearInterval(lobbyDisconnectCleanupInterval);
  clearInterval(pingProbeInterval);
  raceAuthority.stop();
  runtimeStore.flush();
  wss.clients.forEach((client) => {
    try {
      client.close(1001, 'Server shutting down');
    } catch {
      // ignore close errors
    }
  });
  wss.close(() => {
    server.close((err) => {
      if (err) {
        console.error('[shutdown] HTTP close failed:', err);
        process.exit(1);
      }
      console.log('[shutdown] Complete');
      process.exit(0);
    });
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

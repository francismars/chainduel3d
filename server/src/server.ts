import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import dotenv from 'dotenv';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { SessionManager } from './session.js';
import { LNBitsClient } from './lnbits.js';
import { EscrowManager } from './escrow.js';
import { RoomManager } from './room.js';
import { RaceAuthority } from './race-authority.js';
import { RouteCatalog } from './routes.js';
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
} from '../../shared/types';

type JoinRoomRequest = { code: string; name: string };

dotenv.config();

const PORT = parseInt(process.env.PORT || '3000');
const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_PRODUCTION = NODE_ENV === 'production';

const app = express();
app.use(helmet());
app.use(express.json({ limit: '100kb' }));
app.disable('x-powered-by');
app.set('trust proxy', 1);

const adminRateLimiter = rateLimit({
  windowMs: 60_000,
  max: IS_PRODUCTION ? 60 : 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many admin requests, please retry later.' },
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
const routes = new RouteCatalog();
const ROUTE_ADMIN_SECRET = process.env.ROUTE_ADMIN_SECRET || '';
if (!ROUTE_ADMIN_SECRET) {
  console.warn('[admin] ROUTE_ADMIN_SECRET is not set; admin route endpoints are disabled.');
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
  });
});

app.post('/api/sessions', async (req, res) => {
  try {
    const { wagerAmount, playerNames } = req.body;

    if (!wagerAmount || !playerNames || playerNames.length !== 2) {
      res.status(400).json({ error: 'Invalid request' });
      return;
    }

    const session = sessions.create(wagerAmount, playerNames);

    try {
      const invoices = await escrow.createDeposits(session.id);
      res.json({ sessionId: session.id, invoices });
    } catch (err) {
      // LNBits might not be configured; return session anyway
      console.error('LNBits error:', err);
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
    const session = sessions.get(req.params.id);

    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    try {
      const payout = await escrow.processWinnerPayout(session.id, winnerId);
      res.json(payout);
    } catch {
      sessions.setWinner(session.id, winnerId);
      sessions.setStatus(session.id, 'finished');
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
        maxHumans: 4,
        chainClasses: Array.isArray(settings.chainClasses) ? settings.chainClasses.slice(0, 4) : ['balanced', 'balanced', 'balanced', 'balanced'],
        routeId: typeof settings.routeId === 'string' ? settings.routeId : 'default',
        mode: settings.mode === 'derby' ? 'derby' : 'classic',
      },
      spectatorHost,
    });
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

app.post('/api/rooms/:roomId/settings', (req, res) => {
  try {
    const body = req.body as StartRoomRequest & { settings?: { laps?: number; aiCount?: number; chainClasses?: ChainClass[]; routeId?: string; mode?: GameMode } };
    const room = rooms.patchSettings(
      req.params.roomId,
      body.memberId,
      body.memberToken,
      body.settings ?? {},
    );
    broadcastRoomState(room.roomId);
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
    res.json({ room });
  } catch (err: any) {
    res.status(400).json({ error: err?.message ?? 'Rematch failed' });
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
  res.json({ ok: true });
});

// --- WebSocket for real-time updates ---

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const raceAuthority = new RaceAuthority(rooms, (roomId, race) => {
  broadcastRoomState(roomId);
  const snapshot = rooms.getAuthoritativeSnapshot(roomId);
  if (snapshot) {
    broadcastToRoom(roomId, {
      type: 'race_snapshot',
      roomId,
      snapshot,
    });
  }
});
raceAuthority.start();

const wsRoom = new Map<WebSocket, { roomId: string; memberId: string; memberToken: string }>();
const wsPingSentAt = new Map<WebSocket, number>();

wss.on('connection', (ws: WebSocket) => {
  ws.on('message', (data: Buffer) => {
    try {
      const msg = JSON.parse(data.toString()) as RoomClientMessage;
      if (msg.type === 'subscribe' && msg.sessionId) {
        (ws as any).sessionId = msg.sessionId;
        return;
      }

      if (msg.type === 'room_subscribe') {
        if (!rooms.validateMember(msg.roomId, msg.memberId, msg.memberToken)) {
          send(ws, { type: 'error', message: 'Unauthorized room member' });
          return;
        }
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
        const chat = rooms.addChat(msg.roomId, msg.memberId, msg.memberToken, msg.text);
        broadcastToRoom(msg.roomId, { type: 'chat_message', roomId: msg.roomId, message: chat });
        return;
      }

      if (msg.type === 'room_leave') {
        const room = rooms.leave(msg.roomId, msg.memberId, msg.memberToken);
        wsRoom.delete(ws);
        wsPingSentAt.delete(ws);
        if (room) broadcastRoomState(room.roomId);
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
        rooms.setRaceInput(msg.roomId, msg.memberId, msg.memberToken, msg.input);
        return;
      }
    } catch { /* ignore malformed messages */ }
  });

  ws.on('close', () => {
    const sub = wsRoom.get(ws);
    wsPingSentAt.delete(ws);
    if (!sub) return;
    rooms.markDisconnected(sub.roomId, sub.memberId);
    wsRoom.delete(ws);
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
  const headerSecret = String(req.header('x-admin-secret') || '').trim();
  const authHeader = String(req.header('authorization') || '').trim();
  const bearerSecret = authHeader.toLowerCase().startsWith('bearer ')
    ? authHeader.slice(7).trim()
    : '';
  const provided = headerSecret || bearerSecret;
  return provided.length > 0 && provided === ROUTE_ADMIN_SECRET.trim();
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
});

function shutdown(signal: string) {
  console.log(`[shutdown] Received ${signal}, draining server...`);
  clearInterval(sessionBroadcastInterval);
  clearInterval(lobbyDisconnectCleanupInterval);
  clearInterval(pingProbeInterval);
  raceAuthority.stop();
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

# CHAINDUEL3D

Browser-based 3D racing with Bitcoin-themed visuals, optional Lightning wagers, online rooms, and route authoring tools.

## Feature Overview

- Local play with up to 4 riders (human + AI), chain class selection, laps, route, and mode (`classic` or `derby`)
- Practice mode (no sats required)
- Online rooms: create/join by code, ready checks, host controls, chat, rematch flow
- Optional Lightning wager flow backed by LNBits invoices/payouts
- Public route catalog plus admin route CRUD APIs
- Real-time room/race synchronization over WebSocket (`/ws`)

## Architecture At A Glance

- `client`: Vite + TypeScript SPA (Three.js + cannon-es), state-driven screens (no URL router)
- `server`: Express REST API + `ws` realtime gateway
- `shared`: shared TypeScript types between client/server
- Payments: LNBits integration (with safe fallback behavior when unavailable)

## Local Development

### Quick start (full stack)

```bash
npm install
npm run dev
```

This runs:
- client dev server on `http://localhost:5173`
- backend on `http://localhost:3000`

### Workspace commands

```bash
# root
npm run build

# client
npm run dev --workspace=client
npm run build --workspace=client
npm run preview --workspace=client

# server
npm run dev --workspace=server
npm run build --workspace=server
npm run start --workspace=server
```

## Environment Configuration

### Server (`server/.env`)

Create `server/.env` from the example:

```bash
cp server/.env.example server/.env
```

On Windows PowerShell:

```powershell
Copy-Item server/.env.example server/.env
```

Variables:
- `NODE_ENV` (`development` or `production`)
- `PORT` (server port, default `3000`)
- `ROUTE_ADMIN_SECRET` (required for `/api/admin/routes/*`)
- `RUNTIME_STATE_FILE` (optional path for persisted room/session runtime snapshot)
- `ADMIN_TOKEN_TTL_MS` (optional TTL for admin bearer tokens, default 15m)
- `ROOM_MEMBER_TOKEN_TTL_MS` (optional TTL for room member tokens, default 24h)
- `LNBITS_URL`
- `LNBITS_ADMIN_KEY`
- `LNBITS_INVOICE_KEY`
- `REVENUE_SPLIT_PERCENT`

Production startup enforces required env vars and exits if missing.

### Client dev proxy (optional)

- `VITE_BACKEND_PORT` can override backend port for Vite proxying `/api` and `/ws` (default `3000`).

## Gameplay And Online Flow

- App modes include local, online entry, online room, admin, payment, racing, and results.
- Invite links support `?room=<CODE>` to prefill online join.
- If Lightning session creation fails, gameplay still continues with fallback behavior.

## API And Realtime Overview

### REST endpoints

- `GET /health`
- Sessions:
  - `POST /api/sessions`
  - `GET /api/sessions/:id`
  - `POST /api/sessions/:id/result`
  - Both session create/result endpoints accept `x-idempotency-key` for retry-safe clients.
- Rooms:
  - `POST /api/rooms`
  - `POST /api/rooms/join`
  - `GET /api/rooms/:roomId`
  - `POST /api/rooms/:roomId/settings`
  - `POST /api/rooms/:roomId/start`
  - `POST /api/rooms/:roomId/kick`
  - `POST /api/rooms/:roomId/ready`
  - `POST /api/rooms/:roomId/rematch`
- Routes:
  - `GET /api/routes`
  - `GET /api/routes/:routeId`
- Admin routes (requires bearer token from `POST /api/admin/auth/login`):
  - `POST /api/admin/auth/login`
  - `POST /api/admin/routes`
  - `PUT /api/admin/routes/:routeId`
  - `DELETE /api/admin/routes/:routeId`

### Backward Compatibility Notes

- **Admin auth migration complete:** admin route APIs now accept bearer tokens only. Legacy `x-admin-secret` header auth has been removed.
- **Session idempotency compatibility:** `x-idempotency-key` is optional on `POST /api/sessions` and `POST /api/sessions/:id/result`; old clients without this header remain supported.
- **Runtime persistence compatibility:** server now persists room/session runtime data to `server/data/runtime/state.json` by default. If the path is unwritable or missing, behavior falls back to in-process runtime state for that process lifetime.
- **Room token TTL:** room member tokens now expire (configurable). Long-running clients should reconnect or refresh credentials on unauthorized responses.

### WebSocket (`/ws`)

Client messages include:
- `subscribe` (session updates)
- `room_subscribe`
- `room_chat_send`
- `room_leave`
- `race_input`

Server messages include:
- `session_update`
- `room_state`
- `chat_message`
- `race_snapshot`
- `error`

## Controls

| Action      | Player 1 | Player 2     |
|-------------|----------|--------------|
| Accelerate  | W        | Arrow Up     |
| Brake       | S        | Arrow Down   |
| Steer Left  | A        | Arrow Left   |
| Steer Right | D        | Arrow Right  |
| Use Item    | Space    | Enter        |
| Look Back   | Q        | Right Shift  |

## Items

- `Double Spend`: speed boost
- `Fork Bomb`: drops an obstacle on route
- `Lightning Bolt`: slows opponent

## Testing

```bash
# game/physics and integration parity checks
npm run test:parity --workspace=server

# payment + websocket contract checks
npm run test:payments --workspace=server
npm run test:ws --workspace=server

# authority loop load benchmark
npm run test:load --workspace=server

# API smoke checks against a running deployment
SMOKE_BASE_URL=https://your-host SMOKE_ADMIN_SECRET=your_secret npm run test:smoke --workspace=server
```

## Deployment

Production deployment is single-VM with Docker Compose + Nginx + GHCR images.

- CI workflow builds workspace and runs parity tests
- deploy workflow builds/pushes client/server images tagged by commit SHA
- staging deploy happens first
- production deploy promotes the same image SHA after approval

Use the full runbook for setup, TLS bootstrap, staging verification, monitoring, and rollback:
- `docs/production-runbook.md`

## Operational Notes

- Runtime room/session snapshots are persisted at `server/data/runtime/state.json` by default.
- Route catalog is file-backed under `server/data/routes.json`; ensure persistent volume/backup strategy in production.
- If `ROUTE_ADMIN_SECRET` is unset, admin route APIs are effectively disabled.

## Project Structure

```text
blockkart/
  client/   # Browser game (Vite + Three.js)
  server/   # Express API + WebSocket + LNBits integration
  shared/   # Shared TypeScript types
  docs/     # Runbooks and operational docs
```

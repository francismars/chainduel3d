# Staging Release Gate Checklist

Use this checklist before promoting a build from staging to production.

## 1. API + Realtime Health

- `GET /health` returns `ok: true`.
- `observability` section includes non-zero counters after smoke traffic.
- WS connection to `/ws` can subscribe and receive `room_state`.

## 2. Online Race Flow

- Create room as host.
- Join room as second member.
- Mark ready and start race.
- Confirm `race_snapshot` stream during race.
- Confirm rematch returns to lobby.

## 3. Optional Wager Flow (Legacy Sessions)

- Create session with `x-idempotency-key`.
- Verify invoices are returned.
- Call result endpoint twice with same idempotency key and winner.
- Confirm second response is idempotent (same payout metadata).

## 4. Room Wager + Settlement Flow

- Host sets room wager and winner count in online lobby.
- Each active member requests deposit invoice via `POST /api/rooms/:roomId/deposits/create`.
- Poll `GET /api/rooms/:roomId/deposits/status` until all active members are `paid: true`.
- Confirm race start is rejected until all required deposits are paid.
- Finish race and verify server-generated settlement via `GET /api/rooms/:roomId/settlement`.
- Winner claims ticket via `POST /api/rooms/:roomId/settlement/claim`.
- Winner redeems LNURL via `POST /api/rooms/:roomId/settlement/withdraw`.
- Confirm claim token is one-time-use and replay is rejected.

## 5. Security Checks

- `POST /api/admin/auth/login` rejects wrong secret.
- Admin route CRUD rejects missing/expired token.
- Member token misuse (wrong room/token) is rejected over REST and WS.

## 6. Test Commands

Run from repo root:

```bash
npm run test:parity --workspace=server
npm run test:payments --workspace=server
npm run test:settlement --workspace=server
npm run test:ws --workspace=server
npm run test:smoke --workspace=server
```

## 7. Rollback Drill

1. Redeploy a previous SHA tag to staging.
2. Validate `/health` and one online race.
3. Re-deploy candidate SHA.
4. Validate checklist sections 1-3 again.

## 8. Go/No-Go Decision

- Go: all sections pass, no sev1/sev2 defects, rollback verified.
- No-Go: any critical failure in realtime sync, payments idempotency, or auth controls.

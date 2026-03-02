# CHAINDUEL3D

A browser-based 3D chain duel game with Anatomy of Bitcoin visual aesthetics and Lightning Network sat wagering.

## Quick Start

```bash
npm install
npm run dev
```

This starts both the Vite dev server (port 5173) and the backend (port 3000).

Open `http://localhost:5173` in your browser.

### Practice Mode

Click **Practice Mode** on the lobby screen to race without sats. No backend or LNBits configuration needed.

### With Lightning Payments

1. Copy `server/.env.example` to `server/.env`
2. Set `ROUTE_ADMIN_SECRET` (required for admin route APIs)
3. Fill in your LNBits credentials
4. Start the game and click **Start Chain Duel** — QR codes will be generated for both players to deposit sats

### Admin Route APIs

- Admin endpoints under `/api/admin/routes/*` require header `x-admin-secret`.
- The header value must match `ROUTE_ADMIN_SECRET` from `server/.env`.

## Controls

| Action    | Player 1         | Player 2          |
|-----------|------------------|--------------------|
| Accelerate | W               | Arrow Up           |
| Brake      | S               | Arrow Down         |
| Steer Left | A               | Arrow Left         |
| Steer Right| D               | Arrow Right        |
| Use Item   | Space           | Enter              |
| Look Back  | Q               | Right Shift        |

## Items

- **Double Spend** — Speed boost
- **Fork Bomb** — Drops obstacle on route
- **Lightning Bolt** — Slows opponent

## Tech Stack

- Three.js + cannon-es (3D rendering + physics)
- Vite + TypeScript
- Node.js + Express (backend)
- LNBits API (Lightning Network payments)

## Project Structure

```
chainduel3d/
  client/          # Browser game (Three.js)
  server/          # Backend (Express + LNBits)
  shared/          # Shared TypeScript types
```

# Production Runbook

This runbook covers staging/prod deployment for a single-VM setup using Docker Compose, Nginx, and GHCR images.

## 1) Prerequisites

- Ubuntu VM with Docker Engine + Docker Compose plugin installed
- DNS `A` record pointing `3d.chainduel.net` to VM public IP
- GitHub repository with Actions enabled
- GHCR package access from VM (`docker login ghcr.io`)

## 2) Required Secrets (GitHub)

Set these repository or environment secrets:

- `STAGING_SSH_HOST`, `STAGING_SSH_USER`, `STAGING_SSH_KEY`, `STAGING_SSH_PORT`, `STAGING_DEPLOY_PATH`
- `PRODUCTION_SSH_HOST`, `PRODUCTION_SSH_USER`, `PRODUCTION_SSH_KEY`, `PRODUCTION_SSH_PORT`, `PRODUCTION_DEPLOY_PATH`

Create protected GitHub Environment `production` with required reviewers for the manual promotion gate.

## 2.1) Compatibility and Rollout Notes

- Admin route API now requires bearer tokens from `POST /api/admin/auth/login`.
- Session endpoints support optional `x-idempotency-key`. Existing clients that do not send idempotency keys are still accepted.
- Room/session runtime persistence is enabled by default at `server/data/runtime/state.json`. Ensure this path is on persistent storage in staging and production.
- Room wagering now supports:
  - deposits per room member (`/api/rooms/:roomId/deposits/create`, `/api/rooms/:roomId/deposits/status`)
  - server-authoritative settlement claims (`/api/rooms/:roomId/settlement*`)
  - one-time claim ticket redemption for LNURL withdraw

## 3) VM Directory Layout

On each VM:

```bash
mkdir -p /opt/chainduel3d
cd /opt/chainduel3d
```

Copy these files/folders from repo:

- `docker-compose.prod.yml`
- `deploy/nginx/*`
- `deploy/certbot/`
- `server/.env.production.example` (rename to `server/.env`)

Then:

```bash
cp server/.env.production.example server/.env
# edit server/.env with real values
```

Recommended additional environment variables for hardened builds:

- `RUNTIME_STATE_FILE=server/data/runtime/state.json`
- `ADMIN_TOKEN_TTL_MS=900000`
- `ROOM_MEMBER_TOKEN_TTL_MS=86400000`

## 4) First-Time TLS Bootstrap (Let's Encrypt)

1. Use these domain-ready configs:
   - `deploy/nginx/chainduel3d.bootstrap.conf`
   - `deploy/nginx/chainduel3d.conf`
2. Start stack with HTTP-only bootstrap config:

```bash
NGINX_CONFIG=chainduel3d.bootstrap.conf IMAGE_PREFIX=ghcr.io/<owner>/chainduel3d IMAGE_TAG=latest docker compose -f docker-compose.prod.yml up -d
```

3. Issue cert using webroot challenge:

```bash
docker run --rm \
  -v "$(pwd)/deploy/certbot/www:/var/www/certbot" \
  -v "$(pwd)/deploy/certbot/conf:/etc/letsencrypt" \
  certbot/certbot certonly --webroot \
  -w /var/www/certbot \
  -d 3d.chainduel.net \
  --email you@example.com \
  --agree-tos --no-eff-email
```

4. Switch to TLS config and restart edge:

```bash
NGINX_CONFIG=chainduel3d.conf IMAGE_PREFIX=ghcr.io/<owner>/chainduel3d IMAGE_TAG=latest docker compose -f docker-compose.prod.yml up -d --remove-orphans
```

## 5) CI/CD Flow

- PRs and `main` pushes run `CI` workflow (`npm ci`, build, parity test).
- `Deploy` workflow on `main`:
  - build/pushes `client` and `server` images tagged by commit SHA
  - deploys to staging VM
  - waits at `production` environment approval gate
  - deploys exact same SHA tag to production after approval

## 6) Staging Verification Checklist

After each staging deploy, run:

1. `GET /health` returns `{ ok: true }`.
2. Open app over HTTPS, verify lobby renders.
3. Create online room, join with second browser session, start race.
4. Verify WS updates (chat + room state + race snapshot) continue during race.
5. Verify `/api/admin/routes/*` rejects without admin secret.
6. Run smoke suite from repo root:

```bash
SMOKE_BASE_URL=https://3d.chainduel.net SMOKE_ADMIN_SECRET=<admin_secret> npm run test:smoke --workspace=server
```

7. Validate LNBits flow on staging wallet:
   - session creates invoices
   - result endpoint returns payout (or safe fallback if LNBits unavailable)
8. Run hardening checks:

```bash
npm run test:payments --workspace=server
npm run test:settlement --workspace=server
npm run test:ws --workspace=server
```

9. Verify compatibility behavior:
   - admin CRUD works with bearer token auth flow from `POST /api/admin/auth/login`
   - session create/result still work without `x-idempotency-key` header
10. Complete [staging release checklist](./staging-release-checklist.md).
11. Record promotion decision using [go/no-go template](./go-no-go-template.md).

## 7) Updating an Existing Deployment

When new code is pushed to GitHub, update the VPS with:

```bash
cd /opt/chainduel3d
git pull
docker-compose -f docker-compose.prod.yml down --remove-orphans
docker-compose -f docker-compose.prod.yml build --no-cache
NGINX_CONFIG=chainduel3d.conf docker-compose -f docker-compose.prod.yml up -d
docker-compose -f docker-compose.prod.yml ps
curl -fsS https://3d.chainduel.net/health
```

If you hit `KeyError: 'ContainerConfig'` on `docker-compose` v1, run this recovery path:

```bash
cd /opt/chainduel3d
docker-compose -f docker-compose.prod.yml down --remove-orphans
docker rm -f chainduel3d_server_1 chainduel3d_client_1 chainduel3d_edge_1 2>/dev/null || true
docker ps -a --format '{{.Names}}' | grep chainduel3d_ | xargs -r docker rm -f
NGINX_CONFIG=chainduel3d.conf docker-compose -f docker-compose.prod.yml up -d
```

Recommendation: migrate VPS to Docker Compose v2 (`docker compose`) to avoid this v1 recreate bug class permanently.

## 8) Monitoring and Alerting

- External uptime check: `https://3d.chainduel.net/health` every 1 minute.
- Alert on:
  - 2+ consecutive health failures
  - 5xx spike from reverse proxy logs
- Container status checks:

```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs --tail=200 edge server client
```

## 9) Log Rotation

Configure Docker daemon log rotation on VM (`/etc/docker/daemon.json`):

```json
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "5"
  }
}
```

Then restart Docker daemon.

## 10) Rollback

Redeploy previous known-good image tag:

```bash
IMAGE_PREFIX=ghcr.io/<owner>/chainduel3d IMAGE_TAG=<previous_sha> docker compose -f docker-compose.prod.yml pull
IMAGE_PREFIX=ghcr.io/<owner>/chainduel3d IMAGE_TAG=<previous_sha> docker compose -f docker-compose.prod.yml up -d --remove-orphans
```

Validate with:

```bash
curl -fsS https://3d.chainduel.net/health
```

## 11) Data and Backup Notes

- Route catalog is persisted on server container filesystem by default.
- For persistent backups, mount `server/data` as a host volume and include it in nightly VM backups.
- Backup `deploy/certbot/conf` for TLS cert continuity.

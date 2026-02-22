# DevOps Deployment, Operations, and Monitoring Guide

This guide is for operators running the Decision Engine in pre-production and production environments.

## 1. Runtime Components

- API service (`apps/api`) running Fastify + workers
- UI service (`apps/ui`) running Next.js
- Postgres
- Redis

Core runtime behavior:

- `/v1/*` decisioning APIs (realtime, stacks, logs, precompute, DLQ admin)
- `/v2/inapp/decide` low-latency in-app decision endpoint
- `/v2/inapp/events` async event ingest (Redis Stream -> worker -> Postgres)

## 2. Deployment Topology

Recommended production topology:

1. `api-serve` deployment
- `API_RUNTIME_ROLE=serve`
- serves HTTP traffic only (no background workers)

2. `api-worker` deployment
- `API_RUNTIME_ROLE=worker`
- runs background workers (DLQ, in-app events, retention)
- no public ingress

3. `ui` deployment
- internal or public, based on your access model

Why split roles:

- isolates hot-path latency (`/v2/inapp/decide`) from worker spikes
- gives independent scaling for read/write/background workloads

For smaller environments, `API_RUNTIME_ROLE=all` is valid.

## 3. Required Configuration

Minimum required env vars before boot:

- `DATABASE_URL`
- `REDIS_URL`
- `API_WRITE_KEY`
- `MEIRO_MODE` (`mock` or `real`)

Strongly recommended for production:

- `PROTECT_DECIDE=true`
- `API_RUNTIME_ROLE=serve` (serve nodes)
- `API_RUNTIME_ROLE=worker` (worker nodes)
- `INAPP_V2_WBS_TIMEOUT_MS=80` (or environment-specific budget)
- `INAPP_V2_CACHE_TTL_SECONDS=60`
- `INAPP_V2_STALE_TTL_SECONDS=1800`
- `DLQ_WORKER_ENABLED=true` (worker role only)
- `INAPP_EVENTS_WORKER_ENABLED=true` (worker role only)
- `RETENTION_WORKER_ENABLED=true` (worker role only)

Reference defaults are in:

- `.env.example`
- `docker-compose.yml`
- `apps/api/src/config.ts`

## 4. Local/Single-Host Deploy (Docker Compose)

Start full stack:

```bash
docker compose up --build -d
```

Verify service health:

```bash
docker compose ps
curl -sS http://localhost:3001/health
```

Expected health response includes:

- `status: "ok"`
- active runtime role
- worker enablement flags

Notes:

- API container runs migrations/seeding on startup in the default compose flow.
- If running migrations manually from host, ensure `DATABASE_URL` is exported first:

```bash
pnpm --filter @decisioning/api prisma:migrate
```

## 5. Production Release Flow

Use this flow for each release candidate and production rollout.

1. Validate release gates:

```bash
pnpm release:gates
```

2. Run dependency degradation drill:

```bash
pnpm drill:dependency
```

3. Build and publish container images.
4. Deploy `api-worker` first, then `api-serve`, then `ui`.
5. Run post-deploy smoke checks (see section 6).

Tagging convention example:

- `v1.0.0-rc1` for release candidate

## 6. Post-Deploy Smoke Checks

Run these immediately after deployment:

1. API liveness:

```bash
curl -sS https://<api-host>/health
```

2. In-app decision path:

```bash
curl -X POST "https://<api-host>/v2/inapp/decide" \
  -H "Content-Type: application/json" \
  -H "X-ENV: PROD" \
  -H "X-API-KEY: <api-write-key>" \
  -d '{
    "appKey": "meiro_store",
    "placement": "home_top",
    "profileId": "p-1001",
    "context": { "locale": "en-US", "deviceType": "mobile" }
  }'
```

3. Async ingest monitor:

```bash
curl -sS "https://<api-host>/v2/inapp/events/monitor" \
  -H "X-ENV: PROD" \
  -H "X-API-KEY: <api-write-key>"
```

4. DLQ status:

```bash
curl -sS "https://<api-host>/v1/dlq/metrics" \
  -H "X-ENV: PROD" \
  -H "X-API-KEY: <api-write-key>"
```

5. Retention worker status:

```bash
curl -sS "https://<api-host>/v1/maintenance/retention/status" \
  -H "X-ENV: PROD" \
  -H "X-API-KEY: <api-write-key>"
```

## 7. Monitoring and Alerting Setup

Import monitoring assets:

- dashboard JSON: `ops/monitoring/grafana/dashboards/decision-engine-golden-signals.json`
- alert rules: `ops/monitoring/grafana/alerts/decision-engine-alerts.yaml`
- import instructions: `ops/monitoring/README.md`

Baseline monitoring guide:

- `docs/observability-golden-signals.md`

Minimum signals to watch:

1. `/v2/inapp/decide` p95 latency
2. fallback ratio (`fallbackReason` presence)
3. cache hit and stale-served ratios
4. in-app stream lag and worker throughput
5. DLQ pending/retrying/quarantined counts
6. retention worker heartbeat

## 8. Incident Operations

Primary runbook:

- `docs/runbooks/dependency-degradation.md`

Latest drill evidence:

- `docs/runbooks/drill-report-2026-02-22.md`

Manual controls:

1. Retry due DLQ messages:

```bash
curl -X POST "https://<api-host>/v1/dlq/retry-due" \
  -H "X-ENV: PROD" \
  -H "X-API-KEY: <api-write-key>" \
  -H "Content-Type: application/json" \
  -d '{}'
```

2. Trigger retention cleanup:

```bash
curl -X POST "https://<api-host>/v1/maintenance/retention/run" \
  -H "X-ENV: PROD" \
  -H "X-API-KEY: <api-write-key>" \
  -H "Content-Type: application/json" \
  -d '{}'
```

3. Invalidate cache for a hot profile (example):

```bash
curl -X POST "https://<api-host>/v1/cache/invalidate" \
  -H "X-ENV: PROD" \
  -H "X-API-KEY: <api-write-key>" \
  -H "Content-Type: application/json" \
  -d '{
    "scope": "profile",
    "profileId": "p-1001",
    "reasons": ["incident_manual_invalidate"]
  }'
```

## 9. Rollback Strategy

1. Roll back `api-serve` and `api-worker` image tags to last known good.
2. Keep Redis and Postgres running; avoid destructive data operations.
3. Disable non-critical workers temporarily if needed:
- `INAPP_EVENTS_WORKER_ENABLED=false`
- `DLQ_WORKER_ENABLED=false`
- `RETENTION_WORKER_ENABLED=false`
4. Re-enable workers after stabilization and replay backlog via DLQ endpoints.

Migration policy:

- Prisma migrations in this repo are forward-oriented. Do not apply ad-hoc down migrations during an incident unless tested in staging.

## 10. Capacity Notes

For bursty mobile traffic:

1. Keep `/v2/inapp/decide` cache hit ratio high by using stable context allowlists.
2. Enforce strict WBS timeout budgets (`INAPP_V2_WBS_TIMEOUT_MS`).
3. Use PgBouncer transaction pooling in front of Postgres for multi-pod scale.
4. Scale `api-serve` and `api-worker` independently.
5. Track DLQ and stream lag as backpressure indicators before user-visible errors rise.

# Production Refactor Backlog (Release 1)

This backlog assumes no legacy installations. We can remove duplicate paths and keep one production contract.

## Scope Guardrails

- Single runtime contract for in-app decide/events.
- Hot path (`/inapp/decide`) must be read-mostly and avoid synchronous Postgres writes.
- Background concerns (events ingest, DLQ replay, precompute, exports) run in worker role.
- Every chunk must keep `pnpm --filter @decisioning/api build` and tests green.

## Chunked Plan

### Chunk 1 (completed): Runtime role separation

Goal:
- Make it explicit whether a process runs as API (`serve`) or worker (`worker`) or mixed (`all`).

Tasks:
- Add `API_RUNTIME_ROLE` config (`all|serve|worker`).
- Gate background worker startup by runtime role.
- Expose runtime role and worker state on `/health`.

Acceptance:
- `GET /health` returns runtime role and worker flags.
- `API_RUNTIME_ROLE=serve` starts no background workers.
- `API_RUNTIME_ROLE=worker` starts configured workers.

### Chunk 2 (completed): Canonical API surface (remove duplicate legacy paths)

Goal:
- Keep one in-app API surface for production release.

Tasks:
- Promote `/v2/inapp/*` as canonical.
- Remove deprecated duplicate endpoints and duplicate internal handlers.
- Update UI/API client to only call canonical paths.
- Update tests/docs to match canonical contract.

Acceptance:
- No duplicate in-app route implementations remain.
- API and UI integration tests pass on canonical endpoints only.

### Chunk 3 (completed): Hot-path simplification and module boundaries

Goal:
- Split large route logic into focused services for maintainability and performance tuning.

Tasks:
- Extract `inapp/runtime` service (cache keying, SWR, fallback, evaluation).
- Extract `inapp/events` producer service.
- Keep routes as thin adapters with validation and auth only.

Acceptance:
- Route files shrink substantially and delegate to typed services.
- Unit tests cover service modules directly.

### Chunk 4: Worker hardening

Goal:
- Make async ingestion and retries production-safe under sustained bursts.

Tasks:
- Add bounded worker concurrency and backpressure policy.
- Add retry classification + metrics for stream batch failures.
- Add replay/idempotency checks for event ingest writes.

Acceptance:
- Stream lag stabilizes in load tests.
- No duplicate inserts under replay conditions.

### Chunk 5: Data lifecycle and retention

Goal:
- Keep operational tables bounded and query performance stable.

Tasks:
- Add retention jobs for old events/logs/results.
- Add missing indexes from observed query plans.
- Add maintenance endpoints/metrics for retention status.

Acceptance:
- Retention jobs run without table lock regressions.
- Query plans stay index-backed for key dashboards/endpoints.

### Chunk 6: Observability and release gates

Goal:
- Define objective go/no-go checks for release.

Tasks:
- Add golden metrics dashboard requirements (latency, cache hit, stale served, fallback, lag, DLQ).
- Add CI release gates for build/test/load smoke.
- Add runbooks for dependency degradation modes.

Acceptance:
- Release checklist can be executed without tribal knowledge.
- Staging soak can assert target SLOs.

## Suggested order of execution

1. Chunk 1
2. Chunk 2
3. Chunk 3
4. Chunk 4
5. Chunk 5
6. Chunk 6

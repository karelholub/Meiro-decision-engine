# Global Orchestration Policies (MVP)

This document describes the global orchestration layer added on top of the decision engine.

## Scope

Orchestration policies run outside the core deterministic engine and enforce cross-channel constraints:

- cross-channel frequency caps (per profile)
- mutex groups (only one action in a group during a window)
- cooldown windows (block matching actions after trigger events)
- fail-safe fallback (policy fallback action or `noop`)

Supported runtime surfaces:

- `POST /v1/decide`
- `POST /v1/decide/stack`
- `POST /v2/inapp/decide`
- precompute pipeline (`DecisionResult`)

## Data Model

Prisma models:

- `OrchestrationPolicy`
- `OrchestrationEvent`

Migration: `apps/api/prisma/migrations/202602241400_orchestration_policies_v1/migration.sql`

`OrchestrationEvent` writes are asynchronous on hot path:

1. runtime pushes to Redis stream `orchestr_events`
2. orchestration worker batches and persists to Postgres

Redis counters/markers are updated immediately for low-latency checks.

## Policy JSON

Schema is validated by `apps/api/src/orchestration/schema.ts`.

`schemaVersion` must be `orchestration_policy.v1`.

Rule types:

- `frequency_cap`
- `mutex_group`
- `cooldown`

Example:

```json
{
  "schemaVersion": "orchestration_policy.v1",
  "defaults": {
    "mode": "fail_open",
    "fallbackAction": { "actionType": "noop", "payload": {} }
  },
  "rules": [
    {
      "id": "global_caps",
      "type": "frequency_cap",
      "scope": "global",
      "appliesTo": { "actionTypes": ["message", "inapp_message"] },
      "limits": { "perDay": 2, "perWeek": 6 },
      "reasonCode": "GLOBAL_CAP"
    },
    {
      "id": "promo_mutex",
      "type": "mutex_group",
      "groupKey": "promo_any",
      "appliesTo": { "actionTypes": ["message"], "tagsAny": ["promo"] },
      "window": { "seconds": 86400 },
      "reasonCode": "MUTEX_PROMO"
    },
    {
      "id": "post_purchase_cooldown",
      "type": "cooldown",
      "trigger": { "eventType": "purchase" },
      "blocks": { "tagsAny": ["promo", "winback"] },
      "window": { "seconds": 604800 },
      "reasonCode": "COOLDOWN_POST_PURCHASE"
    }
  ]
}
```

## API Endpoints

Policy management:

- `GET /v1/orchestration/policies`
- `GET /v1/orchestration/policies/:id`
- `POST /v1/orchestration/policies/validate`
- `POST /v1/orchestration/policies` (write key required)
- `PUT /v1/orchestration/policies/:id` (write key required, DRAFT only)
- `POST /v1/orchestration/policies/:id/activate` (write key required)
- `POST /v1/orchestration/policies/:id/archive` (write key required)

Trigger ingestion:

- `POST /v1/orchestration/events` (write key required)
  - body fields: `profileId`, `eventType`, optional `appKey`, `actionKey`, `groupKey`, `ts`, `metadata`
  - returns `202 accepted`

Environment is resolved from `x-env` (same pattern as existing API routes).

## Runtime Behavior

`/v1/decide`:

- evaluate core decision first
- map result to normalized action descriptor
- evaluate policies
- when blocked: return fallback/noop and append reason codes
- record exposure asynchronously for allowed exposure actions

`/v1/decide/stack`:

- evaluate each step
- apply orchestration after each step output
- blocked step can continue if stop condition no longer matches (post-policy action)
- final output is also evaluated by orchestration

`/v2/inapp/decide`:

- evaluate policy per candidate
- skip blocked candidates and try next
- when all blocked: return no-show fallback (`show=false`)

Precompute:

- stack precompute records final reason code(s) in result evidence

## Observability

When `debug=true`, traces include orchestration rule outcomes and metrics (where applicable):

- `applied/blocked` per rule
- counters / remaining quota for caps
- reason codes

Logs include policy block events and reason code details.

## Reason Codes

Configured rule `reasonCode` values are returned when blocked.

System reason:

- `ORCHESTRATION_EVAL_ERROR` (fail-closed mode only)

## Config

Environment variables (see `.env.example`):

- `ORCHESTRATION_POLICY_CACHE_TTL_MS`
- `ORCHESTRATION_EVENTS_STREAM_KEY`
- `ORCHESTRATION_EVENTS_STREAM_GROUP`
- `ORCHESTRATION_EVENTS_CONSUMER_NAME`
- `ORCHESTRATION_EVENTS_STREAM_MAXLEN`
- `ORCHESTRATION_EVENTS_WORKER_ENABLED`
- `ORCHESTRATION_EVENTS_WORKER_BATCH_SIZE`
- `ORCHESTRATION_EVENTS_WORKER_BLOCK_MS`
- `ORCHESTRATION_EVENTS_WORKER_POLL_MS`
- `ORCHESTRATION_EVENTS_WORKER_RECLAIM_IDLE_MS`
- `ORCHESTRATION_EVENTS_WORKER_MAX_BATCHES_PER_TICK`
- `ORCHESTRATION_EVENTS_WORKER_DEDUPE_TTL_SECONDS`

## UI

Execution module additions:

- `Execution -> Orchestration Policies` editor/list
- Simulator policy outcome panel
- Logs policy reason code visibility

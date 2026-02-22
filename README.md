# Decisioning Extension MVP

TypeScript monorepo MVP for a rule-based decisioning extension designed to integrate with Meiro CDP profiles and audiences.

## Architecture

```text
/apps
  /api      Fastify + Prisma Decision API
  /ui       Next.js App Router Flow Builder
/packages
  /dsl      Decision DSL types, Zod schema validation, formatter
  /engine   Pure deterministic decision evaluator
  /meiro    Meiro adapter interface + mock/real adapter
  /policies Decision policy layer (consent/allowlist/redaction)
  /wbs-mapping WBS mapping schema + mapper + validation helpers
  /shared   Shared API/UI contract types
```

## Tech Choices

- Runtime: Node.js + TypeScript
- API: Fastify
- DB: Postgres + Prisma
- UI: Next.js App Router + Tailwind CSS
- Monorepo: pnpm workspaces
- Tests: Vitest (engine/api + UI utility smoke)

## Key MVP Features

- Versioned decision definitions (`DRAFT`, `ACTIVE`, `ARCHIVED`)
- Environment scoping per decision (`DEV`, `STAGE`, `PROD`)
- Policy enforcement on `/v1/decide` (consent gate, payload allowlist, PII redaction)
- Optional DSL writeback config to persist decision outcome as Meiro label/attribute
- Real Meiro adapter with timeout/retry and typed response mapping
- Hybrid execution model:
  - realtime decision endpoints with Redis cache + lock-based stampede protection
  - precompute pipeline writing `DecisionResult` records for bulk activations
  - event/webhook-driven invalidation with optional targeted recompute
- Reliability & defaults v1 for `/v1/decide`:
  - decision-level timeout budgets (`performance.timeoutMs`, `performance.wbsTimeoutMs`)
  - decision-level cache policy (fresh + stale modes: `normal`, `stale_if_error`, `stale_while_revalidate`, `disabled`)
  - optional fallback outputs for timeout/error (`fallback.onTimeout`, `fallback.onError`, `fallback.preferStaleCache`)
- Profile fetch optimization using `requiredAttributes` projection + Redis profile cache
- Decision reporting endpoint (outcomes, action distribution, holdout vs treatment)
- Conversion ingestion endpoint + conversion proxy uplift estimate
- WBS instance settings API + UI (base URL, query param names, timeout, segment toggle)
- WBS mapping API + UI (returned_attributes -> attributes/audiences/consents)
- In-App Messaging module (Applications, Placements, Templates, Campaigns + variants)
- `/v1/inapp/decide` runtime endpoint with deterministic varianting, holdout, caps, token rendering, tracking payload, cache, timeout fallback, and rate limiting
- In-App measurement ingest (`IMPRESSION`, `CLICK`, `DISMISS`) and reporting APIs (overview, campaign series, CSV export)
- In-App governance workflow (RBAC roles, approval actions, campaign versions, audit log, rollback, env promotion)
- DSL validation + formatting with Zod
- Deterministic engine:
  - eligibility checks (audiences, attributes, consent)
  - sticky holdout (hash bucket)
  - caps (daily/weekly by profile)
  - first-match rule evaluation with IF/ELSE branch support
- API endpoints:
  - `GET /` basic API root status
  - `POST /v1/decide`
  - `POST /v1/nba` (alias of stack realtime endpoint)
  - `/v1/decide` supports either `profileId` or `lookup: { attribute, value }`
  - `/v1/decide` returns `outcome: ERROR` (and logs it) if profile fetch from Meiro fails
  - decision CRUD/versioning + activate/archive
  - `POST /v1/decisions/:id/validate` now returns `schemaErrors`, `warnings`, and validation `metrics`
  - `POST /v1/decisions/:id/preview-activation` returns draft vs active diff summary
  - `POST /v1/simulate`
  - `POST /v1/conversions`
  - `GET /v1/reports/decision/:decisionId`
  - `GET/PUT /v1/settings/wbs`
  - `POST /v1/settings/wbs/test-connection`
  - `GET /v1/settings/wbs/history`
  - `GET/PUT /v1/settings/wbs-mapping`
  - `POST /v1/settings/wbs-mapping/validate`
  - `POST /v1/settings/wbs-mapping/test`
  - `GET /v1/settings/wbs-mapping/history`
  - `GET/POST /v1/inapp/apps`
  - `GET/POST /v1/inapp/placements`
  - `GET/POST /v1/inapp/templates`
  - `GET/POST/PUT /v1/inapp/campaigns`
  - `POST /v1/inapp/campaigns/:id/activate`
  - `POST /v1/inapp/campaigns/:id/archive`
  - `POST /v1/inapp/campaigns/:id/submit-for-approval`
  - `POST /v1/inapp/campaigns/:id/approve-and-activate`
  - `POST /v1/inapp/campaigns/:id/reject-to-draft`
  - `POST /v1/inapp/campaigns/:id/rollback`
  - `POST /v1/inapp/campaigns/:id/promote`
  - `GET /v1/inapp/campaigns/:id/versions`
  - `GET /v1/inapp/campaigns/:id/audit`
  - `POST /v1/inapp/validate/template`
  - `POST /v1/inapp/validate/campaign`
  - `POST /v1/inapp/decide`
  - `POST /v1/inapp/events`
  - `GET /v1/inapp/events`
  - `GET /v1/inapp/reports/overview`
  - `GET /v1/inapp/reports/campaign/:key`
  - `GET /v1/inapp/reports/export.csv`
  - `GET /v1/cache/stats`
  - `POST /v1/cache/invalidate`
  - `POST /v1/precompute`
  - `GET /v1/precompute/runs`
  - `GET /v1/precompute/runs/:runKey`
  - `GET /v1/precompute/runs/:runKey/results`
  - `DELETE /v1/precompute/runs/:runKey`
  - `GET /v1/results/latest`
  - `POST /v1/results/cleanup`
  - `GET/PUT /v1/settings/webhook-rules`
  - `POST /v1/webhooks/pipes`
  - paginated logs list + log details + NDJSON export
  - `GET /v1/logs/:id` for payload/trace/replay input
  - environment selection via `X-ENV` header (defaults to `DEV`)
- Persistence:
  - `decisions`, `decision_versions`, `decision_logs`
  - caps computed from logs (daily/weekly counts)
- Meiro integration abstraction:
  - `MeiroAdapter` interface
  - `MockMeiroAdapter` with seeded mock profiles
  - `RealMeiroAdapter` (`MEIRO_BASE_URL`, `MEIRO_TOKEN`, `MEIRO_TIMEOUT_MS`)
  - `writebackOutcome(...)` support (real adapter stub + mock in-memory recording)
- Extensibility hooks included in API wiring:
  - pre/post policy hook
  - optional ranker hook for candidate payloads

## Data Model (Prisma)

- `Decision`
- `DecisionVersion`
- `DecisionLog`
- `Conversion`
- `WbsInstance`
- `WbsMapping`
- `InAppApplication` (`inapp_applications`)
- `InAppPlacement` (`inapp_placements`)
- `InAppTemplate` (`inapp_templates`)
- `InAppCampaign` (`inapp_campaigns`)
- `InAppCampaignVariant` (`inapp_campaign_variants`)
- `InAppImpression` (`inapp_impressions`)
- `InAppDecisionLog` (`inapp_decision_logs`)
- `InAppDecisionCache` (`inapp_decision_cache`)
- `InAppEvent` (`inapp_events`)
- `InAppUser` (`inapp_users`)
- `InAppCampaignVersion` (`inapp_campaign_versions`)
- `InAppAuditLog` (`inapp_audit_logs`)
- `PrecomputeRun` (`precompute_runs`)
- `DecisionResult` (`decision_results`)
- `AppSetting` (`app_settings`)

Migration is included at:
- `apps/api/prisma/migrations/202602190001_init/migration.sql`
- `apps/api/prisma/migrations/202602190002_environment_scope/migration.sql`
- `apps/api/prisma/migrations/202602190003_conversions_reporting/migration.sql`
- `apps/api/prisma/migrations/202602190004_wbs_settings_mapping/migration.sql`
- `apps/api/prisma/migrations/202602190005_log_replay_and_indexes/migration.sql`
- `apps/api/prisma/migrations/202602191700_inapp_mvp/migration.sql`
- `apps/api/prisma/migrations/202602191900_inapp_v2_hardening/migration.sql`
- `apps/api/prisma/migrations/202602221310_hybrid_execution_v1/migration.sql`

## Environment Variables

Copy and edit:

```bash
cp .env.example .env
```

Important values:

- `DATABASE_URL`
- `API_PORT` (default `3001`)
- `API_WRITE_KEY` (used for write endpoints via `X-API-KEY`)
- `X-ENV` request header (`DEV`, `STAGE`, `PROD`; defaults to `DEV` when missing)
- CRUD endpoints also accept `?environment=DEV|STAGE|PROD` (header still supported)
- `PROTECT_DECIDE` (`true` to protect `/v1/decide` and `/v1/inapp/decide` with API key)
- `MEIRO_MODE` (`mock` or `real`)
- `MEIRO_BASE_URL`, `MEIRO_TOKEN` (for real adapter)
- `MEIRO_TIMEOUT_MS` (default `1500`, profile fetch timeout in real mode)
- `REDIS_URL` (Redis cache for realtime decisions/profile projection cache)
- `REALTIME_CACHE_TTL_SECONDS` (default `60`)
- `REALTIME_CACHE_LOCK_TTL_MS` (default `3000`)
- `REALTIME_CACHE_CONTEXT_KEYS` (default `appKey,placement,locale,deviceType`)
- `PROFILE_CACHE_TTL_SECONDS` (default `30`)
- `PRECOMPUTE_CONCURRENCY` (default `20`)
- `PRECOMPUTE_MAX_RETRIES` (default `2`)
- `PRECOMPUTE_LOOKUP_DELAY_MS` (default `25`)
- `DECISION_DEFAULT_TIMEOUT_MS` (default `120`)
- `DECISION_DEFAULT_WBS_TIMEOUT_MS` (default `80`)
- `DECISION_DEFAULT_CACHE_TTL_SECONDS` (default `60`)
- `DECISION_DEFAULT_STALE_TTL_SECONDS` (default `1800`)
- `NEXT_PUBLIC_API_BASE_URL`
- `NEXT_PUBLIC_API_KEY`
- `NEXT_PUBLIC_DECISION_WIZARD_V1` (`true` in dev by default; set to `false` to force Advanced JSON editing)
- `INAPP_RATE_LIMIT_WINDOW_MS` (default `60000`)
- `INAPP_RATE_LIMIT_PER_API_KEY` (default `240`)
- `INAPP_RATE_LIMIT_PER_APP_KEY` (default `360`)
- `INAPP_WBS_TIMEOUT_MS` (default `800`)

## Local Setup (pnpm)

```bash
pnpm install
pnpm --filter @decisioning/api prisma:generate
pnpm --filter @decisioning/api prisma:migrate
pnpm --filter @decisioning/api prisma:seed
pnpm test
pnpm build
pnpm typecheck
pnpm lint
```

Run apps:

```bash
pnpm --filter @decisioning/api dev
pnpm --filter @decisioning/ui dev
```

- API: `http://localhost:3001`
- UI: `http://localhost:3000`

Playwright smoke spec is provided at:
- `apps/ui/e2e/inapp.smoke.playwright.js`
- `apps/ui/e2e/decision-wizard.happy.playwright.js`
- `apps/ui/playwright.config.js`

Performance sanity benchmark:

```bash
pnpm bench:decide
# optional
BENCH_ITERATIONS=1000 pnpm bench:decide
```

## Docker Compose

```bash
docker compose up --build
```

Recommended incremental builds:

```bash
docker compose build api ui
docker compose up -d
```

The Dockerfiles are multi-stage and use BuildKit cache mounts for the pnpm store. To verify layer reuse, rebuild after a source-only change and confirm `pnpm fetch` / `pnpm install` layers are reported as `CACHED`.

Services:

- `postgres` on `5432`
- `redis` on `6379`
- `api` on `3001` (runs migrations + seed on start)
- `ui` on `3000`

## Seed Data

### Mock Profiles

- `p-1001`
- `p-1002`
- `p-1003`

Defined in:
- `apps/api/src/data/mockProfiles.ts`
- echoed in `apps/api/prisma/seed.ts`

### Seeded Decisions

- `cart_recovery` (ACTIVE in `DEV`)
- `global_suppression` (ACTIVE in `DEV`)

### Seeded Conversions

- one `purchase` event for `p-1001`
- one `signup` event for `p-1002`

### Seeded WBS Settings (DEV)

- active WBS instance:
  - `baseUrl=https://cdp.store.demo.meiro.io/wbs`
  - `attributeParamName=attribute`
  - `valueParamName=value`
  - `segmentParamName=segment`
  - `includeSegment=false`
  - `timeoutMs=1500`
- active mapping:
  - profile ID strategy: `CUSTOMER_ENTITY_ID`
  - attribute mappings for `web_rfm`, `web_churn_risk_score`, `web_total_spend`, `web_product_recommended2`, `mea_open_time`, `cookie_consent_status`
  - audience rules: `rfm_lost`, `high_value`
  - consent mapping from `cookie_consent_status`

### Seeded In-App Messaging Demo (DEV)

- application:
  - `meiro_store`
- placement:
  - `home_top` (allowed template keys: `banner_v1`)
- template:
  - `banner_v1` (required fields: `title`, `subtitle`, `cta`, `image`, `deeplink`)
- campaign:
  - `demo_home_top` (ACTIVE, priority `10`, ttl `3600`)
  - variant `A` weight `100`
  - token bindings:
    - `first_name -> mx_first_name_last|takeFirst`
    - `rfm -> web_rfm|takeFirst`
    - `churn -> web_churn_risk_score|takeFirst`
    - `spend -> web_total_spend|takeFirst`
    - `recommended_product -> web_product_recommended2|parseJsonIfString|takeFirst`

## In-App v2 Usage

### Runtime decision

```bash
curl -X POST "http://localhost:3001/v1/inapp/decide" \
  -H "Content-Type: application/json" \
  -H "X-ENV: DEV" \
  -H "X-API-KEY: local-write-key" \
  -d '{
    "appKey": "meiro_store",
    "placement": "home_top",
    "lookup": { "attribute": "email", "value": "alex@example.com" },
    "context": { "channel": "mobile" },
    "debug": true
  }'
```

### Decision reliability config example

```json
{
  "performance": {
    "timeoutMs": 120,
    "wbsTimeoutMs": 80
  },
  "cachePolicy": {
    "mode": "stale_if_error",
    "ttlSeconds": 60,
    "staleTtlSeconds": 1800,
    "keyContextAllowlist": ["appKey", "placement"]
  },
  "fallback": {
    "preferStaleCache": true,
    "onTimeout": {
      "actionType": "message",
      "payload": { "templateId": "safe_default" },
      "ttl_seconds": 60
    },
    "onError": {
      "actionType": "noop",
      "payload": {}
    },
    "defaultOutput": "default"
  }
}
```

### Event ingest

```bash
curl -X POST "http://localhost:3001/v1/inapp/events" \
  -H "Content-Type: application/json" \
  -H "X-ENV: DEV" \
  -H "X-API-KEY: local-write-key" \
  -d '{
    "eventType": "IMPRESSION",
    "appKey": "meiro_store",
    "placement": "home_top",
    "tracking": {
      "campaign_id": "demo_home_top",
      "message_id": "msg_demo_home_top_A_483672",
      "variant_id": "A"
    },
    "lookup": { "attribute": "email", "value": "alex@example.com" }
  }'
```

### Mobile integration notes

1. Call `POST /v1/inapp/decide` on placement render (for example, app home top slot).
2. Route by `templateId` in app code to your local rendering component.
3. Render `payload` fields directly from the contract.
4. Track `IMPRESSION`, `CLICK`, `DISMISS` with `POST /v1/inapp/events` using `tracking` IDs returned by decide.

## Example Decision DSL JSON

```json
{
  "id": "11111111-1111-1111-1111-111111111111",
  "key": "cart_recovery",
  "name": "Cart Recovery",
  "description": "Send cart reminders",
  "status": "DRAFT",
  "version": 1,
  "createdAt": "2026-02-19T00:00:00.000Z",
  "updatedAt": "2026-02-19T00:00:00.000Z",
  "activatedAt": null,
  "holdout": {
    "enabled": true,
    "percentage": 10,
    "salt": "cart-recovery-salt"
  },
  "eligibility": {
    "audiencesAny": ["cart_abandoners"],
    "audiencesNone": ["global_suppress"],
    "consent": {
      "requiredConsents": ["email_marketing"]
    }
  },
  "caps": {
    "perProfilePerDay": 1,
    "perProfilePerWeek": 3
  },
  "policies": {
    "requiredConsents": ["email_marketing"],
    "payloadAllowlist": ["templateId", "campaign"],
    "redactKeys": ["customerEmail"]
  },
  "writeback": {
    "enabled": true,
    "mode": "label",
    "key": "last_decision_outcome",
    "ttlDays": 30
  },
  "flow": {
    "rules": [
      {
        "id": "high-cart",
        "priority": 1,
        "when": {
          "type": "predicate",
          "predicate": {
            "field": "cartValue",
            "op": "gte",
            "value": 100
          }
        },
        "then": {
          "actionType": "message",
          "payload": {
            "templateId": "cart-recovery-high"
          }
        },
        "else": {
          "actionType": "personalize",
          "payload": {
            "variant": "cart-recovery-lite"
          }
        }
      }
    ]
  },
  "outputs": {
    "default": {
      "actionType": "noop",
      "payload": {}
    }
  }
}
```

## API Examples (curl)

### List decisions

```bash
curl "http://localhost:3001/v1/decisions?status=ACTIVE" \
  -H "X-ENV: DEV"
```

### Create draft decision

```bash
curl -X POST "http://localhost:3001/v1/decisions" \
  -H "Content-Type: application/json" \
  -H "X-API-KEY: local-write-key" \
  -H "X-ENV: DEV" \
  -d '{
    "key": "welcome_message",
    "name": "Welcome Message",
    "description": "Simple onboarding decision"
  }'
```

### Validate draft

```bash
curl -X POST "http://localhost:3001/v1/decisions/<decisionId>/validate" \
  -H "X-ENV: DEV"
```

### Preview activation impact

```bash
curl -X POST "http://localhost:3001/v1/decisions/<decisionId>/preview-activation" \
  -H "X-ENV: DEV"
```

### Activate draft

```bash
curl -X POST "http://localhost:3001/v1/decisions/<decisionId>/activate" \
  -H "X-API-KEY: local-write-key" \
  -H "X-ENV: DEV"
```

### Simulate with inline profile (no log write)

```bash
curl -X POST "http://localhost:3001/v1/simulate" \
  -H "Content-Type: application/json" \
  -d '{
    "decisionId": "<decisionId>",
    "profile": {
      "profileId": "inline-profile-1",
      "attributes": { "cartValue": 120 },
      "audiences": ["cart_abandoners"],
      "consents": ["email_marketing"]
    },
    "context": { "channel": "web" }
  }'
```

### Decide using mock profile

```bash
curl -X POST "http://localhost:3001/v1/decide" \
  -H "Content-Type: application/json" \
  -H "X-ENV: DEV" \
  -d '{
    "decisionKey": "cart_recovery",
    "profileId": "p-1001",
    "debug": true
  }'
```

### Decide using WBS lookup mode

```bash
curl -X POST "http://localhost:3001/v1/decide" \
  -H "Content-Type: application/json" \
  -H "X-ENV: DEV" \
  -d '{
    "decisionKey": "cart_recovery",
    "lookup": {
      "attribute": "email",
      "value": "alice@example.com"
    },
    "debug": true
  }'
```

When `debug=true` in lookup mode, the response includes redacted `rawWbsResponse` and mapping summary.  
Keys containing `email` or `phone` are redacted. Raw WBS payload is never persisted in `decision_logs`.

### Queue a precompute run

```bash
curl -X POST "http://localhost:3001/v1/precompute" \
  -H "Content-Type: application/json" \
  -H "X-API-KEY: local-write-key" \
  -H "X-ENV: DEV" \
  -d '{
    "runKey": "nightly_winback_2026-02-22T01",
    "mode": "decision",
    "key": "cart_recovery",
    "cohort": {
      "type": "profiles",
      "profiles": ["p-1001", "p-1002"]
    },
    "context": {
      "appKey": "meiro_store",
      "placement": "home_top"
    },
    "ttlSecondsDefault": 86400,
    "overwrite": false
  }'
```

### Fetch precompute run results

```bash
curl "http://localhost:3001/v1/precompute/runs/nightly_winback_2026-02-22T01/results?status=READY&limit=50" \
  -H "X-ENV: DEV"
```

### Invalidate realtime cache entries

```bash
curl -X POST "http://localhost:3001/v1/cache/invalidate" \
  -H "Content-Type: application/json" \
  -H "X-API-KEY: local-write-key" \
  -H "X-ENV: DEV" \
  -d '{
    "scope": "profile",
    "profileId": "p-1001",
    "reasons": ["purchase"],
    "alsoExpireDecisionResults": true
  }'
```

### Pipes webhook event (invalidate + optional recompute)

```bash
curl -X POST "http://localhost:3001/v1/webhooks/pipes" \
  -H "Content-Type: application/json" \
  -H "X-API-KEY: local-write-key" \
  -H "X-ENV: DEV" \
  -d '{
    "eventType": "purchase",
    "profileId": "p-1001",
    "context": {
      "appKey": "meiro_store",
      "placement": "home_top"
    }
  }'
```

### Get WBS settings

```bash
curl "http://localhost:3001/v1/settings/wbs" \
  -H "X-ENV: DEV"
```

### Update WBS settings

```bash
curl -X PUT "http://localhost:3001/v1/settings/wbs" \
  -H "Content-Type: application/json" \
  -H "X-API-KEY: local-write-key" \
  -H "X-ENV: DEV" \
  -d '{
    "name": "Meiro Store Demo",
    "baseUrl": "https://cdp.store.demo.meiro.io/wbs",
    "attributeParamName": "attribute",
    "valueParamName": "value",
    "segmentParamName": "segment",
    "includeSegment": false,
    "timeoutMs": 1500
  }'
```

### Validate WBS mapping JSON

```bash
curl -X POST "http://localhost:3001/v1/settings/wbs-mapping/validate" \
  -H "Content-Type: application/json" \
  -H "X-ENV: DEV" \
  -d '{
    "mappingJson": {
      "attributeMappings": [],
      "audienceRules": []
    }
  }'
```

### Test WBS connection (composed request preview)

```bash
curl -X POST "http://localhost:3001/v1/settings/wbs/test-connection" \
  -H "Content-Type: application/json" \
  -H "X-ENV: DEV" \
  -d '{
    "attribute": "stitching_meiro_id",
    "value": "97ead340-8d07-4fbb-b230-a61ad720a1f7",
    "segmentValue": "107"
  }'
```

Response includes `requestUrl` and `requestQuery` so you can verify the exact composed request.
The UI `Test Connection` button sends the current form values as an override config, so you can test before saving.
You can also send override config directly:

```bash
curl -X POST "http://localhost:3001/v1/settings/wbs/test-connection" \
  -H "Content-Type: application/json" \
  -H "X-ENV: DEV" \
  -d '{
    "attribute": "stitching_meiro_id",
    "value": "97ead340-8d07-4fbb-b230-a61ad720a1f7",
    "segmentValue": "107",
    "config": {
      "baseUrl": "https://cdp.store.demo.meiro.io/wbs",
      "attributeParamName": "attribute",
      "valueParamName": "value",
      "segmentParamName": "segment",
      "includeSegment": true,
      "timeoutMs": 1500
    }
  }'
```

### Test WBS mapping with sample payload

```bash
curl -X POST "http://localhost:3001/v1/settings/wbs-mapping/test" \
  -H "Content-Type: application/json" \
  -H "X-ENV: DEV" \
  -d '{
    "lookup": { "attribute": "email", "value": "demo@example.com" },
    "rawResponse": {
      "status": "ok",
      "customer_entity_id": "cust-demo-1",
      "returned_attributes": {
        "web_rfm": ["Lost"],
        "web_total_spend": ["9200"],
        "cookie_consent_status": ["yes"]
      }
    }
  }'
```

When `writeback.enabled` is true, `/v1/decide` calls Meiro writeback after non-`ERROR` outcomes.  
If writeback fails, the decision response still succeeds and adds reason code `WRITEBACK_FAILED`.

### Read logs

```bash
curl "http://localhost:3001/v1/logs?page=1&limit=50&includeTrace=false" \
  -H "X-ENV: DEV"
```

### Read in-app logs

```bash
curl "http://localhost:3001/v1/logs?type=inapp&page=1&limit=50&campaignKey=demo_home_top" \
  -H "X-ENV: DEV"
```

### Read a single log with trace and replay input

```bash
curl "http://localhost:3001/v1/logs/<logId>?includeTrace=true" \
  -H "X-ENV: DEV"
```

### Ingest conversion event

```bash
curl -X POST "http://localhost:3001/v1/conversions" \
  -H "Content-Type: application/json" \
  -H "X-API-KEY: local-write-key" \
  -d '{
    "profileId": "p-1001",
    "timestamp": "2026-02-19T12:00:00.000Z",
    "type": "purchase",
    "value": 120,
    "metadata": { "orderId": "o-123" }
  }'
```

### Decision report (includes conversion proxy)

```bash
curl "http://localhost:3001/v1/reports/decision/<decisionId>?windowDays=7" \
  -H "X-ENV: DEV"
```

### Export logs as NDJSON

```bash
curl "http://localhost:3001/v1/logs/export?limit=200"
```

### Validate in-app template schema

```bash
curl -X POST "http://localhost:3001/v1/inapp/validate/template" \
  -H "Content-Type: application/json" \
  -H "X-ENV: DEV" \
  -d '{
    "schemaJson": {
      "type": "object",
      "required": ["title", "subtitle", "cta", "image", "deeplink"],
      "properties": {
        "title": { "type": "string" },
        "subtitle": { "type": "string" },
        "cta": { "type": "string" },
        "image": { "type": "string" },
        "deeplink": { "type": "string" }
      }
    }
  }'
```

### Decide in-app message using Meiro demo lookup

```bash
curl -X POST "http://localhost:3001/v1/inapp/decide" \
  -H "Content-Type: application/json" \
  -H "X-ENV: DEV" \
  -d '{
    "appKey": "meiro_store",
    "placement": "home_top",
    "lookup": {
      "attribute": "stitching_meiro_id",
      "value": "97ead340-8d07-4fbb-b230-a61ad720a1f7"
    },
    "debug": true
  }'
```

Response contract:

```json
{
  "show": true,
  "placement": "home_top",
  "templateId": "banner_v1",
  "ttl_seconds": 3600,
  "tracking": {
    "campaign_id": "demo_home_top",
    "message_id": "msg_demo_home_top_A_489309",
    "variant_id": "A"
  },
  "payload": {
    "title": "Hey Alex - quick pick for you",
    "subtitle": "RFM Champions | churn 0.2 | total spend 1240",
    "cta": "See City Sneaker",
    "image": "https://images.unsplash.com/photo-1483985988355-763728e1935b",
    "deeplink": "meiro-store://products/sku-42",
    "debug": {}
  }
}
```

### Mobile integration pattern

1. Call `POST /v1/inapp/decide` with `appKey`, `placement`, and either `profileId` or `lookup`.
2. If `show=false`, do not render a component for that placement.
3. If `show=true`, route by `templateId` in the mobile app and render with `payload`.
4. Use `tracking.message_id`, `tracking.campaign_id`, and `tracking.variant_id` for impressions/click analytics.
5. Re-fetch on placement refresh boundary (`ttl_seconds`) or session change.

## UI Workflow

1. Open `http://localhost:3000/overview`
2. Select environment (`DEV`/`STAGE`/`PROD`) from header
3. Go to `Decisions` and choose `Create Draft (Wizard)` or `Create Draft (JSON)`
4. Open `Decision Details` (`/decisions/[id]`) then `Open Editor`
5. In the Decision Builder Wizard, configure `Template -> Basics -> Eligibility -> Rules -> Guardrails -> Fallback -> Test & Activate`
6. Validate + Save (autosave enabled for drafts)
7. Activate from the editor header or `Test & Activate` checklist
8. Open `Engagement` pages:
   - `/engagement/inapp/apps`
   - `/engagement/inapp/placements`
   - `/engagement/inapp/templates`
   - `/engagement/inapp/campaigns`
9. Edit campaign, validate, save, activate, then test in `Simulator` (`/simulate` -> `In-App`)
10. Open `Logs`, switch `type=inapp`, and use `Replay` to hydrate simulator from stored inputs
11. Open `WBS Settings` and run `Test Connection`
12. Open `WBS Mapping` and run `Test Mapping`
13. Open `App Settings` (`/settings/app`) to force-enable/disable Decision Builder Wizard globally in UI

## Notes for Enterprise Evolution

Current structure intentionally leaves extension points for:

- policy checks (`policyHook` pre/post decision)
- candidate ranking (`rankerHook`)
- destination expansion via action payload contracts
- future RBAC/approvals metadata on decision records
- environment scoping (`dev`/`stage`/`prod`) in decision model

## Important Paths

- API server: `apps/api/src/app.ts`
- Prisma schema: `apps/api/prisma/schema.prisma`
- Seed script: `apps/api/prisma/seed.ts`
- UI list page: `apps/ui/src/app/decisions/page.tsx`
- UI details page: `apps/ui/src/app/decisions/[decisionId]/details-client.tsx`
- UI editor: `apps/ui/src/app/decisions/[decisionId]/editor-client.tsx`
- UI simulator: `apps/ui/src/app/simulate/page.tsx`
- UI logs: `apps/ui/src/app/logs/page.tsx`
- UI in-app apps: `apps/ui/src/app/engagement/inapp/apps/page.tsx`
- UI in-app placements: `apps/ui/src/app/engagement/inapp/placements/page.tsx`
- UI in-app templates: `apps/ui/src/app/engagement/inapp/templates/page.tsx`
- UI in-app campaigns: `apps/ui/src/app/engagement/inapp/campaigns/page.tsx`
- UI in-app campaign editor: `apps/ui/src/app/engagement/inapp/campaigns/[id]/page.tsx`
- API in-app routes: `apps/api/src/inapp.ts`
- Engine: `packages/engine/src/index.ts`
- DSL: `packages/dsl/src/index.ts`
- Meiro adapter: `packages/meiro/src/index.ts`
- WBS mapping package: `packages/wbs-mapping/src/index.ts`
- WBS settings UI: `apps/ui/src/app/settings/wbs/page.tsx`
- WBS mapping UI: `apps/ui/src/app/settings/wbs-mapping/page.tsx`

## Release Notes

- `trace` response shape for `/v1/decide` and `/v1/simulate` is now standardized as an envelope (`formatVersion`, `engine`, `integration`).
- `/v1/logs` is now environment-scoped and paginated; it returns `{ page, limit, total, totalPages, items }`.
- `/v1/logs` supports `type=inapp` for in-app decision log browsing and replay.
- New `decision_logs.inputJson` column stores replay-safe input to power Logs replay UX.
- New In-App Messaging module adds admin CRUD, runtime decisioning (`/v1/inapp/decide`), in-app logs, simulator support, and DEV seed data.
- No existing endpoint was removed; previous fields remain available for backwards compatibility.

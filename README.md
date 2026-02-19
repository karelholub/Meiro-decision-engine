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
  /shared   Shared API/UI contract types
```

## Tech Choices

- Runtime: Node.js + TypeScript
- API: Fastify
- DB: Postgres + Prisma
- UI: Next.js App Router + Tailwind CSS
- Monorepo: pnpm workspaces
- Tests: Vitest

## Key MVP Features

- Versioned decision definitions (`DRAFT`, `ACTIVE`, `ARCHIVED`)
- DSL validation + formatting with Zod
- Deterministic engine:
  - eligibility checks (audiences, attributes, consent)
  - sticky holdout (hash bucket)
  - caps (daily/weekly by profile)
  - first-match rule evaluation with IF/ELSE branch support
- API endpoints:
  - `POST /v1/decide`
  - decision CRUD/versioning + activate/archive
  - `POST /v1/simulate`
  - logs list + NDJSON export
- Persistence:
  - `decisions`, `decision_versions`, `decision_logs`
  - caps computed from logs (daily/weekly counts)
- Meiro integration abstraction:
  - `MeiroAdapter` interface
  - `MockMeiroAdapter` with seeded mock profiles
  - `RealMeiroAdapter` skeleton (`MEIRO_BASE_URL`, `MEIRO_TOKEN`)
- Extensibility hooks included in API wiring:
  - pre/post policy hook
  - optional ranker hook for candidate payloads

## Data Model (Prisma)

- `Decision`
- `DecisionVersion`
- `DecisionLog`

Migration is included at:
- `apps/api/prisma/migrations/202602190001_init/migration.sql`

## Environment Variables

Copy and edit:

```bash
cp .env.example .env
```

Important values:

- `DATABASE_URL`
- `API_PORT` (default `3001`)
- `API_WRITE_KEY` (used for write endpoints via `X-API-KEY`)
- `PROTECT_DECIDE` (`true` to protect `/v1/decide` with API key)
- `MEIRO_MODE` (`mock` or `real`)
- `MEIRO_BASE_URL`, `MEIRO_TOKEN` (for real adapter)
- `NEXT_PUBLIC_API_BASE_URL`
- `NEXT_PUBLIC_API_KEY`

## Local Setup (pnpm)

```bash
pnpm install
pnpm --filter @decisioning/api prisma:generate
pnpm --filter @decisioning/api prisma:migrate
pnpm --filter @decisioning/api prisma:seed
pnpm test
pnpm build
```

Run apps:

```bash
pnpm --filter @decisioning/api dev
pnpm --filter @decisioning/ui dev
```

- API: `http://localhost:3001`
- UI: `http://localhost:3000`

## Docker Compose

```bash
docker compose up --build
```

Services:

- `postgres` on `5432`
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

- `cart_recovery` (ACTIVE)
- `global_suppression` (ACTIVE)

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
curl "http://localhost:3001/v1/decisions?status=ACTIVE"
```

### Create draft decision

```bash
curl -X POST "http://localhost:3001/v1/decisions" \
  -H "Content-Type: application/json" \
  -H "X-API-KEY: local-write-key" \
  -d '{
    "key": "welcome_message",
    "name": "Welcome Message",
    "description": "Simple onboarding decision"
  }'
```

### Validate draft

```bash
curl -X POST "http://localhost:3001/v1/decisions/<decisionId>/validate"
```

### Activate draft

```bash
curl -X POST "http://localhost:3001/v1/decisions/<decisionId>/activate" \
  -H "X-API-KEY: local-write-key"
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
  -d '{
    "decisionKey": "cart_recovery",
    "profileId": "p-1001",
    "debug": true
  }'
```

### Read logs

```bash
curl "http://localhost:3001/v1/logs?limit=50"
```

### Export logs as NDJSON

```bash
curl "http://localhost:3001/v1/logs/export?limit=200"
```

## UI Workflow

1. Open `http://localhost:3000/decisions`
2. Create draft
3. Open editor
4. Validate + Save
5. Activate
6. Open simulator and run against mock profile
7. Open logs viewer to inspect outcomes/reasons

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
- UI editor: `apps/ui/src/app/decisions/[decisionId]/editor-client.tsx`
- Engine: `packages/engine/src/index.ts`
- DSL: `packages/dsl/src/index.ts`
- Meiro adapter: `packages/meiro/src/index.ts`

# Governed Decision Assets Phase 3

Phase 3 adds change-management guardrails on top of the Phase 1/2 governed asset model. It does not introduce a new workflow engine, DAM, or analytics store.

## Alignment

- **Reused abstractions:** Offer, Content Block, concrete variants, Asset Bundle, lifecycle status, audit logs, dependency scans, asset health, and release plans remain the core objects.
- **Where features live:** Change-management checks live in Catalog APIs under `/v1/catalog/assets/*`, task guidance lives in Observe Asset Health, and release risk summaries extend the existing release plan JSON.
- **Runtime behavior:** Decision and in-app resolution paths remain backward-compatible. Phase 3 adds explainability around planned changes, not a new resolver.
- **Tradeoffs:** Readiness, impact, archive consequences, task guidance, and release risk are computed on demand with deterministic rules. No persisted workflow state, automatic winner selection, warehouse attribution, or localization inheritance tree is added.

## Impact Analysis

`GET /v1/catalog/assets/impact?type=<offer|content|bundle>&key=<key>` compares the latest saved version with the previous version when available. It returns:

- active reference counts for decisions, campaigns, experiments, and bundles
- runtime-eligible scopes that may change
- fallback/default behavior changes
- bundle dependency changes
- experiment metadata changes
- a release-oriented risk level
- product-readable diff labels

The result is intended to help operators understand likely consequences before saving, activating, promoting a default, archiving, or releasing.

## Readiness

`GET /v1/catalog/assets/readiness` returns `ready`, `ready_with_warnings`, or `blocked`.

Checks include:

- archived or invalid lifecycle/window
- missing default variant
- no runtime-eligible variants
- duplicate variant scopes
- structured payload problems
- stale experiment metadata
- broken bundle components
- missing bundle template or placement metadata

Every check includes a reason code, readable message, and suggested next action.

## Diff Explainability

`GET /v1/catalog/assets/diff` exposes product-level labels instead of only raw JSON deltas. Labels call out changes such as:

- CTA label or CTA URL changed
- variant scope changed
- default fallback changed
- variant validity changed
- experiment metadata changed
- bundle offer/content/template/placement compatibility changed

Release plans also carry per-item `changeNotes` and `riskSummary` fields.

## Archive Consequences

`GET /v1/catalog/assets/archive-preview` classifies archive risk and explains likely outcomes:

- active references may stop resolving
- default fallback may be lost
- bundles may partially resolve
- experiment-linked flows may be affected

Archive endpoints still follow the existing strong soft-warning model, but now include `archiveConsequence` in responses and audit metadata.

## Release Risk

Release plan items now include:

- `riskSummary.riskLevel`: `low`, `medium`, `high`, or `blocking`
- release notes derived from asset/bundle diffs and risk flags
- remediation hints for missing dependencies, target placement/template drift, stale experiment metadata, default/fallback issues, and bundle component problems

The top-level release plan also includes an aggregate `riskSummary`.

## Operator Tasks

`GET /v1/catalog/assets/tasks` produces a prioritized list of deterministic operator tasks. Observe Asset Health shows these tasks above health cards.

Examples:

- Needs default variant
- Has stale experiment metadata
- Requires publish readiness review
- Archive requires review

Tasks link back to the existing Catalog surfaces.

## Known Limits

- Readiness is deterministic and operational; it is not business performance scoring.
- Impact analysis compares saved versions, not unsaved local browser edits.
- Archive remains a soft-warning action under current governance conventions.
- Before/after preview uses product diffs and current runtime preview paths, not a full replay engine.
- Release risk is a practical rule set, not a full environment diff system.

# Governed Decision Assets Phase 2

This note records the Phase 2 alignment before implementation.

## Phase 2 Hardening Note

The hardening pass keeps the Phase 2 shape intact and tightens the weak operational edges:

- **Structured authoring:** Structured and JSON modes both still write `payloadJson`. Structured mode now treats unsupported JSON fields as preserved advanced fields rather than silently dropping them, and server validation checks object shape, CTA pairing, URL/deeplink syntax, token references, and experiment metadata consistency.
- **Locale fallback:** Runtime matching normalizes locale case and underscores before comparison (`EN_us` resolves as `en-US`) and reports requested locale, normalized locale, selected locale, fallback chain, and malformed input in `resolutionMeta.localeResolution`.
- **Bundle lifecycle and resolution:** Bundles still resolve through existing offer/content paths. Bundle `resolutionMeta` now includes component-level status, partial-resolution flags, and bundle reason codes for missing/inactive components or component warnings.
- **Asset health:** Health remains computed and operational. Output now includes stable warning details with reason codes, severity, and operator-readable messages. Bundle health checks component readiness, missing templates, missing placements, and no-component bundles.
- **Dependency/impact analysis:** Offer and Content Block dependency scans now include bundles that reference them, and archive safety counts active bundle references alongside decisions, campaigns, and experiments.
- **Release packaging:** Variant diffing includes structured-authoring metadata and experiment metadata. Release planning emits risk flags for stale experiment metadata and missing bundle/template/placement dependencies in target environments.
- **Experiment-linked variants:** Make-default remains operator controlled. Promotion now returns and audits warnings when the selected variant is experiment-linked, expired, or not started.

Remaining ambiguity is intentional: health is not attribution or optimization ranking, bundle archive remains a strong soft warning under current governance conventions, and locale fallback remains a simple convention rather than a market inheritance engine.

## Reused Abstractions

- **Catalog versioning:** Offer and Content Block remain the primary governed asset types. Phase 2 keeps their version/status/audit model and extends authoring and diagnostics around existing variants.
- **Runtime resolver:** Preview, simulation, decision runtime, and in-app runtime continue to use the catalog resolver. Asset bundles resolve through the same offer/content paths instead of creating a second runtime engine.
- **Variant model:** `OfferVariant` and `ContentBlockVariant` remain concrete scoped payload rows. Phase 2 adds clone/experiment metadata and richer UI/validation, but does not introduce inheritance trees.
- **Experiments:** Existing experiment versions and treatment JSON remain the experiment source of truth. Asset-side experiment visibility is derived from active experiment definitions.
- **Observe/reporting:** Asset health is computed from current catalog rows, decision logs, in-app events, and dependency scans. It is operational guidance, not a warehouse-grade analytics model.
- **Release planner:** Bundles are added as another release entity and reuse the existing dependency expansion and snapshot/apply patterns.

## Where Phase 2 Lives

- Structured variant authoring lives in the existing Catalog Offer and Content Block detail surfaces.
- Locale fallback remains deterministic inside the catalog resolver and is exposed in `resolutionMeta`.
- Impact and health APIs live under `/v1/catalog/assets/*`, alongside Phase 1 dependency/report endpoints.
- Asset bundles live in Catalog as a lightweight versioned object and are referenced from existing decision/campaign payload refs via `bundleKey`.
- Bundle preview uses the catalog resolver and returns resolved offer/content output plus the same resolution metadata.

## Deliberate Tradeoffs

- Structured authoring is a guided mode for common payload fields with JSON fallback, not a replacement schema engine.
- Locale fallback is convention-based (`locale-region -> language -> default`) and visible, not an arbitrary market inheritance graph.
- Archive/edit safety remains a strong soft warning to match the current governance pattern.
- Experiment-aware optimization is operator-controlled: Phase 2 exposes candidates and promotion helpers, but does not auto-pick winners.
- Asset health is computed on demand using deterministic rules and recent logs; no new analytics warehouse is introduced.
- Asset bundles package reusable offer/content/template/placement metadata, but they are not a DAM or orchestration engine.

## Implemented Phase 2 Behavior

### Structured Authoring

Variant authoring supports two modes:

- **Structured mode:** common fields such as title, subtitle, body, CTA label, CTA URL/deeplink, image ref, disclaimer, promo code, badge, and tracking ID.
- **JSON mode:** advanced mode for payloads that do not fit the common shape.

Both modes serialize back into the same `payloadJson` runtime field. Preview still uses the catalog resolver, so structured editing does not create a mock rendering path.

### Locale Fallback

Locale fallback is deterministic and exposed in `resolutionMeta.localeFallbackChain`:

1. requested locale, for example `cs-CZ`
2. language fallback, for example `cs`
3. default

Resolution still applies the Phase 1 precedence rules for locale, channel, placement, and defaults. The fallback chain is metadata for operators and simulator/debug views.

### Variant Cloning And Experiment Metadata

Variants can carry clone and experiment metadata:

- `clonedFromVariantId`
- `experimentKey`
- `experimentVariantId`
- `experimentRole`
- `metadataJson`

The Catalog UI can clone variants and clone variants as experiment candidates. Operator-controlled promotion is exposed through make-default APIs for Offer and Content Block variants. This does not auto-promote winners.

### Impact And Health

Dependency lookups now include active experiments in addition to decisions and campaigns. Asset health is available at `/v1/catalog/assets/health` and classifies assets as:

- `healthy`: no deterministic warnings
- `warning`: non-blocking governance, dependency, expiry, or coverage warnings
- `critical`: expired or no runtime-eligible variants

Health checks include runtime-eligible variant counts, locale/channel/placement coverage, orphan detection, active references, expiry warnings, and bundle reference warnings.

### Asset Bundles

`AssetBundle` is a lightweight versioned Catalog object containing:

- Offer reference
- Content Block reference
- optional template key
- placement, channel, and locale compatibility metadata
- tags and use-case labels

Bundles are referenced from decisions or campaigns through `payloadRef.bundleKey`. Runtime expands a bundle into its offer/content references and then uses the existing resolver. Bundle preview uses the same path.

### Release Behavior

Release planning supports bundle objects. A bundle selection expands dependencies to referenced offers, content blocks, templates, and placements. Release summaries surface bundle changes, and apply preserves bundle metadata. Bundle promotion uses the existing release plan/apply flow.

## Remaining Limits

- Asset health remains computed on request and directional.
- Bundle references do not replace direct offer/content references; they are an additional reusable packaging layer.
- Experiment winner adoption is manual via make-default actions.
- Structured authoring covers common fields only; custom payloads should use JSON mode.
- Locale fallback is convention-based and does not support market inheritance trees.

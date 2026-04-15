# Governed Decision Assets MVP

This note records the repo alignment for MVP Phase 1 of governed decision assets / runtime content resolution.

## Current Patterns

- **Offer model:** `Offer` already exists as a versioned catalog entity keyed by `environment + key + version`. It has `status`, `tags`, `type`, `valueJson`, `constraints`, `startAt`, `endAt`, `activatedAt`, and catalog audit events.
- **Content Block model:** `ContentBlock` already exists as a versioned catalog entity keyed by `environment + key + version`. It has `status`, `templateId`, `schemaJson`, locale payload JSON, token bindings, tags, and catalog audit events.
- **Status/versioning:** Catalog currently uses string statuses and version rows, with one active version per key enforced by activation routes. In-app campaigns use richer lifecycle states (`DRAFT`, `PENDING_APPROVAL`, `ACTIVE`, `ARCHIVED`), audit logs, and approval actions. The MVP extends catalog states without adding a second workflow engine.
- **Decision/campaign references:** Decisions reference assets through `payload.payloadRef.offerKey` and `payload.payloadRef.contentKey`. In-app campaigns have direct `offerKey` and `contentKey` fields, and experiments can reference offer/content keys in treatments.
- **Runtime resolution:** `createCatalogResolver` is already used by `/v1/decide`, `/v1/decide/stack`, `/v1/nba`, simulation, Pipes evaluate, experiment preview, and `/v2/inapp/decide`. The MVP extends this resolver instead of creating a new runtime path.
- **Simulation:** `/v1/simulate` evaluates the decision engine, then resolves catalog payload references before returning the payload. Content blocks also have a standalone preview route.
- **Analytics/events:** Decision logs store returned payloads and traces. In-app decision logs and in-app events store campaign, variant, message, and engagement events. Asset reporting can derive MVP usage from these existing logs and campaign references.
- **RBAC/approval/audit:** Permissions already include catalog read/write/activate/archive. Catalog writes create `CatalogAuditLog` entries. Releases already include `offer` and `content` entity types.

## MVP Shape

The implementation extends `Offer` and `ContentBlock` with concrete `OfferVariant` and `ContentBlockVariant` tables. Variants support locale, channel, placement, default fallback, structured JSON payloads, token bindings, and optional validity windows. Runtime resolution remains additive and returns metadata through debug/trace payloads without breaking existing consumers.

## Phase 1 Hardening Inspection

- **Current `resolutionMeta`:** runtime payloads already return additive metadata for resolved offers and content blocks. The original MVP fields were `key`, `version`, `valid`, `variantId`, `reasonCode`, `warnings`, and token misses. Hardening keeps those fields and adds selected asset/variant IDs, selection rule, fallback flag, candidate summary, rejection reasons, token diagnostics, validity state, lifecycle state, and resolution warnings.
- **Lifecycle gating:** runtime fetches only `ACTIVE` parent Offer and Content Block versions. Parent validity windows are evaluated after fetch; inactive or archived parents are not runtime candidates. Variants inherit parent lifecycle and are gated by their own optional validity windows.
- **Token behavior:** payload tokens are simple `{{ token }}` placeholders. Allowed sources are direct `profile.*`, `context.*`, `derived.*`, explicit token bindings, and top-level profile/context/derived values. There is no free-form evaluation. Missing and null values are treated consistently as unresolved and replaced by the configured missing-token marker.
- **Report derivation:** asset reports are operational summaries derived from existing decision logs, in-app campaign references, and in-app events. They are directional usage signals, not attribution-grade analytics.
- **Release packaging:** release plans include parent assets and concrete variants together. Apply creates variants with the promoted parent version. Hardening adds plan risk flags for missing defaults, duplicate scopes, no runtime-eligible variants, expired defaults, and missing placement keys in the target environment.
- **Known ambiguous edges:** active parents with no runtime-eligible variants fall back to legacy parent/localized payload behavior where the endpoint already allows it; inactive parents are indistinguishable from missing assets at runtime because only active parents are fetched; reporting cannot reliably attribute governed asset variants when historical events only carry campaign variant keys.

## Runtime Resolution Details

Variant selection is deterministic:

1. exact locale + channel + placement
2. language + channel + placement
3. locale + channel
4. language + channel
5. channel default
6. channel only
7. global default
8. any default

Every preview, simulation, decision, and in-app runtime path uses the same resolver. The resolver records the selected rule, whether fallback was used, all candidates considered, and why non-selected candidates were rejected. Rejections are machine-readable reason codes such as `VARIANT_EXPIRED`, `VARIANT_NOT_STARTED`, `SCOPE_MISMATCH`, and `LOWER_PRECEDENCE`.

Parent lifecycle and validity are separate from variant validity. An inactive or archived parent is not fetched for runtime resolution. An active parent outside its validity window is returned as invalid and does not get merged into runtime payloads. An expired or not-yet-started variant is excluded before precedence is applied.

## Token Hygiene

Token substitution is structural and non-mutating: the resolver creates a rendered payload and does not mutate profile, context, derived data, or source asset payloads. Full-token values preserve non-string types, for example `{{ profile.score }}` can remain a number. Embedded tokens inside strings are stringified. Objects embedded in strings are JSON-stringified.

Missing paths and null values are both reported as `TOKEN_MISSING_OR_NULL`. Empty strings are valid values and render as empty strings. Token diagnostics expose tokens found, resolved, unresolved, bindings defined, and bindings unused by the payload.

## Operational Reporting

Report labels should be read as operational usage:

- `usageCount` combines sampled decision-log serves with in-app impressions.
- `decisionUsageCount` is based on recent decision logs that still contain the asset reference.
- `impressions`, `clicks`, and `dismissals` come from existing in-app events for campaigns referencing the asset.
- `variantUsage` is a legacy alias for campaign variant-key event volume, not governed asset variant reporting.

Reports return explicit zeros and warnings for empty windows, missing sampled decision serves, and events without variant keys.

## Archive And Release Guardrails

Archive endpoints now include dependency and `archiveSafety` metadata in API responses and audit metadata. MVP behavior remains a strong soft warning: archive is allowed, but active decision and campaign references are returned so operators can see the runtime risk.

Release plans include parent and variant changes together. Asset release summaries distinguish parent-only, variant-only, and parent-plus-variant changes where possible. Placement keys referenced by variants are checked against the target environment and surfaced as release risk flags when missing.

## Deliberate Limits

This is not a DAM. There is no binary upload workflow, rights management, AI generation, market inheritance tree, or replacement for Engage templates. Variants are practical scoped payload rows, resolved deterministically at runtime.

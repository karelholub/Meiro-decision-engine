# Client SDKs

This repository now includes lightweight client SDK scaffolding for Decisioning in-app delivery and tracking:

- Web TypeScript SDK: `packages/sdk-web`
- Android Kotlin SDK: `packages/sdk-android`
- iOS Swift SDK: `packages/sdk-ios`

Scope is intentionally narrow: SDKs call decide + event endpoints, handle reliability concerns, and return payloads for app-owned rendering.

## Supported Endpoints

Primary:

- `POST /v2/inapp/decide`
- `POST /v2/inapp/events`

Optional fallback:

- `POST /v1/evaluate` (used by Web SDK when enabled and v2 decide is unavailable)
- `GET /v1/requirements/decision/:key` (integration-time diagnostics only)

## Common SDK API

All clients expose the same conceptual API:

- `setProfileId(profileId)`
- `setAnonymousId(anonymousId)`
- `setLookup(attribute, value)`
- `decide({ placement, context?, decisionKey?, stackKey? })`
- `trackImpression(target, context?)`
- `trackClick(target, context?)`
- `trackDismiss(target, context?)`
- `flushEvents()` (mobile)

## Integration Steps

1. Configure SDK with:
- `baseUrl`
- auth (`Authorization: Bearer` or `X-API-KEY`)
- optional `X-ENV`
- `appKey`
- `defaultContext`

2. Set identity:
- preferred: `profileId`
- fallback: `anonymousId`
- optional lookup identity: `setLookup(attribute, value)`

3. Request decision:
- call `decide({ placement })`
- if `show: true`, render `payload` in your app UI

4. Track lifecycle:
- `trackImpression` on render
- `trackClick` on CTA interaction
- `trackDismiss` when user closes

## Reliability Defaults

- Decide timeout:
  - web: `250ms`
  - mobile: `500ms`
- Events timeout: `1000ms`
- Decide retries: `1` network retry max
- Events retries: `1` retry with short backoff
- Caching:
  - TTL from `ttl_seconds` response
  - fallback TTL: `60s`
  - stale-if-error window: `30m`
- Idempotency:
  - `X-Request-Id` for decide
  - `eventId` + `X-Event-Id` for events

## Mobile Persistence

- Android:
  - in-memory defaults: `InMemoryDecideCacheStore`, `InMemoryEventQueueStore`
  - persistent options: `FileDecideCacheStore`, `FileEventQueueStore`
  - adapter-based options: `PreferencesDecideCacheStore`, `PreferencesEventQueueStore` via `KeyValueStore`
- iOS:
  - in-memory defaults: `MemoryDecideCacheStore`, `MemoryEventQueueStore`
  - persistent options: `UserDefaultsDecideCacheStore`, `UserDefaultsEventQueueStore`

## Rendering Responsibility

SDKs do not include UI rendering frameworks. Client apps own rendering of `payload` and template interpretation.

## Recommended Caching for High Volume

- Keep context allowlist tight (`locale`, `deviceType`, `appVersion`)
- Use short TTLs for rapidly changing campaigns (`30-120s`)
- Keep stale-if-error enabled (`10-30m`) to reduce failure impact
- Track cache hit/miss and stale serve rate in app telemetry

## Example Snippets

- Web example: `apps/examples/web/src/index.ts`
- Android example usage: `packages/sdk-android/README.md`
- iOS example usage: `packages/sdk-ios/README.md`

## Package Metadata & Versioning

- Web (`@decisioning/sdk-web`): npm metadata + public publish config in `packages/sdk-web/package.json`.
- Android (`sdk-android`): Maven publishing metadata in `packages/sdk-android/build.gradle.kts` and `packages/sdk-android/gradle.properties`.
- iOS (`DecisioningSDK`): SPM metadata in `packages/sdk-ios/Package.swift`; release versioning is tag-based.

# @decisioning/sdk-web

Lightweight TypeScript SDK for Decisioning in-app decide + event tracking.

## Install

```bash
pnpm add @decisioning/sdk-web
```

## Browser Bundle (Simulator Upload)

Build standalone JS files:

```bash
pnpm --filter @decisioning/sdk-web bundle
```

Output files:

- `dist/decisioning-sdk-web.iife.js` (plain `<script>` upload/use)
- `dist/decisioning-sdk-web.esm.js` (ES module environments)

IIFE global name: `DecisioningSDK` (for example `new DecisioningSDK.DecisioningWebSdk(...)`).

## Quick Start

```ts
import { DecisioningWebSdk, LocalStorageStorage } from "@decisioning/sdk-web";

const sdk = new DecisioningWebSdk({
  baseUrl: "https://api.example.com",
  // optional overrides (relative path or full URL)
  decidePath: "/v2/inapp/decide",
  eventsPath: "/v2/inapp/events",
  appKey: "meiro_store",
  environment: "PROD",
  auth: { bearerToken: "<token>" },
  defaultContext: {
    locale: "en-US",
    deviceType: "web",
    appVersion: "1.2.3"
  },
  storage: new LocalStorageStorage(),
  debug: false
});

sdk.setProfileId("p-1001");

const decision = await sdk.decide({
  placement: "home_top"
});

if (decision.show) {
  // Render decision.payload in your own UI layer.
  await sdk.trackImpression(decision);
}
```

## API

- `setProfileId(profileId)`
- `setAnonymousId(anonymousId)`
- `setLookup(attribute, value)`
- `decide({ placement, context?, decisionKey?, stackKey? })`
- `trackImpression(target, context?)`
- `trackClick(target, context?)`
- `trackDismiss(target, context?)`

Constructor config requirements:

- required: `baseUrl`, `appKey`
- optional with defaults:
  - `decidePath` (default `/v2/inapp/decide`)
  - `eventsPath` (default `/v2/inapp/events`)
  - `evaluatePath` (default `/v1/evaluate`, used for fallback)

`decidePath`/`eventsPath`/`evaluatePath` can be either relative paths or full absolute URLs.
Invalid constructor config throws `WebSdkConfigError` with a readable validation message.

## Reliability

- In-memory LRU cache + optional storage adapter.
- TTL honors `ttl_seconds` from decide response, with fallback TTL config.
- Stale-if-error support with configurable stale TTL.
- `AbortController` timeout defaults:
  - decide: `250ms`
  - events: `1000ms`
- decide retries once on network error by default.
- events retry once on network/5xx.
- adds `X-Request-Id` on every request.
- computes deterministic `eventId` and sends `X-Event-Id`.

## Security

- no payload logging by default.
- auth supports either `Authorization: Bearer` or `X-API-KEY`.
- optional `X-ENV` header.

## Versioning & Publishing

- Package uses semver in `package.json`.
- Publish metadata (`exports`, `files`, `publishConfig`) is already configured.
- Release flow: bump version, run tests, publish to npm registry.

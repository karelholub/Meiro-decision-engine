# DecisioningSDK (iOS)

Swift Package client for in-app decide and tracking.

## Features

- async/await API
- URLSession transport
- in-memory decide cache with stale-if-error
- in-memory event queue + retry + flush
- UserDefaults-backed persistent stores:
  - `UserDefaultsDecideCacheStore`
  - `UserDefaultsEventQueueStore`
- auth (`Authorization` bearer or `X-API-KEY`) + `X-ENV`

## Usage

```swift
import DecisioningSDK

let sdk = DecisioningClient(config: DecisioningConfig(
  baseUrl: URL(string: "https://api.example.com")!,
  appKey: "meiro_store",
  bearerToken: "token",
  environment: "PROD"
))

await sdk.setProfileId("p-1001")
let decision = try await sdk.decide(DecideParams(placement: "home_top"))
if decision.show {
  try await sdk.trackImpression(decision)
}
```

## Persistent Stores

```swift
let defaults = UserDefaults(suiteName: "com.example.decisioning")!
let sdk = DecisioningClient(
  config: DecisioningConfig(baseUrl: URL(string: "https://api.example.com")!, appKey: "meiro_store"),
  cacheStore: UserDefaultsDecideCacheStore(defaults: defaults),
  queueStore: UserDefaultsEventQueueStore(defaults: defaults)
)
```

## Versioning & Publishing

- Swift Package uses semantic version tags (`v0.1.0`, `v0.2.0`, ...).
- Update `Package.swift` only when API/platform settings change; release version is tag-driven.

# iOS Example

```swift
let defaults = UserDefaults(suiteName: "com.example.decisioning")!
let sdk = DecisioningClient(
  config: DecisioningConfig(
    baseUrl: URL(string: "https://api.example.com")!,
    appKey: "meiro_store",
    environment: "PROD"
  ),
  cacheStore: UserDefaultsDecideCacheStore(defaults: defaults),
  queueStore: UserDefaultsEventQueueStore(defaults: defaults)
)

await sdk.setProfileId("p-1001")
let decision = try await sdk.decide(DecideParams(placement: "home_top"))
if decision.show {
  try await sdk.trackImpression(decision)
}
```

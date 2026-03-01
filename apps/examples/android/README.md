# Android Example

```kotlin
val file = File(context.filesDir, "decisioning-sdk.db")
val sdk = DecisioningClient(
  config = DecisioningConfig(
    baseUrl = "https://api.example.com",
    appKey = "meiro_store",
    environment = "PROD"
  ),
  cacheStore = FileDecideCacheStore(file),
  queueStore = FileEventQueueStore(file)
)

sdk.setProfileId("p-1001")
val decision = sdk.decide(DecideRequest(placement = "home_top"))
if (decision.show) {
  sdk.trackImpression(decision)
}
```

For SharedPreferences persistence, implement `KeyValueStore` and pass it to `PreferencesDecideCacheStore` and `PreferencesEventQueueStore`.

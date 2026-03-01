# sdk-android

Lightweight Kotlin client for Decisioning `/v2/inapp/decide` and `/v2/inapp/events`.

## Features

- coroutine-based API (`suspend`)
- auth headers (`Authorization` bearer or `X-API-KEY`)
- optional `X-ENV`
- in-memory decide cache with stale-if-error behavior
- persistent decide cache options:
  - `FileDecideCacheStore`
  - `PreferencesDecideCacheStore` (use with a SharedPreferences-backed `KeyValueStore`)
- persistent event queue options:
  - `FileEventQueueStore`
  - `PreferencesEventQueueStore` (use with a SharedPreferences-backed `KeyValueStore`)
- event queue + retry + `flushEvents()`
- deterministic event id + `X-Event-Id`

## Usage

```kotlin
val sdk = DecisioningClient(
  config = DecisioningConfig(
    baseUrl = "https://api.example.com",
    appKey = "meiro_store",
    bearerToken = "token",
    environment = "PROD"
  )
)

sdk.setProfileId("p-1001")
val decision = sdk.decide(DecideRequest(placement = "home_top"))
if (decision.show) {
  sdk.trackImpression(decision)
}
```

## Persistent Stores

```kotlin
val file = File(context.filesDir, "decisioning-sdk.db")
val sdk = DecisioningClient(
  config = DecisioningConfig(baseUrl = "https://api.example.com", appKey = "meiro_store"),
  cacheStore = FileDecideCacheStore(file),
  queueStore = FileEventQueueStore(file)
)
```

For Android SharedPreferences, provide a `KeyValueStore` adapter that delegates to `SharedPreferences#getString` and `Editor#putString`.

## Versioning & Publishing

- Version and POM metadata are in `gradle.properties`.
- Publish config is in `build.gradle.kts` under `publishing`.
- Recommended release flow: bump `VERSION_NAME`, run tests, then publish the Maven artifact.

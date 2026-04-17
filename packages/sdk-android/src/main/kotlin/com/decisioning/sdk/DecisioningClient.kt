package com.decisioning.sdk

import java.io.File
import java.security.MessageDigest
import java.time.Instant
import java.util.Base64
import java.util.UUID
import kotlin.math.max
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

@Serializable
data class IdentityLookup(
    val attribute: String,
    val value: String
)

@Serializable
data class DecideRequest(
    val placement: String,
    val context: Map<String, JsonElement>? = null,
    val decisionKey: String? = null,
    val stackKey: String? = null
)

@Serializable
data class Tracking(
    @SerialName("campaign_id") val campaignId: String,
    @SerialName("message_id") val messageId: String,
    @SerialName("variant_id") val variantId: String,
    @SerialName("experiment_id") val experimentId: String? = null,
    @SerialName("experiment_version") val experimentVersion: Int? = null,
    @SerialName("is_holdout") val isHoldout: Boolean? = null,
    @SerialName("allocation_id") val allocationId: String? = null
)

@Serializable
data class DecideResponse(
    val show: Boolean,
    val placement: String,
    val templateId: String = "none",
    @SerialName("ttl_seconds") val ttlSeconds: Long = 0,
    val tracking: Tracking,
    val payload: Map<String, JsonElement> = emptyMap(),
    val debug: Map<String, JsonElement> = emptyMap()
)

enum class InAppEventType {
    IMPRESSION,
    CLICK,
    DISMISS
}

@Serializable
data class EventRequest(
    val eventType: String,
    val ts: String,
    val appKey: String,
    val placement: String,
    val tracking: Tracking,
    val profileId: String? = null,
    val lookup: IdentityLookup? = null,
    val context: Map<String, JsonElement>? = null,
    val eventId: String
)

@Serializable
private data class DecideRequestBodyPayload(
    val appKey: String,
    val placement: String,
    val decisionKey: String? = null,
    val stackKey: String? = null,
    val profileId: String? = null,
    val anonymousId: String? = null,
    val lookup: IdentityLookup? = null,
    val context: Map<String, JsonElement>? = null
)

data class DecisioningConfig(
    val baseUrl: String,
    val appKey: String,
    val environment: String? = null,
    val bearerToken: String? = null,
    val apiKey: String? = null,
    val defaultContext: Map<String, JsonElement> = emptyMap(),
    val contextAllowlist: Set<String> = setOf("locale", "deviceType", "appVersion"),
    val decideTimeoutMs: Long = 500,
    val eventsTimeoutMs: Long = 1000,
    val cacheTtlSeconds: Long = 60,
    val staleTtlSeconds: Long = 1800,
    val debug: Boolean = false,
    val decideRetryCount: Int = 1
)

@Serializable
data class CacheEntry(
    val response: DecideResponse,
    val expiresAtMs: Long,
    val staleUntilMs: Long
)

interface DecideCacheStore {
    suspend fun get(key: String): CacheEntry?
    suspend fun put(key: String, entry: CacheEntry)
}

class InMemoryDecideCacheStore : DecideCacheStore {
    private val entries = LinkedHashMap<String, CacheEntry>()
    private val mutex = Mutex()

    override suspend fun get(key: String): CacheEntry? = mutex.withLock { entries[key] }

    override suspend fun put(key: String, entry: CacheEntry) {
        mutex.withLock {
            entries[key] = entry
            if (entries.size > 128) {
                val first = entries.keys.firstOrNull()
                if (first != null) {
                    entries.remove(first)
                }
            }
        }
    }
}

interface KeyValueStore {
    suspend fun getString(key: String): String?
    suspend fun putString(key: String, value: String)
    suspend fun remove(key: String)
}

class InMemoryKeyValueStore : KeyValueStore {
    private val map = mutableMapOf<String, String>()
    private val mutex = Mutex()

    override suspend fun getString(key: String): String? = mutex.withLock { map[key] }

    override suspend fun putString(key: String, value: String) {
        mutex.withLock { map[key] = value }
    }

    override suspend fun remove(key: String) {
        mutex.withLock { map.remove(key) }
    }
}

class FileKeyValueStore(private val file: File) : KeyValueStore {
    private val mutex = Mutex()

    override suspend fun getString(key: String): String? = mutex.withLock {
        readState()[key]
    }

    override suspend fun putString(key: String, value: String) {
        mutex.withLock {
            val state = readState().toMutableMap()
            state[key] = value
            writeState(state)
        }
    }

    override suspend fun remove(key: String) {
        mutex.withLock {
            val state = readState().toMutableMap()
            state.remove(key)
            writeState(state)
        }
    }

    private fun readState(): Map<String, String> {
        if (!file.exists()) {
            return emptyMap()
        }
        val raw = file.readText().trim()
        if (raw.isEmpty()) {
            return emptyMap()
        }
        return raw.lineSequence()
            .mapNotNull { line ->
                val idx = line.indexOf("=")
                if (idx <= 0) {
                    null
                } else {
                    val decoded = runCatching {
                        String(Base64.getDecoder().decode(line.substring(idx + 1)))
                    }.getOrNull()
                    if (decoded == null) {
                        null
                    } else {
                        line.substring(0, idx) to decoded
                    }
                }
            }
            .toMap()
    }

    private fun writeState(state: Map<String, String>) {
        file.parentFile?.mkdirs()
        val content = state.entries.joinToString("\n") {
            "${it.key}=${Base64.getEncoder().encodeToString(it.value.toByteArray())}"
        }
        file.writeText(content)
    }
}

open class PreferencesDecideCacheStore(
    private val store: KeyValueStore,
    private val namespace: String = "decisioning:decide",
    private val json: Json = Json { ignoreUnknownKeys = true }
) : DecideCacheStore {
    override suspend fun get(key: String): CacheEntry? {
        val raw = store.getString("$namespace:$key") ?: return null
        return runCatching { json.decodeFromString<CacheEntry>(raw) }.getOrNull()
    }

    override suspend fun put(key: String, entry: CacheEntry) {
        store.putString("$namespace:$key", json.encodeToString(entry))
    }
}

class FileDecideCacheStore(
    file: File,
    namespace: String = "decisioning:decide",
    json: Json = Json { ignoreUnknownKeys = true }
) : PreferencesDecideCacheStore(
    store = FileKeyValueStore(file),
    namespace = namespace,
    json = json
)

interface EventQueueStore {
    suspend fun add(event: EventRequest)
    suspend fun list(): List<EventRequest>
    suspend fun remove(eventIds: Set<String>)
}

class InMemoryEventQueueStore : EventQueueStore {
    private val queue = mutableListOf<EventRequest>()
    private val mutex = Mutex()

    override suspend fun add(event: EventRequest) {
        mutex.withLock { queue.add(event) }
    }

    override suspend fun list(): List<EventRequest> = mutex.withLock { queue.toList() }

    override suspend fun remove(eventIds: Set<String>) {
        mutex.withLock {
            queue.removeAll { it.eventId in eventIds }
        }
    }
}

open class PreferencesEventQueueStore(
    private val store: KeyValueStore,
    private val key: String = "decisioning:event-queue",
    private val json: Json = Json { ignoreUnknownKeys = true; encodeDefaults = true }
) : EventQueueStore {
    private val mutex = Mutex()

    override suspend fun add(event: EventRequest) {
        mutex.withLock {
            val queue = loadQueue().toMutableList()
            queue.add(event)
            store.putString(key, json.encodeToString(queue))
        }
    }

    override suspend fun list(): List<EventRequest> = mutex.withLock { loadQueue() }

    override suspend fun remove(eventIds: Set<String>) {
        mutex.withLock {
            val queue = loadQueue().filterNot { it.eventId in eventIds }
            store.putString(key, json.encodeToString(queue))
        }
    }

    private suspend fun loadQueue(): List<EventRequest> {
        val raw = store.getString(key) ?: return emptyList()
        return runCatching { json.decodeFromString<List<EventRequest>>(raw) }.getOrElse { emptyList() }
    }
}

class FileEventQueueStore(
    file: File,
    key: String = "decisioning:event-queue",
    json: Json = Json { ignoreUnknownKeys = true; encodeDefaults = true }
) : PreferencesEventQueueStore(
    store = FileKeyValueStore(file),
    key = key,
    json = json
)

class DecisioningClient(
    private val config: DecisioningConfig,
    private val cacheStore: DecideCacheStore = InMemoryDecideCacheStore(),
    private val queueStore: EventQueueStore = InMemoryEventQueueStore(),
    private val json: Json = Json { ignoreUnknownKeys = true; encodeDefaults = true },
    private val client: OkHttpClient = OkHttpClient(),
    private val nowMs: () -> Long = { System.currentTimeMillis() }
) {
    private var profileId: String? = null
    private var anonymousId: String? = null
    private var lookup: IdentityLookup? = null

    fun setProfileId(value: String) {
        profileId = value
    }

    fun setAnonymousId(value: String) {
        anonymousId = value
    }

    fun setLookup(attribute: String, value: String) {
        lookup = IdentityLookup(attribute = attribute, value = value)
    }

    suspend fun decide(input: DecideRequest): DecideResponse {
        val mergedContext = config.defaultContext + (input.context ?: emptyMap())
        val cacheKey = buildCacheKey(input.placement, mergedContext)
        val now = nowMs()

        val fresh = cacheStore.get(cacheKey)
        if (fresh != null && fresh.expiresAtMs > now) {
            return fresh.response
        }

        return try {
            val response = decideWithRetry(input, mergedContext, config.decideRetryCount)
            val ttl = if (response.ttlSeconds > 0) response.ttlSeconds else config.cacheTtlSeconds
            val entry = CacheEntry(
                response = response,
                expiresAtMs = now + ttl * 1_000,
                staleUntilMs = now + (ttl + config.staleTtlSeconds) * 1_000
            )
            cacheStore.put(cacheKey, entry)
            response
        } catch (error: Throwable) {
            val stale = cacheStore.get(cacheKey)
            if (stale != null && stale.staleUntilMs > nowMs()) {
                stale.response
            } else {
                throw error
            }
        }
    }

    suspend fun trackImpression(target: DecideResponse, context: Map<String, JsonElement> = emptyMap()) {
        track(InAppEventType.IMPRESSION, target, context)
    }

    suspend fun trackClick(target: DecideResponse, context: Map<String, JsonElement> = emptyMap()) {
        track(InAppEventType.CLICK, target, context)
    }

    suspend fun trackDismiss(target: DecideResponse, context: Map<String, JsonElement> = emptyMap()) {
        track(InAppEventType.DISMISS, target, context)
    }

    suspend fun flushEvents() {
        val snapshot = queueStore.list()
        if (snapshot.isEmpty()) {
            return
        }

        val sent = mutableSetOf<String>()
        for (event in snapshot) {
            val success = sendEventWithRetry(event)
            if (success) {
                sent.add(event.eventId)
            }
        }

        if (sent.isNotEmpty()) {
            queueStore.remove(sent)
        }
    }

    suspend fun pendingEventCount(): Int = queueStore.list().size

    internal fun buildCacheKey(placement: String, context: Map<String, JsonElement>): String {
        val identity = when {
            !profileId.isNullOrBlank() -> "profile:$profileId"
            lookup != null -> "lookup:${lookup?.attribute}:${lookup?.value}"
            !anonymousId.isNullOrBlank() -> "anonymous:$anonymousId"
            else -> "identity:unknown"
        }
        val allowed = context.filterKeys { it in config.contextAllowlist }.toSortedMap()
        return "${config.appKey}:$placement:$identity:$allowed".sha256Hex()
    }

    private suspend fun decideWithRetry(
        input: DecideRequest,
        mergedContext: Map<String, JsonElement>,
        retries: Int
    ): DecideResponse {
        return try {
            requestDecide(input, mergedContext)
        } catch (error: Throwable) {
            if (retries <= 0 || !isNetworkError(error)) {
                throw error
            }
            requestDecide(input, mergedContext)
        }
    }

    private suspend fun requestDecide(input: DecideRequest, mergedContext: Map<String, JsonElement>): DecideResponse {
        val body = DecideRequestBodyPayload(
            appKey = config.appKey,
            placement = input.placement,
            decisionKey = input.decisionKey,
            stackKey = input.stackKey,
            profileId = profileId,
            anonymousId = anonymousId,
            lookup = lookup,
            context = mergedContext
        )

        val request = buildRequest("/v2/inapp/decide", json.encodeToString(body), config.decideTimeoutMs)
        val response = execute(request)
        if (!response.isSuccessful) {
            throw RuntimeException("decide failed: ${response.code}")
        }

        val payload = response.body?.string().orEmpty()
        return json.decodeFromString(payload)
    }

    private suspend fun track(type: InAppEventType, target: DecideResponse, context: Map<String, JsonElement>) {
        val ts = Instant.ofEpochMilli(nowMs()).toString()
        val tsBucket = max(1, nowMs() / 60_000)
        val eventId = "${target.tracking.messageId}:${type.name}:$tsBucket".sha256Hex()
        val event = EventRequest(
            eventType = type.name,
            ts = ts,
            appKey = config.appKey,
            placement = target.placement,
            tracking = target.tracking,
            profileId = profileId ?: anonymousId,
            lookup = lookup,
            context = config.defaultContext + context,
            eventId = eventId
        )

        queueStore.add(event)
        flushEvents()
    }

    private suspend fun sendEventWithRetry(event: EventRequest): Boolean {
        val request = buildRequest("/v2/inapp/events", json.encodeToString(event), config.eventsTimeoutMs, event.eventId)
        val first = execute(request)
        if (first.isSuccessful) {
            return true
        }

        if (first.code < 500) {
            return false
        }

        delay(150)
        val second = execute(request)
        return second.isSuccessful
    }

    private fun buildRequest(path: String, payloadJson: String, timeoutMs: Long, eventId: String? = null): Request {
        val builder = Request.Builder()
            .url("${config.baseUrl.removeSuffix("/")}$path")
            .post(payloadJson.toRequestBody("application/json".toMediaType()))
            .header("Content-Type", "application/json")
            .header("X-Request-Id", UUID.randomUUID().toString())

        if (!config.environment.isNullOrBlank()) {
            builder.header("X-ENV", config.environment)
        }
        if (!config.bearerToken.isNullOrBlank()) {
            builder.header("Authorization", "Bearer ${config.bearerToken}")
        } else if (!config.apiKey.isNullOrBlank()) {
            builder.header("X-API-KEY", config.apiKey)
        }
        if (!eventId.isNullOrBlank()) {
            builder.header("X-Event-Id", eventId)
        }

        return builder.tag(Long::class.java, timeoutMs).build()
    }

    private suspend fun execute(request: Request) = withContext(Dispatchers.IO) {
        val timeoutMs = request.tag(Long::class.java) ?: config.eventsTimeoutMs
        val scoped = client.newBuilder().callTimeout(java.time.Duration.ofMillis(timeoutMs)).build()
        scoped.newCall(request).execute()
    }

    private fun isNetworkError(error: Throwable): Boolean {
        return error is java.io.IOException
    }
}

private fun String.sha256Hex(): String {
    val bytes = MessageDigest.getInstance("SHA-256").digest(toByteArray())
    return bytes.joinToString("") { "%02x".format(it) }
}

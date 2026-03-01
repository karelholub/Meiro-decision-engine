package com.decisioning.sdk

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonPrimitive
import java.io.File
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer

class DecisioningClientTest {
    @Test
    fun cacheKeyingUsesAllowedContextAndIdentity() = runTest {
        val client = DecisioningClient(
            config = DecisioningConfig(
                baseUrl = "https://example.com",
                appKey = "meiro_store",
                contextAllowlist = setOf("locale", "deviceType")
            )
        )
        client.setProfileId("p-1001")

        val keyA = client.buildCacheKey(
            placement = "home_top",
            context = mapOf("locale" to JsonPrimitive("en-US"), "deviceType" to JsonPrimitive("android"), "ignored" to JsonPrimitive("x"))
        )
        val keyB = client.buildCacheKey(
            placement = "home_top",
            context = mapOf("locale" to JsonPrimitive("en-US"), "deviceType" to JsonPrimitive("android"))
        )

        assertEquals(keyA, keyB)
    }

    @Test
    fun flushRetriesQueuedEvent() = runTest {
        val server = MockWebServer()
        server.enqueue(MockResponse().setResponseCode(500).setBody("{}"))
        server.enqueue(MockResponse().setResponseCode(202).setBody("{\"status\":\"accepted\"}"))
        server.start()

        try {
            val client = DecisioningClient(
                config = DecisioningConfig(
                    baseUrl = server.url("/").toString(),
                    appKey = "meiro_store"
                )
            )
            client.setProfileId("p-1001")

            client.trackImpression(
                DecideResponse(
                    show = true,
                    placement = "home_top",
                    tracking = Tracking("c-1", "m-1", "A")
                )
            )

            assertEquals(0, client.pendingEventCount())
            assertEquals(2, server.requestCount)
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun fileStoresPersistAcrossInstances() = runTest {
        val file = File.createTempFile("decisioning-sdk", ".db")
        try {
            val cacheStore = FileDecideCacheStore(file)
            val queueStore = FileEventQueueStore(file)

            val entry = CacheEntry(
                response = DecideResponse(
                    show = true,
                    placement = "home_top",
                    tracking = Tracking("c-1", "m-1", "A")
                ),
                expiresAtMs = 2_000_000,
                staleUntilMs = 2_100_000
            )

            cacheStore.put("k1", entry)
            queueStore.add(
                EventRequest(
                    eventType = "IMPRESSION",
                    ts = "2026-01-01T00:00:00Z",
                    appKey = "meiro_store",
                    placement = "home_top",
                    tracking = Tracking("c-1", "m-1", "A"),
                    eventId = "event-1"
                )
            )

            val cacheStoreReloaded = FileDecideCacheStore(file)
            val queueStoreReloaded = FileEventQueueStore(file)

            assertEquals("home_top", cacheStoreReloaded.get("k1")?.response?.placement)
            assertEquals(1, queueStoreReloaded.list().size)
        } finally {
            file.delete()
        }
    }
}

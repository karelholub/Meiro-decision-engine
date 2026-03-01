import XCTest
@testable import DecisioningSDK

final class DecisioningClientTests: XCTestCase {
    func testCacheKeyUsesAllowlist() async {
        let config = DecisioningConfig(
            baseUrl: URL(string: "https://example.com")!,
            appKey: "meiro_store",
            contextAllowlist: ["locale", "deviceType"]
        )
        let client = DecisioningClient(config: config)
        await client.setProfileId("p-1001")

        let keyA = await client.buildCacheKey(
            placement: "home_top",
            context: [
                "locale": .string("en-US"),
                "deviceType": .string("ios"),
                "ignored": .string("x")
            ]
        )
        let keyB = await client.buildCacheKey(
            placement: "home_top",
            context: [
                "locale": .string("en-US"),
                "deviceType": .string("ios")
            ]
        )

        XCTAssertEqual(keyA, keyB)
    }

    func testBuildRequestAddsHeaders() async throws {
        let config = DecisioningConfig(
            baseUrl: URL(string: "https://example.com")!,
            appKey: "meiro_store",
            bearerToken: "token",
            environment: "PROD"
        )
        let client = DecisioningClient(config: config)

        let request = try await client.buildRequest(
            path: "/v2/inapp/events",
            body: EventRequest(
                eventType: .impression,
                ts: ISO8601DateFormatter().string(from: Date()),
                appKey: "meiro_store",
                placement: "home_top",
                tracking: Tracking(campaign_id: "c", message_id: "m", variant_id: "A"),
                profileId: "p-1001",
                lookup: nil,
                context: nil,
                eventId: "event-1"
            ),
            timeoutMs: 1000,
            eventId: "event-1"
        )

        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer token")
        XCTAssertEqual(request.value(forHTTPHeaderField: "X-ENV"), "PROD")
        XCTAssertEqual(request.value(forHTTPHeaderField: "X-Event-Id"), "event-1")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")
    }

    func testUserDefaultsStoresPersist() async {
        let suite = "DecisioningSDKTests.\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("failed to create user defaults suite")
            return
        }
        defaults.removePersistentDomain(forName: suite)

        let cache = UserDefaultsDecideCacheStore(defaults: defaults, prefix: "decisioning.decide")
        let queue = UserDefaultsEventQueueStore(defaults: defaults, key: "decisioning.eventQueue")

        await cache.put(
            key: "k1",
            value: CacheEntry(
                response: DecideResponse(
                    show: true,
                    placement: "home_top",
                    templateId: "banner",
                    ttl_seconds: 60,
                    tracking: Tracking(campaign_id: "c", message_id: "m", variant_id: "A"),
                    payload: [:],
                    debug: nil
                ),
                expiresAt: Date().addingTimeInterval(10),
                staleUntil: Date().addingTimeInterval(20)
            )
        )
        await queue.enqueue(
            EventRequest(
                eventType: .impression,
                ts: ISO8601DateFormatter().string(from: Date()),
                appKey: "meiro_store",
                placement: "home_top",
                tracking: Tracking(campaign_id: "c", message_id: "m", variant_id: "A"),
                profileId: "p-1001",
                lookup: nil,
                context: nil,
                eventId: "event-1"
            )
        )

        let loadedCache = await cache.get(key: "k1")
        let loadedQueue = await queue.list()
        XCTAssertEqual(loadedCache?.response.placement, "home_top")
        XCTAssertEqual(loadedQueue.count, 1)
    }
}

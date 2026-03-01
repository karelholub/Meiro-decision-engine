import CryptoKit
import Foundation

public enum InAppEventType: String, Codable, Sendable {
    case impression = "IMPRESSION"
    case click = "CLICK"
    case dismiss = "DISMISS"
}

public struct IdentityLookup: Codable, Sendable {
    public let attribute: String
    public let value: String

    public init(attribute: String, value: String) {
        self.attribute = attribute
        self.value = value
    }
}

public struct Tracking: Codable, Sendable {
    public let campaign_id: String
    public let message_id: String
    public let variant_id: String

    public init(campaign_id: String, message_id: String, variant_id: String) {
        self.campaign_id = campaign_id
        self.message_id = message_id
        self.variant_id = variant_id
    }
}

public enum JSONValue: Codable, Sendable, Equatable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case object([String: JSONValue])
    case array([JSONValue])
    case null

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([String: JSONValue].self) {
            self = .object(value)
        } else if let value = try? container.decode([JSONValue].self) {
            self = .array(value)
        } else {
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Unsupported JSONValue")
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let value):
            try container.encode(value)
        case .number(let value):
            try container.encode(value)
        case .bool(let value):
            try container.encode(value)
        case .object(let value):
            try container.encode(value)
        case .array(let value):
            try container.encode(value)
        case .null:
            try container.encodeNil()
        }
    }
}

public struct DecideParams: Sendable {
    public let placement: String
    public let context: [String: JSONValue]?
    public let decisionKey: String?
    public let stackKey: String?

    public init(
        placement: String,
        context: [String: JSONValue]? = nil,
        decisionKey: String? = nil,
        stackKey: String? = nil
    ) {
        self.placement = placement
        self.context = context
        self.decisionKey = decisionKey
        self.stackKey = stackKey
    }
}

public struct DecideResponse: Codable, Sendable {
    public let show: Bool
    public let placement: String
    public let templateId: String
    public let ttl_seconds: Int
    public let tracking: Tracking
    public let payload: [String: JSONValue]
    public let debug: [String: JSONValue]?
}

public struct DecisioningConfig: Sendable {
    public let baseUrl: URL
    public let appKey: String
    public let bearerToken: String?
    public let apiKey: String?
    public let environment: String?
    public let defaultContext: [String: JSONValue]
    public let contextAllowlist: Set<String>
    public let decideTimeoutMs: TimeInterval
    public let eventsTimeoutMs: TimeInterval
    public let cacheTtlSeconds: Int
    public let staleTtlSeconds: Int
    public let decideRetryCount: Int
    public let debug: Bool

    public init(
        baseUrl: URL,
        appKey: String,
        bearerToken: String? = nil,
        apiKey: String? = nil,
        environment: String? = nil,
        defaultContext: [String: JSONValue] = [:],
        contextAllowlist: Set<String> = ["locale", "deviceType", "appVersion"],
        decideTimeoutMs: TimeInterval = 500,
        eventsTimeoutMs: TimeInterval = 1_000,
        cacheTtlSeconds: Int = 60,
        staleTtlSeconds: Int = 1_800,
        decideRetryCount: Int = 1,
        debug: Bool = false
    ) {
        self.baseUrl = baseUrl
        self.appKey = appKey
        self.bearerToken = bearerToken
        self.apiKey = apiKey
        self.environment = environment
        self.defaultContext = defaultContext
        self.contextAllowlist = contextAllowlist
        self.decideTimeoutMs = decideTimeoutMs
        self.eventsTimeoutMs = eventsTimeoutMs
        self.cacheTtlSeconds = cacheTtlSeconds
        self.staleTtlSeconds = staleTtlSeconds
        self.decideRetryCount = decideRetryCount
        self.debug = debug
    }
}

public struct EventTarget: Sendable {
    public let placement: String
    public let tracking: Tracking

    public init(placement: String, tracking: Tracking) {
        self.placement = placement
        self.tracking = tracking
    }
}

public struct CacheEntry: Codable, Sendable {
    public let response: DecideResponse
    public let expiresAt: Date
    public let staleUntil: Date
}

public protocol DecideCacheStore: Sendable {
    func get(key: String) async -> CacheEntry?
    func put(key: String, value: CacheEntry) async
}

public actor MemoryDecideCacheStore: DecideCacheStore {
    private var storage: [String: CacheEntry] = [:]

    public init() {}

    public func get(key: String) async -> CacheEntry? {
        storage[key]
    }

    public func put(key: String, value: CacheEntry) async {
        storage[key] = value
    }
}

public actor UserDefaultsDecideCacheStore: DecideCacheStore {
    private let defaults: UserDefaults
    private let prefix: String
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    public init(defaults: UserDefaults = .standard, prefix: String = "decisioning.decide") {
        self.defaults = defaults
        self.prefix = prefix
    }

    public func get(key: String) async -> CacheEntry? {
        guard let data = defaults.data(forKey: "\(prefix).\(key)") else {
            return nil
        }
        return try? decoder.decode(CacheEntry.self, from: data)
    }

    public func put(key: String, value: CacheEntry) async {
        guard let data = try? encoder.encode(value) else {
            return
        }
        defaults.set(data, forKey: "\(prefix).\(key)")
    }
}

public protocol EventQueueStore: Sendable {
    func enqueue(_ event: EventRequest) async
    func list() async -> [EventRequest]
    func remove(ids: Set<String>) async
}

public actor MemoryEventQueueStore: EventQueueStore {
    private var queue: [EventRequest] = []

    public init() {}

    public func enqueue(_ event: EventRequest) async {
        queue.append(event)
    }

    public func list() async -> [EventRequest] {
        queue
    }

    public func remove(ids: Set<String>) async {
        queue.removeAll { ids.contains($0.eventId) }
    }
}

public actor UserDefaultsEventQueueStore: EventQueueStore {
    private let defaults: UserDefaults
    private let key: String
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    public init(defaults: UserDefaults = .standard, key: String = "decisioning.eventQueue") {
        self.defaults = defaults
        self.key = key
    }

    public func enqueue(_ event: EventRequest) async {
        var queue = await list()
        queue.append(event)
        persist(queue)
    }

    public func list() async -> [EventRequest] {
        guard let data = defaults.data(forKey: key) else {
            return []
        }
        return (try? decoder.decode([EventRequest].self, from: data)) ?? []
    }

    public func remove(ids: Set<String>) async {
        let filtered = await list().filter { !ids.contains($0.eventId) }
        persist(filtered)
    }

    private func persist(_ queue: [EventRequest]) {
        guard let data = try? encoder.encode(queue) else {
            return
        }
        defaults.set(data, forKey: key)
    }
}

public struct EventRequest: Codable, Sendable {
    public let eventType: InAppEventType
    public let ts: String
    public let appKey: String
    public let placement: String
    public let tracking: Tracking
    public let profileId: String?
    public let lookup: IdentityLookup?
    public let context: [String: JSONValue]?
    public let eventId: String
}

public actor DecisioningClient {
    private let config: DecisioningConfig
    private let session: URLSession
    private let cacheStore: DecideCacheStore
    private let queueStore: EventQueueStore
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    private var profileId: String?
    private var anonymousId: String?
    private var lookup: IdentityLookup?

    public init(
        config: DecisioningConfig,
        session: URLSession = .shared,
        cacheStore: DecideCacheStore = MemoryDecideCacheStore(),
        queueStore: EventQueueStore = MemoryEventQueueStore()
    ) {
        self.config = config
        self.session = session
        self.cacheStore = cacheStore
        self.queueStore = queueStore
    }

    public func setProfileId(_ value: String) {
        profileId = value
    }

    public func setAnonymousId(_ value: String) {
        anonymousId = value
    }

    public func setLookup(attribute: String, value: String) {
        lookup = IdentityLookup(attribute: attribute, value: value)
    }

    public func decide(_ params: DecideParams) async throws -> DecideResponse {
        let mergedContext = config.defaultContext.merging(params.context ?? [:], uniquingKeysWith: { _, rhs in rhs })
        let key = buildCacheKey(placement: params.placement, context: mergedContext)

        if let cached = await cacheStore.get(key: key), cached.expiresAt > Date() {
            return cached.response
        }

        do {
            let response = try await decideWithRetry(params: params, mergedContext: mergedContext, retries: config.decideRetryCount)
            let ttl = max(1, response.ttl_seconds > 0 ? response.ttl_seconds : config.cacheTtlSeconds)
            let now = Date()
            let entry = CacheEntry(
                response: response,
                expiresAt: now.addingTimeInterval(Double(ttl)),
                staleUntil: now.addingTimeInterval(Double(ttl + config.staleTtlSeconds))
            )
            await cacheStore.put(key: key, value: entry)
            return response
        } catch {
            if let stale = await cacheStore.get(key: key), stale.staleUntil > Date() {
                return stale.response
            }
            throw error
        }
    }

    public func trackImpression(_ target: DecideResponse, context: [String: JSONValue] = [:]) async throws {
        try await track(.impression, target: EventTarget(placement: target.placement, tracking: target.tracking), context: context)
    }

    public func trackClick(_ target: DecideResponse, context: [String: JSONValue] = [:]) async throws {
        try await track(.click, target: EventTarget(placement: target.placement, tracking: target.tracking), context: context)
    }

    public func trackDismiss(_ target: DecideResponse, context: [String: JSONValue] = [:]) async throws {
        try await track(.dismiss, target: EventTarget(placement: target.placement, tracking: target.tracking), context: context)
    }

    public func flushEvents() async throws {
        let snapshot = await queueStore.list()
        var sent = Set<String>()

        for event in snapshot {
            if try await sendEventWithRetry(event) {
                sent.insert(event.eventId)
            }
        }

        if !sent.isEmpty {
            await queueStore.remove(ids: sent)
        }
    }

    public func pendingEventCount() async -> Int {
        await queueStore.list().count
    }

    internal func buildCacheKey(placement: String, context: [String: JSONValue]) -> String {
        let identity: String
        if let profileId {
            identity = "profile:\(profileId)"
        } else if let lookup {
            identity = "lookup:\(lookup.attribute):\(lookup.value)"
        } else if let anonymousId {
            identity = "anonymous:\(anonymousId)"
        } else {
            identity = "identity:unknown"
        }

        let allowed = context
            .filter { config.contextAllowlist.contains($0.key) }
            .sorted { $0.key < $1.key }
            .map { "\($0.key)=\($0.value)" }
            .joined(separator: "&")

        return sha256Hex("\(config.appKey):\(placement):\(identity):\(allowed)")
    }

    private func decideWithRetry(params: DecideParams, mergedContext: [String: JSONValue], retries: Int) async throws -> DecideResponse {
        do {
            return try await requestDecide(params: params, mergedContext: mergedContext)
        } catch {
            if retries <= 0 {
                throw error
            }
            return try await requestDecide(params: params, mergedContext: mergedContext)
        }
    }

    private func requestDecide(params: DecideParams, mergedContext: [String: JSONValue]) async throws -> DecideResponse {
        let payload = DecideRequestPayload(
            appKey: config.appKey,
            placement: params.placement,
            decisionKey: params.decisionKey,
            stackKey: params.stackKey,
            profileId: profileId ?? anonymousId,
            lookup: lookup,
            context: mergedContext
        )

        let request = try buildRequest(path: "/v2/inapp/decide", body: payload, timeoutMs: config.decideTimeoutMs)
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, 200..<300 ~= http.statusCode else {
            throw NSError(domain: "DecisioningClient", code: 1)
        }

        return try decoder.decode(DecideResponse.self, from: data)
    }

    private func track(_ type: InAppEventType, target: EventTarget, context: [String: JSONValue]) async throws {
        let timestamp = ISO8601DateFormatter().string(from: Date())
        let bucket = Int(Date().timeIntervalSince1970 / 60)
        let eventId = sha256Hex("\(target.tracking.message_id):\(type.rawValue):\(bucket)")

        let payload = EventRequest(
            eventType: type,
            ts: timestamp,
            appKey: config.appKey,
            placement: target.placement,
            tracking: target.tracking,
            profileId: profileId ?? anonymousId,
            lookup: lookup,
            context: config.defaultContext.merging(context, uniquingKeysWith: { _, rhs in rhs }),
            eventId: eventId
        )

        await queueStore.enqueue(payload)
        try await flushEvents()
    }

    private func sendEventWithRetry(_ payload: EventRequest) async throws -> Bool {
        let request = try buildRequest(path: "/v2/inapp/events", body: payload, timeoutMs: config.eventsTimeoutMs, eventId: payload.eventId)

        let first = try await session.data(for: request)
        if let response = first.1 as? HTTPURLResponse {
            if 200..<300 ~= response.statusCode {
                return true
            }
            if response.statusCode < 500 {
                return false
            }
        }

        try await Task.sleep(nanoseconds: 150_000_000)
        let second = try await session.data(for: request)
        if let response = second.1 as? HTTPURLResponse {
            return 200..<300 ~= response.statusCode
        }
        return false
    }

    internal func buildRequest<T: Encodable>(
        path: String,
        body: T,
        timeoutMs: TimeInterval,
        eventId: String? = nil
    ) throws -> URLRequest {
        let url = config.baseUrl.appendingPathComponent(path.replacingOccurrences(of: "^/", with: "", options: .regularExpression))
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = timeoutMs / 1000
        request.httpBody = try encoder.encode(body)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(UUID().uuidString, forHTTPHeaderField: "X-Request-Id")

        if let environment = config.environment {
            request.setValue(environment, forHTTPHeaderField: "X-ENV")
        }
        if let bearerToken = config.bearerToken {
            request.setValue("Bearer \(bearerToken)", forHTTPHeaderField: "Authorization")
        } else if let apiKey = config.apiKey {
            request.setValue(apiKey, forHTTPHeaderField: "X-API-KEY")
        }
        if let eventId {
            request.setValue(eventId, forHTTPHeaderField: "X-Event-Id")
        }
        return request
    }
}

private struct DecideRequestPayload: Encodable {
    let appKey: String
    let placement: String
    let decisionKey: String?
    let stackKey: String?
    let profileId: String?
    let lookup: IdentityLookup?
    let context: [String: JSONValue]?
}

private func sha256Hex(_ string: String) -> String {
    let digest = SHA256.hash(data: Data(string.utf8))
    return digest.map { String(format: "%02x", $0) }.joined()
}

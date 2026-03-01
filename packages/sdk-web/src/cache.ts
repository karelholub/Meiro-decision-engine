import type { CacheEntry, DecideResponse, StorageAdapter } from "./types";
import { fnv1aHash, pickContextAllowlist, stableStringify } from "./utils";

export interface DecideCacheConfig {
  storage: StorageAdapter;
  appKey: string;
  allowlist: string[];
  staleTtlSeconds: number;
  fallbackTtlSeconds: number;
  maxEntries: number;
  now: () => number;
}

export class DecideCache {
  private readonly memory = new Map<string, CacheEntry>();

  constructor(private readonly config: DecideCacheConfig) {}

  buildKey(input: {
    placement: string;
    profileId?: string;
    anonymousId?: string;
    lookup?: { attribute: string; value: string };
    context?: Record<string, unknown>;
  }): string {
    const identity = input.profileId
      ? `profile:${input.profileId}`
      : input.lookup
        ? `lookup:${input.lookup.attribute}:${input.lookup.value}`
        : input.anonymousId
          ? `anonymous:${input.anonymousId}`
          : "identity:unknown";

    const contextHash = stableStringify(pickContextAllowlist(input.context, this.config.allowlist));
    const raw = `${this.config.appKey}:${input.placement}:${identity}:${contextHash}`;
    return `inapp:${fnv1aHash(raw)}`;
  }

  getFresh(key: string): DecideResponse | null {
    const entry = this.getEntry(key);
    if (!entry) {
      return null;
    }
    if (entry.expiresAtMs < this.config.now()) {
      return null;
    }
    this.touchMemoryEntry(key, entry);
    return entry.response;
  }

  getStale(key: string): DecideResponse | null {
    const entry = this.getEntry(key);
    if (!entry) {
      return null;
    }
    if (entry.staleExpiresAtMs < this.config.now()) {
      return null;
    }
    this.touchMemoryEntry(key, entry);
    return entry.response;
  }

  set(key: string, response: DecideResponse): void {
    const ttlSeconds = response.ttl_seconds > 0 ? response.ttl_seconds : this.config.fallbackTtlSeconds;
    const now = this.config.now();
    const entry: CacheEntry = {
      response,
      expiresAtMs: now + ttlSeconds * 1000,
      staleExpiresAtMs: now + (ttlSeconds + this.config.staleTtlSeconds) * 1000
    };

    this.memory.set(key, entry);
    this.config.storage.set(key, entry);
    this.evictIfNeeded();
  }

  private getEntry(key: string): CacheEntry | null {
    const inMemory = this.memory.get(key);
    if (inMemory) {
      return inMemory;
    }
    const persisted = this.config.storage.get<CacheEntry>(key);
    if (!persisted) {
      return null;
    }
    this.memory.set(key, persisted);
    this.evictIfNeeded();
    return persisted;
  }

  private touchMemoryEntry(key: string, entry: CacheEntry): void {
    this.memory.delete(key);
    this.memory.set(key, entry);
  }

  private evictIfNeeded(): void {
    while (this.memory.size > this.config.maxEntries) {
      const oldest = this.memory.keys().next().value as string | undefined;
      if (!oldest) {
        break;
      }
      this.memory.delete(oldest);
    }
  }
}

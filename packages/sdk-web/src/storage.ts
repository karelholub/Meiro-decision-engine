import type { StorageAdapter } from "./types";

export class MemoryStorage implements StorageAdapter {
  private readonly map = new Map<string, unknown>();

  get<T>(key: string): T | null {
    return (this.map.get(key) as T | undefined) ?? null;
  }

  set<T>(key: string, value: T): void {
    this.map.set(key, value);
  }

  delete(key: string): void {
    this.map.delete(key);
  }
}

export class LocalStorageStorage implements StorageAdapter {
  private readonly prefix: string;

  constructor(prefix = "decisioning-sdk") {
    this.prefix = prefix;
  }

  private keyFor(key: string): string {
    return `${this.prefix}:${key}`;
  }

  get<T>(key: string): T | null {
    if (typeof globalThis.localStorage === "undefined") {
      return null;
    }
    const raw = globalThis.localStorage.getItem(this.keyFor(key));
    if (!raw) {
      return null;
    }
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  set<T>(key: string, value: T): void {
    if (typeof globalThis.localStorage === "undefined") {
      return;
    }
    globalThis.localStorage.setItem(this.keyFor(key), JSON.stringify(value));
  }

  delete(key: string): void {
    if (typeof globalThis.localStorage === "undefined") {
      return;
    }
    globalThis.localStorage.removeItem(this.keyFor(key));
  }
}

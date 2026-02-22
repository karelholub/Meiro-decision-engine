import { randomUUID } from "node:crypto";
import net from "node:net";

export interface JsonCache {
  enabled: boolean;
  getJson<T>(key: string): Promise<T | null>;
  setJson(key: string, value: unknown, ttlSeconds: number): Promise<void>;
  del(key: string | string[]): Promise<number>;
  lock(key: string, ttlMs: number): Promise<CacheLock | null>;
  scanKeys(pattern: string): Promise<string[]>;
  quit(): Promise<void>;
}

export interface CacheLock {
  key: string;
  token: string;
  release(): Promise<boolean>;
}

type RedisResponse = string | number | null | RedisResponse[] | Error;

const LOCK_RELEASE_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`;

const encodeCommand = (args: string[]): string => {
  const chunks = [`*${args.length}\r\n`];
  for (const arg of args) {
    const size = Buffer.byteLength(arg);
    chunks.push(`$${size}\r\n${arg}\r\n`);
  }
  return chunks.join("");
};

const parseRedisResponse = (buffer: Buffer, offset = 0): { value: RedisResponse; offset: number } | null => {
  if (offset >= buffer.length) {
    return null;
  }
  const prefix = String.fromCharCode(buffer[offset] ?? 0);
  const findLineEnd = (start: number): number => buffer.indexOf("\r\n", start);

  if (prefix === "+" || prefix === "-" || prefix === ":") {
    const lineEnd = findLineEnd(offset);
    if (lineEnd === -1) {
      return null;
    }
    const raw = buffer.toString("utf8", offset + 1, lineEnd);
    if (prefix === "+") {
      return { value: raw, offset: lineEnd + 2 };
    }
    if (prefix === "-") {
      return { value: new Error(raw), offset: lineEnd + 2 };
    }
    return { value: Number.parseInt(raw, 10), offset: lineEnd + 2 };
  }

  if (prefix === "$") {
    const lineEnd = findLineEnd(offset);
    if (lineEnd === -1) {
      return null;
    }
    const size = Number.parseInt(buffer.toString("utf8", offset + 1, lineEnd), 10);
    if (Number.isNaN(size)) {
      return { value: new Error("Invalid bulk size"), offset: lineEnd + 2 };
    }
    if (size === -1) {
      return { value: null, offset: lineEnd + 2 };
    }
    const start = lineEnd + 2;
    const end = start + size;
    if (end + 2 > buffer.length) {
      return null;
    }
    const value = buffer.toString("utf8", start, end);
    return { value, offset: end + 2 };
  }

  if (prefix === "*") {
    const lineEnd = findLineEnd(offset);
    if (lineEnd === -1) {
      return null;
    }
    const count = Number.parseInt(buffer.toString("utf8", offset + 1, lineEnd), 10);
    if (Number.isNaN(count)) {
      return { value: new Error("Invalid array size"), offset: lineEnd + 2 };
    }
    if (count === -1) {
      return { value: null, offset: lineEnd + 2 };
    }
    let cursor = lineEnd + 2;
    const values: RedisResponse[] = [];
    for (let i = 0; i < count; i += 1) {
      const parsed = parseRedisResponse(buffer, cursor);
      if (!parsed) {
        return null;
      }
      values.push(parsed.value);
      cursor = parsed.offset;
    }
    return { value: values, offset: cursor };
  }

  return { value: new Error(`Unsupported Redis prefix: ${prefix}`), offset: buffer.length };
};

class NoopCache implements JsonCache {
  enabled = false;

  async getJson<T>(_key: string): Promise<T | null> {
    return null;
  }

  async setJson(_key: string, _value: unknown, _ttlSeconds: number): Promise<void> {}

  async del(_key: string | string[]): Promise<number> {
    return 0;
  }

  async lock(_key: string, _ttlMs: number): Promise<CacheLock | null> {
    return null;
  }

  async scanKeys(_pattern: string): Promise<string[]> {
    return [];
  }

  async quit(): Promise<void> {}
}

class SocketRedisCache implements JsonCache {
  enabled = true;
  private readonly host: string;
  private readonly port: number;
  private readonly username: string | null;
  private readonly password: string | null;

  constructor(
    redisUrl: string,
    private readonly onError?: (message: string, error: unknown) => void
  ) {
    const parsed = new URL(redisUrl);
    this.host = parsed.hostname;
    this.port = Number.parseInt(parsed.port || "6379", 10);
    this.username = parsed.username || null;
    this.password = parsed.password || null;
  }

  private async exec(commands: string[][]): Promise<RedisResponse[]> {
    return new Promise<RedisResponse[]>((resolve, reject) => {
      const authCommands =
        this.password !== null
          ? [["AUTH", ...(this.username ? [this.username] : []), this.password]]
          : [];
      const allCommands = [...authCommands, ...commands];
      const socket = net.createConnection({
        host: this.host,
        port: this.port
      });

      let buffer = Buffer.alloc(0);
      const responses: RedisResponse[] = [];
      const payload = allCommands.map((command) => encodeCommand(command)).join("");

      const fail = (error: unknown) => {
        socket.destroy();
        reject(error);
      };

      socket.on("connect", () => {
        socket.write(payload);
      });

      socket.on("data", (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        while (responses.length < allCommands.length) {
          const parsed = parseRedisResponse(buffer);
          if (!parsed) {
            break;
          }
          responses.push(parsed.value);
          buffer = buffer.subarray(parsed.offset);
        }

        if (responses.length === allCommands.length) {
          const authResponse = responses.slice(0, authCommands.length);
          const authError = authResponse.find((entry) => entry instanceof Error);
          if (authError instanceof Error) {
            fail(authError);
            return;
          }
          socket.end();
          resolve(responses.slice(authCommands.length));
        }
      });

      socket.on("error", fail);
      socket.setTimeout(1500, () => fail(new Error("Redis socket timeout")));
    });
  }

  private async command(args: string[]): Promise<RedisResponse | null> {
    try {
      const responses = await this.exec([args]);
      const [first] = responses;
      if (first instanceof Error) {
        throw first;
      }
      return first ?? null;
    } catch (error) {
      this.onError?.("Redis command failed", error);
      return null;
    }
  }

  async getJson<T>(key: string): Promise<T | null> {
    const response = await this.command(["GET", key]);
    if (typeof response !== "string") {
      return null;
    }
    try {
      return JSON.parse(response) as T;
    } catch {
      return null;
    }
  }

  async setJson(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    await this.command(["SET", key, JSON.stringify(value), "EX", String(Math.max(1, Math.floor(ttlSeconds)))]);
  }

  async del(key: string | string[]): Promise<number> {
    const keys = Array.isArray(key) ? key : [key];
    if (keys.length === 0) {
      return 0;
    }
    const response = await this.command(["DEL", ...keys]);
    return typeof response === "number" ? response : 0;
  }

  async lock(key: string, ttlMs: number): Promise<CacheLock | null> {
    const token = randomUUID();
    const response = await this.command(["SET", key, token, "PX", String(Math.max(50, ttlMs)), "NX"]);
    if (response !== "OK") {
      return null;
    }
    return {
      key,
      token,
      release: async () => {
        const released = await this.command(["EVAL", LOCK_RELEASE_SCRIPT, "1", key, token]);
        return released === 1;
      }
    };
  }

  async scanKeys(pattern: string): Promise<string[]> {
    const keys: string[] = [];
    let cursor = "0";
    do {
      const response = await this.command(["SCAN", cursor, "MATCH", pattern, "COUNT", "500"]);
      if (!Array.isArray(response) || response.length < 2) {
        break;
      }
      const [nextCursor, batch] = response;
      cursor = typeof nextCursor === "string" ? nextCursor : "0";
      if (Array.isArray(batch)) {
        for (const item of batch) {
          if (typeof item === "string") {
            keys.push(item);
          }
        }
      }
    } while (cursor !== "0");
    return keys;
  }

  async quit(): Promise<void> {
    await this.command(["QUIT"]);
  }
}

export const createCache = (input: {
  redisUrl?: string;
  onError?: (message: string, error: unknown) => void;
}): JsonCache => {
  if (!input.redisUrl) {
    return new NoopCache();
  }
  try {
    return new SocketRedisCache(input.redisUrl, input.onError);
  } catch (error) {
    input.onError?.("Redis initialization failed", error);
    return new NoopCache();
  }
};

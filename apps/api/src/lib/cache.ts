import { randomUUID } from "node:crypto";
import net from "node:net";

export interface JsonCache {
  enabled: boolean;
  getJson<T>(key: string): Promise<T | null>;
  setJson(key: string, value: unknown, ttlSeconds: number): Promise<void>;
  del(key: string | string[]): Promise<number>;
  lock(key: string, ttlMs: number): Promise<CacheLock | null>;
  scanKeys(pattern: string): Promise<string[]>;
  xadd?(stream: string, fields: Record<string, string>, options?: { maxLen?: number }): Promise<string | null>;
  xgroupCreate?(stream: string, group: string, options?: { startId?: string; mkstream?: boolean }): Promise<"OK" | "BUSYGROUP" | null>;
  xreadgroup?(input: {
    stream: string;
    group: string;
    consumer: string;
    count?: number;
    blockMs?: number;
    id?: string;
  }): Promise<Array<{ id: string; fields: Record<string, string> }>>;
  xack?(stream: string, group: string, ids: string[]): Promise<number>;
  xpending?(stream: string, group: string): Promise<{
    count: number;
    smallestId: string | null;
    largestId: string | null;
    consumers: Array<{ name: string; pending: number }>;
  } | null>;
  xpendingRange?(input: {
    stream: string;
    group: string;
    start?: string;
    end?: string;
    count: number;
    consumer?: string;
  }): Promise<Array<{ id: string; consumer: string; idleMs: number; deliveries: number }>>;
  xclaim?(input: {
    stream: string;
    group: string;
    consumer: string;
    minIdleMs: number;
    ids: string[];
  }): Promise<Array<{ id: string; fields: Record<string, string> }>>;
  xlen?(stream: string): Promise<number>;
  xinfoGroups?(stream: string): Promise<Array<Record<string, string | number | null>>>;
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

  async xadd(_stream: string, _fields: Record<string, string>, _options?: { maxLen?: number }): Promise<string | null> {
    return null;
  }

  async xgroupCreate(
    _stream: string,
    _group: string,
    _options?: { startId?: string; mkstream?: boolean }
  ): Promise<"OK" | "BUSYGROUP" | null> {
    return null;
  }

  async xreadgroup(_input: {
    stream: string;
    group: string;
    consumer: string;
    count?: number;
    blockMs?: number;
    id?: string;
  }): Promise<Array<{ id: string; fields: Record<string, string> }>> {
    return [];
  }

  async xack(_stream: string, _group: string, _ids: string[]): Promise<number> {
    return 0;
  }

  async xpending(
    _stream: string,
    _group: string
  ): Promise<{ count: number; smallestId: string | null; largestId: string | null; consumers: Array<{ name: string; pending: number }> } | null> {
    return null;
  }

  async xpendingRange(_input: {
    stream: string;
    group: string;
    start?: string;
    end?: string;
    count: number;
    consumer?: string;
  }): Promise<Array<{ id: string; consumer: string; idleMs: number; deliveries: number }>> {
    return [];
  }

  async xclaim(_input: {
    stream: string;
    group: string;
    consumer: string;
    minIdleMs: number;
    ids: string[];
  }): Promise<Array<{ id: string; fields: Record<string, string> }>> {
    return [];
  }

  async xlen(_stream: string): Promise<number> {
    return 0;
  }

  async xinfoGroups(_stream: string): Promise<Array<Record<string, string | number | null>>> {
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

  private parseStreamEntries(raw: RedisResponse): Array<{ id: string; fields: Record<string, string> }> {
    if (!Array.isArray(raw)) {
      return [];
    }
    const entries: Array<{ id: string; fields: Record<string, string> }> = [];
    for (const item of raw) {
      if (!Array.isArray(item) || item.length < 2) {
        continue;
      }
      const [idRaw, fieldsRaw] = item;
      if (typeof idRaw !== "string" || !Array.isArray(fieldsRaw)) {
        continue;
      }
      const fields: Record<string, string> = {};
      for (let index = 0; index < fieldsRaw.length; index += 2) {
        const key = fieldsRaw[index];
        const value = fieldsRaw[index + 1];
        if (typeof key === "string" && typeof value === "string") {
          fields[key] = value;
        }
      }
      entries.push({ id: idRaw, fields });
    }
    return entries;
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

  async xadd(stream: string, fields: Record<string, string>, options?: { maxLen?: number }): Promise<string | null> {
    const args: string[] = ["XADD", stream];
    if (options?.maxLen && Number.isFinite(options.maxLen) && options.maxLen > 0) {
      args.push("MAXLEN", "~", String(Math.floor(options.maxLen)));
    }
    args.push("*");
    for (const [field, value] of Object.entries(fields)) {
      args.push(field, value);
    }
    const response = await this.command(args);
    return typeof response === "string" ? response : null;
  }

  async xgroupCreate(
    stream: string,
    group: string,
    options?: { startId?: string; mkstream?: boolean }
  ): Promise<"OK" | "BUSYGROUP" | null> {
    const args = ["XGROUP", "CREATE", stream, group, options?.startId ?? "$"];
    if (options?.mkstream ?? true) {
      args.push("MKSTREAM");
    }

    try {
      const responses = await this.exec([args]);
      const [first] = responses;
      if (first === "OK") {
        return "OK";
      }
      if (first instanceof Error && first.message.toUpperCase().includes("BUSYGROUP")) {
        return "BUSYGROUP";
      }
      if (first instanceof Error) {
        throw first;
      }
      return null;
    } catch (error) {
      if (error instanceof Error && error.message.toUpperCase().includes("BUSYGROUP")) {
        return "BUSYGROUP";
      }
      this.onError?.("Redis XGROUP CREATE failed", error);
      return null;
    }
  }

  async xreadgroup(input: {
    stream: string;
    group: string;
    consumer: string;
    count?: number;
    blockMs?: number;
    id?: string;
  }): Promise<Array<{ id: string; fields: Record<string, string> }>> {
    const args = [
      "XREADGROUP",
      "GROUP",
      input.group,
      input.consumer,
      "COUNT",
      String(Math.max(1, Math.floor(input.count ?? 100)))
    ];
    if (typeof input.blockMs === "number" && Number.isFinite(input.blockMs) && input.blockMs >= 0) {
      args.push("BLOCK", String(Math.floor(input.blockMs)));
    }
    args.push("STREAMS", input.stream, input.id ?? ">");
    const response = await this.command(args);
    if (!Array.isArray(response) || response.length === 0) {
      return [];
    }
    const firstStream = response[0];
    if (!Array.isArray(firstStream) || firstStream.length < 2) {
      return [];
    }
    const entriesRaw = firstStream[1];
    if (entriesRaw === undefined) {
      return [];
    }
    return this.parseStreamEntries(entriesRaw);
  }

  async xack(stream: string, group: string, ids: string[]): Promise<number> {
    if (ids.length === 0) {
      return 0;
    }
    const response = await this.command(["XACK", stream, group, ...ids]);
    return typeof response === "number" ? response : 0;
  }

  async xpending(
    stream: string,
    group: string
  ): Promise<{ count: number; smallestId: string | null; largestId: string | null; consumers: Array<{ name: string; pending: number }> } | null> {
    const response = await this.command(["XPENDING", stream, group]);
    if (!Array.isArray(response) || response.length < 4) {
      return null;
    }
    const [countRaw, smallestRaw, largestRaw, consumersRaw] = response;
    const consumers: Array<{ name: string; pending: number }> = [];
    if (Array.isArray(consumersRaw)) {
      for (const consumerRaw of consumersRaw) {
        if (!Array.isArray(consumerRaw) || consumerRaw.length < 2) {
          continue;
        }
        const [nameRaw, pendingRaw] = consumerRaw;
        if (typeof nameRaw === "string" && typeof pendingRaw === "number") {
          consumers.push({ name: nameRaw, pending: pendingRaw });
        }
      }
    }
    return {
      count: typeof countRaw === "number" ? countRaw : 0,
      smallestId: typeof smallestRaw === "string" ? smallestRaw : null,
      largestId: typeof largestRaw === "string" ? largestRaw : null,
      consumers
    };
  }

  async xpendingRange(input: {
    stream: string;
    group: string;
    start?: string;
    end?: string;
    count: number;
    consumer?: string;
  }): Promise<Array<{ id: string; consumer: string; idleMs: number; deliveries: number }>> {
    const args = [
      "XPENDING",
      input.stream,
      input.group,
      input.start ?? "-",
      input.end ?? "+",
      String(Math.max(1, Math.floor(input.count)))
    ];
    if (input.consumer) {
      args.push(input.consumer);
    }
    const response = await this.command(args);
    if (!Array.isArray(response)) {
      return [];
    }
    const items: Array<{ id: string; consumer: string; idleMs: number; deliveries: number }> = [];
    for (const row of response) {
      if (!Array.isArray(row) || row.length < 4) {
        continue;
      }
      const [idRaw, consumerRaw, idleRaw, deliveriesRaw] = row;
      if (typeof idRaw === "string" && typeof consumerRaw === "string") {
        items.push({
          id: idRaw,
          consumer: consumerRaw,
          idleMs: typeof idleRaw === "number" ? idleRaw : 0,
          deliveries: typeof deliveriesRaw === "number" ? deliveriesRaw : 0
        });
      }
    }
    return items;
  }

  async xclaim(input: {
    stream: string;
    group: string;
    consumer: string;
    minIdleMs: number;
    ids: string[];
  }): Promise<Array<{ id: string; fields: Record<string, string> }>> {
    if (input.ids.length === 0) {
      return [];
    }
    const response = await this.command([
      "XCLAIM",
      input.stream,
      input.group,
      input.consumer,
      String(Math.max(0, Math.floor(input.minIdleMs))),
      ...input.ids
    ]);
    return this.parseStreamEntries(response);
  }

  async xlen(stream: string): Promise<number> {
    const response = await this.command(["XLEN", stream]);
    return typeof response === "number" ? response : 0;
  }

  async xinfoGroups(stream: string): Promise<Array<Record<string, string | number | null>>> {
    const response = await this.command(["XINFO", "GROUPS", stream]);
    if (!Array.isArray(response)) {
      return [];
    }
    const groups: Array<Record<string, string | number | null>> = [];
    for (const row of response) {
      if (!Array.isArray(row)) {
        continue;
      }
      const item: Record<string, string | number | null> = {};
      for (let index = 0; index < row.length; index += 2) {
        const key = row[index];
        const value = row[index + 1];
        if (typeof key !== "string") {
          continue;
        }
        if (typeof value === "string" || typeof value === "number") {
          item[key] = value;
        } else {
          item[key] = null;
        }
      }
      groups.push(item);
    }
    return groups;
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

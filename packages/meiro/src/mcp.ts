import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

type JsonRpcId = number | string;

type JsonRpcMessage = {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
};

export interface MeiroMcpConfig {
  enabled: boolean;
  command?: string;
  args?: string[];
  domain?: string;
  username?: string;
  password?: string;
  timeoutMs?: number;
}

export interface MeiroMcpStatus {
  enabled: boolean;
  configured: boolean;
  command: string;
  args: string[];
  domain: string | null;
  username: string | null;
  timeoutMs: number;
  missing: string[];
}

export interface MeiroMcpTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export interface MeiroMcpToolListResult {
  tools: MeiroMcpTool[];
  raw: unknown;
}

export interface MeiroMcpToolCallResult {
  content: unknown[];
  isError: boolean;
  structuredContent?: unknown;
  raw: unknown;
}

const DEFAULT_PROTOCOL_VERSION = "2024-11-05";
const DEFAULT_TIMEOUT_MS = 15_000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const toTool = (value: unknown): MeiroMcpTool | null => {
  if (!isRecord(value) || typeof value.name !== "string" || value.name.length === 0) {
    return null;
  }
  return {
    name: value.name,
    description: typeof value.description === "string" ? value.description : undefined,
    inputSchema: value.inputSchema
  };
};

const normalizeTools = (payload: unknown): MeiroMcpTool[] => {
  if (!isRecord(payload) || !Array.isArray(payload.tools)) {
    return [];
  }
  return payload.tools.map(toTool).filter((tool): tool is MeiroMcpTool => tool !== null);
};

const normalizeToolCall = (payload: unknown): MeiroMcpToolCallResult => {
  if (!isRecord(payload)) {
    return {
      content: [],
      isError: false,
      raw: payload
    };
  }
  return {
    content: Array.isArray(payload.content) ? payload.content : [],
    isError: payload.isError === true,
    structuredContent: payload.structuredContent,
    raw: payload
  };
};

class McpSession {
  private child: ChildProcessWithoutNullStreams | null = null;
  private buffer = Buffer.alloc(0);
  private nextId = 1;
  private readonly pending = new Map<
    JsonRpcId,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();
  private stderr = "";

  constructor(private readonly config: Required<Pick<MeiroMcpConfig, "command" | "args" | "timeoutMs">> & MeiroMcpConfig) {}

  async start(): Promise<void> {
    if (this.child) {
      return;
    }

    const env = {
      ...process.env,
      ...(this.config.domain ? { MEIRO_DOMAIN: this.config.domain } : {}),
      ...(this.config.username ? { MEIRO_USERNAME: this.config.username } : {}),
      ...(this.config.password ? { MEIRO_PASSWORD: this.config.password } : {})
    };

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const child = spawn(this.config.command, this.config.args, {
        env,
        stdio: ["pipe", "pipe", "pipe"]
      });
      this.child = child;

      const startupTimer = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error(`Meiro MCP server did not start within ${this.config.timeoutMs}ms`));
          this.close();
        }
      }, this.config.timeoutMs);

      child.once("spawn", () => {
        if (!settled) {
          settled = true;
          clearTimeout(startupTimer);
          resolve();
        }
      });

      child.once("error", (error) => {
        if (!settled) {
          settled = true;
          clearTimeout(startupTimer);
          reject(error);
        }
      });

      child.stdout.on("data", (chunk: Buffer) => this.onStdout(chunk));
      child.stderr.on("data", (chunk: Buffer) => {
        this.stderr += chunk.toString("utf8");
        if (this.stderr.length > 4000) {
          this.stderr = this.stderr.slice(-4000);
        }
      });
      child.once("exit", (code, signal) => {
        const suffix = this.stderr.trim() ? `: ${this.stderr.trim()}` : "";
        const error = new Error(`Meiro MCP server exited (${code ?? signal ?? "unknown"})${suffix}`);
        for (const entry of this.pending.values()) {
          clearTimeout(entry.timer);
          entry.reject(error);
        }
        this.pending.clear();
      });
    });
  }

  async initialize(): Promise<void> {
    await this.request("initialize", {
      protocolVersion: DEFAULT_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: {
        name: "meiro-decision-engine",
        version: "0.1.0"
      }
    });
    this.notify("notifications/initialized", {});
  }

  async listTools(): Promise<MeiroMcpToolListResult> {
    const raw = await this.request("tools/list", {});
    return {
      tools: normalizeTools(raw),
      raw
    };
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<MeiroMcpToolCallResult> {
    const raw = await this.request("tools/call", {
      name,
      arguments: args
    });
    return normalizeToolCall(raw);
  }

  close(): void {
    const child = this.child;
    this.child = null;
    if (!child || child.killed) {
      return;
    }
    child.stdin.end();
    child.kill("SIGTERM");
  }

  private request(method: string, params: unknown): Promise<unknown> {
    const child = this.child;
    if (!child) {
      return Promise.reject(new Error("Meiro MCP session is not started"));
    }

    const id = this.nextId;
    this.nextId += 1;

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Meiro MCP request timed out: ${method}`));
      }, this.config.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.write({
        jsonrpc: "2.0",
        id,
        method,
        params
      });
    });
  }

  private notify(method: string, params: unknown): void {
    this.write({
      jsonrpc: "2.0",
      method,
      params
    });
  }

  private write(message: JsonRpcMessage): void {
    const child = this.child;
    if (!child) {
      throw new Error("Meiro MCP session is not started");
    }
    child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private onStdout(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    while (this.buffer.length > 0) {
      if (this.buffer.toString("utf8", 0, Math.min(this.buffer.length, 15)).toLowerCase().startsWith("content-length")) {
        if (!this.readFramedMessage()) {
          return;
        }
        continue;
      }

      const newlineIndex = this.buffer.indexOf(0x0a);
      if (newlineIndex === -1) {
        return;
      }
      const line = this.buffer.toString("utf8", 0, newlineIndex).trim();
      this.buffer = this.buffer.subarray(newlineIndex + 1);
      if (line.length > 0) {
        this.handleMessageText(line);
      }
    }
  }

  private readFramedMessage(): boolean {
    const headerEnd = this.buffer.indexOf("\r\n\r\n");
    const alternateHeaderEnd = this.buffer.indexOf("\n\n");
    const effectiveHeaderEnd = headerEnd !== -1 ? headerEnd : alternateHeaderEnd;
    const separatorLength = headerEnd !== -1 ? 4 : alternateHeaderEnd !== -1 ? 2 : 0;
    if (effectiveHeaderEnd === -1 || separatorLength === 0) {
      return false;
    }

    const header = this.buffer.toString("utf8", 0, effectiveHeaderEnd);
    const match = /content-length:\s*(\d+)/i.exec(header);
    if (!match) {
      this.buffer = this.buffer.subarray(effectiveHeaderEnd + separatorLength);
      return true;
    }

    const length = Number.parseInt(match[1] ?? "0", 10);
    const bodyStart = effectiveHeaderEnd + separatorLength;
    const bodyEnd = bodyStart + length;
    if (this.buffer.length < bodyEnd) {
      return false;
    }

    const body = this.buffer.toString("utf8", bodyStart, bodyEnd);
    this.buffer = this.buffer.subarray(bodyEnd);
    this.handleMessageText(body);
    return true;
  }

  private handleMessageText(text: string): void {
    let message: JsonRpcMessage;
    try {
      message = JSON.parse(text) as JsonRpcMessage;
    } catch {
      return;
    }

    if (message.id === undefined) {
      return;
    }

    const pending = this.pending.get(message.id);
    if (!pending) {
      return;
    }
    clearTimeout(pending.timer);
    this.pending.delete(message.id);

    if (message.error) {
      pending.reject(new Error(message.error.message));
      return;
    }
    pending.resolve(message.result);
  }
}

export class MeiroMcpClient {
  constructor(private readonly config: MeiroMcpConfig) {}

  getStatus(): MeiroMcpStatus {
    const command = this.config.command ?? "uvx";
    const args = this.config.args && this.config.args.length > 0 ? this.config.args : ["meiro-mcp"];
    const missing: string[] = [];
    if (!this.config.enabled) missing.push("MEIRO_MCP_ENABLED");
    if (!this.config.domain) missing.push("MEIRO_DOMAIN");
    if (!this.config.username) missing.push("MEIRO_USERNAME");
    if (!this.config.password) missing.push("MEIRO_PASSWORD");

    return {
      enabled: this.config.enabled,
      configured: missing.length === 0,
      command,
      args,
      domain: this.config.domain ?? null,
      username: this.config.username ?? null,
      timeoutMs: this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      missing
    };
  }

  async check(): Promise<MeiroMcpToolListResult> {
    return this.withSession((session) => session.listTools());
  }

  async listTools(): Promise<MeiroMcpToolListResult> {
    return this.withSession((session) => session.listTools());
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<MeiroMcpToolCallResult> {
    return this.withSession((session) => session.callTool(name, args));
  }

  private async withSession<T>(operation: (session: McpSession) => Promise<T>): Promise<T> {
    const status = this.getStatus();
    if (!status.configured) {
      throw new Error(`Meiro MCP is not configured. Missing: ${status.missing.join(", ")}`);
    }

    const session = new McpSession({
      ...this.config,
      command: status.command,
      args: status.args,
      timeoutMs: status.timeoutMs
    });
    try {
      await session.start();
      await session.initialize();
      return await operation(session);
    } finally {
      session.close();
    }
  }
}

import { describe, expect, it } from "vitest";
import { MeiroMcpClient } from "./mcp";

const mockServer = `
process.stdin.setEncoding("utf8");
let buffer = "";
const send = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\\n");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let index = buffer.indexOf("\\n");
  while (index >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    index = buffer.indexOf("\\n");
    if (!line) continue;
    const message = JSON.parse(line);
    if (message.method === "initialize") {
      send(message.id, { protocolVersion: "2024-11-05", capabilities: {}, serverInfo: { name: "mock-meiro-mcp" } });
    } else if (message.method === "tools/list") {
      send(message.id, { tools: [{ name: "list_segments", description: "List segments", inputSchema: { type: "object" } }] });
    } else if (message.method === "tools/call") {
      send(message.id, { content: [{ type: "text", text: JSON.stringify(message.params) }], isError: false });
    }
  }
});
`;

describe("MeiroMcpClient", () => {
  it("reports configuration without exposing the password", () => {
    const client = new MeiroMcpClient({
      enabled: true,
      command: "uvx",
      args: ["meiro-mcp"],
      domain: "https://instance.example.meiro.io",
      username: "operator@example.com",
      password: "secret"
    });

    const status = client.getStatus();

    expect(status.configured).toBe(true);
    expect(status.domain).toBe("https://instance.example.meiro.io");
    expect(status.username).toBe("operator@example.com");
    expect(JSON.stringify(status)).not.toContain("secret");
  });

  it("lists tools and calls a tool through stdio MCP", async () => {
    const client = new MeiroMcpClient({
      enabled: true,
      command: process.execPath,
      args: ["-e", mockServer],
      domain: "https://instance.example.meiro.io",
      username: "operator@example.com",
      password: "secret",
      timeoutMs: 2000
    });

    const tools = await client.listTools();
    expect(tools.tools).toEqual([
      {
        name: "list_segments",
        description: "List segments",
        inputSchema: { type: "object" }
      }
    ]);

    const result = await client.callTool("list_segments", { limit: 10 });
    expect(result.isError).toBe(false);
    expect(result.content).toHaveLength(1);
    expect(JSON.stringify(result.content[0])).toContain("list_segments");
  });
});

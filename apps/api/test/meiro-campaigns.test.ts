import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { MeiroMcpClient, MockMeiroAdapter } from "@decisioning/meiro";
import { registerMeiroRoutes } from "../src/routes/meiro";

const meiroMcp = new MeiroMcpClient({ enabled: false });

describe("Meiro campaign control routes", () => {
  it("normalizes typed Meiro MCP metadata responses", async () => {
    const app = Fastify();
    const typedMcp = {
      getStatus: () => ({
        enabled: true,
        configured: true,
        command: "uvx",
        args: ["meiro-mcp"],
        domain: "https://instance.example.meiro.io",
        username: "operator@example.com",
        timeoutMs: 15000,
        missing: []
      }),
      listTools: vi.fn(),
      check: vi.fn(),
      callTool: vi.fn(async (name: string) => {
        if (name === "list_segments") {
          return {
            content: [{ type: "text", text: JSON.stringify([{ id: 42, name: "VIP buyers", customer_count: 1200 }]) }],
            isError: false,
            raw: {}
          };
        }
        if (name === "list_attributes") {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify([
                  {
                    id: "email",
                    name: "Email",
                    data_type: "string"
                  },
                  {
                    id: "orders",
                    name: "Orders",
                    data_type: "compound([])",
                    sub_attributes: [{ id: "amount", name: "Amount", type: "float" }]
                  }
                ])
              }
            ],
            isError: false,
            raw: {}
          };
        }
        return { content: [{ type: "text", text: "[]" }], isError: false, raw: {} };
      })
    };

    await registerMeiroRoutes({
      app,
      meiro: new MockMeiroAdapter([]),
      meiroMcp: typedMcp as unknown as MeiroMcpClient,
      requireWriteAuth: vi.fn(async () => undefined),
      buildResponseError: (reply, statusCode, error, details) => reply.code(statusCode).send({ error, details })
    });

    const segmentsResponse = await app.inject({
      method: "GET",
      url: "/v1/meiro/mcp/data/segments"
    });
    expect(segmentsResponse.statusCode).toBe(200);
    expect(segmentsResponse.json().items[0]).toMatchObject({
      id: "42",
      name: "VIP buyers",
      customerCount: 1200
    });

    const attributesResponse = await app.inject({
      method: "GET",
      url: "/v1/meiro/mcp/data/attributes"
    });
    expect(attributesResponse.statusCode).toBe(200);
    expect(attributesResponse.json().items[1]).toMatchObject({
      id: "orders",
      dataType: "compound",
      subAttributes: [{ id: "amount", name: "Amount", dataType: "float" }]
    });

    const cachedSegmentsResponse = await app.inject({
      method: "GET",
      url: "/v1/meiro/mcp/data/segments"
    });
    expect(cachedSegmentsResponse.json().cached).toBe(true);
    expect(typedMcp.callTool).toHaveBeenCalledTimes(2);

    await app.close();
  });

  it("normalizes Meiro MCP customer search and profile attributes", async () => {
    const app = Fastify();
    const typedMcp = {
      getStatus: () => ({
        enabled: true,
        configured: true,
        command: "uvx",
        args: ["meiro-mcp"],
        domain: "https://instance.example.meiro.io",
        username: "operator@example.com",
        timeoutMs: 15000,
        missing: []
      }),
      listTools: vi.fn(),
      check: vi.fn(),
      callTool: vi.fn(async (name: string) => {
        if (name === "search_customers") {
          return {
            content: [{ type: "text", text: JSON.stringify({ results: [{ customer_entity_id: "cust-1", email: "buyer@example.com" }] }) }],
            isError: false,
            raw: {}
          };
        }
        if (name === "get_customer_attributes") {
          return {
            structuredContent: { attributes: { email: "buyer@example.com", cartValue: 80 } },
            content: [],
            isError: false,
            raw: {}
          };
        }
        return { content: [{ type: "text", text: "{}" }], isError: false, raw: {} };
      })
    };

    await registerMeiroRoutes({
      app,
      meiro: new MockMeiroAdapter([]),
      meiroMcp: typedMcp as unknown as MeiroMcpClient,
      requireWriteAuth: vi.fn(async () => undefined),
      buildResponseError: (reply, statusCode, error, details) => reply.code(statusCode).send({ error, details })
    });

    const searchResponse = await app.inject({
      method: "GET",
      url: "/v1/meiro/mcp/data/customers/search?q=buyer"
    });
    expect(searchResponse.statusCode).toBe(200);
    expect(searchResponse.json().items[0]).toMatchObject({
      id: "cust-1",
      displayName: "buyer@example.com",
      email: "buyer@example.com"
    });

    const attributesResponse = await app.inject({
      method: "GET",
      url: "/v1/meiro/mcp/data/customers/cust-1/attributes"
    });
    expect(attributesResponse.statusCode).toBe(200);
    expect(attributesResponse.json().item.attributes).toMatchObject({
      email: "buyer@example.com",
      cartValue: 80
    });

    await app.close();
  });

  it("lists campaigns by channel", async () => {
    const app = Fastify();
    const requireWriteAuth = vi.fn(async () => undefined);

    await registerMeiroRoutes({
      app,
      meiro: new MockMeiroAdapter([]),
      meiroMcp,
      requireWriteAuth,
      buildResponseError: (reply, statusCode, error, details) => reply.code(statusCode).send({ error, details })
    });

    const response = await app.inject({
      method: "GET",
      url: "/v1/meiro/campaigns?channel=whatsapp"
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.channel).toBe("whatsapp");
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items.length).toBeGreaterThan(0);
    expect(requireWriteAuth).toHaveBeenCalled();

    await app.close();
  });

  it("runs manual activation", async () => {
    const app = Fastify();

    await registerMeiroRoutes({
      app,
      meiro: new MockMeiroAdapter([]),
      meiroMcp,
      requireWriteAuth: vi.fn(async () => undefined),
      buildResponseError: (reply, statusCode, error, details) => reply.code(statusCode).send({ error, details })
    });

    const listResponse = await app.inject({
      method: "GET",
      url: "/v1/meiro/campaigns?channel=email"
    });
    const campaignId = listResponse.json().items[0].id as string;

    const response = await app.inject({
      method: "POST",
      url: `/v1/meiro/campaigns/email/${campaignId}/manual-activation`,
      payload: {
        segmentIds: ["segment-1"]
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe("queued");

    await app.close();
  });

  it("rejects activation-settings updates for unsupported channels", async () => {
    const app = Fastify();

    await registerMeiroRoutes({
      app,
      meiro: new MockMeiroAdapter([]),
      meiroMcp,
      requireWriteAuth: vi.fn(async () => undefined),
      buildResponseError: (reply, statusCode, error, details) => reply.code(statusCode).send({ error, details })
    });

    const response = await app.inject({
      method: "PUT",
      url: "/v1/meiro/campaigns/email/email-cmp-001/activation-settings",
      payload: {
        schedules: []
      }
    });

    expect(response.statusCode).toBe(400);

    await app.close();
  });

  it("reports Meiro MCP configuration without secrets", async () => {
    const app = Fastify();

    await registerMeiroRoutes({
      app,
      meiro: new MockMeiroAdapter([]),
      meiroMcp: new MeiroMcpClient({
        enabled: true,
        command: "uvx",
        args: ["meiro-mcp"],
        domain: "https://instance.example.meiro.io",
        username: "operator@example.com",
        password: "secret"
      }),
      requireWriteAuth: vi.fn(async () => undefined),
      buildResponseError: (reply, statusCode, error, details) => reply.code(statusCode).send({ error, details })
    });

    const response = await app.inject({
      method: "GET",
      url: "/v1/meiro/mcp/status"
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("operator@example.com");
    expect(response.body).not.toContain("secret");

    await app.close();
  });

  it("exposes live Meiro API login status without enabling mock mode globally", async () => {
    const app = Fastify();
    const meiroApi = {
      getProfile: vi.fn(),
      checkApiLogin: vi.fn(async () => ({
        ok: true,
        username: "operator@example.com",
        domain: "https://instance.example.meiro.io"
      }))
    };

    await registerMeiroRoutes({
      app,
      meiro: new MockMeiroAdapter([]),
      meiroApi,
      meiroMcp,
      requireWriteAuth: vi.fn(async () => undefined),
      buildResponseError: (reply, statusCode, error, details) => reply.code(statusCode).send({ error, details })
    });

    const response = await app.inject({
      method: "GET",
      url: "/v1/meiro/api/status"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      domain: "https://instance.example.meiro.io"
    });

    await app.close();
  });

  it("returns live Meiro Audience API profile and segment lookups", async () => {
    const app = Fastify();
    const meiroApi = {
      getProfile: vi.fn(),
      getAudienceProfile: vi.fn(async () => ({
        status: "ok",
        customerEntityId: "cust-1",
        returnedAttributes: { mx_email: "buyer@example.com" },
        data: { found: true },
        raw: { status: "ok" }
      })),
      getAudienceSegments: vi.fn(async () => ({
        status: "ok",
        segmentIds: ["1937", "2042"],
        raw: { segment_ids: [1937, 2042] }
      }))
    };

    await registerMeiroRoutes({
      app,
      meiro: new MockMeiroAdapter([]),
      meiroApi,
      meiroMcp,
      requireWriteAuth: vi.fn(async () => undefined),
      buildResponseError: (reply, statusCode, error, details) => reply.code(statusCode).send({ error, details })
    });

    const profileResponse = await app.inject({
      method: "GET",
      url: "/v1/meiro/audience/profile?attribute=stitching_meiro_id&value=cust-1&categoryId=accessories"
    });
    expect(profileResponse.statusCode).toBe(200);
    expect(profileResponse.json()).toMatchObject({
      customerEntityId: "cust-1",
      returnedAttributes: { mx_email: "buyer@example.com" },
      source: "meiro_api"
    });

    const segmentsResponse = await app.inject({
      method: "GET",
      url: "/v1/meiro/audience/segments?attribute=stitching_meiro_id&value=cust-1"
    });
    expect(segmentsResponse.statusCode).toBe(200);
    expect(segmentsResponse.json().segmentIds).toEqual(["1937", "2042"]);
    expect(meiroApi.getAudienceProfile).toHaveBeenCalledWith({
      attribute: "stitching_meiro_id",
      value: "cust-1",
      categoryId: "accessories"
    });

    await app.close();
  });

  it("lists native campaigns through the live Meiro API adapter", async () => {
    const app = Fastify();
    const meiroApi = {
      getProfile: vi.fn(),
      listCampaigns: vi.fn(async () => ({
        channel: "email" as const,
        total: 1,
        selection: { limit: null, offset: 0, searchedText: null, includeDeleted: false },
        items: [
          {
            channel: "email" as const,
            id: "email-1",
            name: "Welcome",
            deleted: false,
            modifiedAt: null,
            lastActivationAt: null,
            raw: {}
          }
        ],
        raw: {}
      }))
    };

    await registerMeiroRoutes({
      app,
      meiro: new MockMeiroAdapter([]),
      meiroApi,
      meiroMcp,
      requireWriteAuth: vi.fn(async () => undefined),
      buildResponseError: (reply, statusCode, error, details) => reply.code(statusCode).send({ error, details })
    });

    const response = await app.inject({
      method: "GET",
      url: "/v1/meiro/native-campaigns?channel=email"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      channel: "email",
      total: 1,
      source: "meiro_api"
    });
    expect(response.json().items[0]).toMatchObject({
      id: "email-1",
      name: "Welcome"
    });

    await app.close();
  });
});

import type {
  MeiroAdapter,
  MeiroCampaignActivationSettingsInput,
  MeiroCampaignChannel,
  MeiroCampaignManualActivationInput,
  MeiroCampaignTestActivationInput,
  MeiroCampaignUpdateInput,
  MeiroMcpClient,
  MeiroMcpToolCallResult
} from "@decisioning/meiro";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

const channelSchema = z.enum(["email", "push", "whatsapp"]);

const listQuerySchema = z.object({
  channel: channelSchema,
  limit: z.coerce.number().int().positive().max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  q: z.string().optional(),
  includeDeleted: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((value) => value === true || value === "true")
});

const idParamsSchema = z.object({
  channel: channelSchema,
  id: z.string().min(1)
});

const updateBodySchema = z.record(z.unknown());

const activationBodySchema = z.object({
  segmentIds: z.array(z.union([z.string(), z.number()])).min(1)
});

const testActivationBodySchema = z.object({
  recipients: z.array(z.string().min(1)).min(1),
  customerId: z.string().min(1).optional()
});

const mcpToolParamsSchema = z.object({
  name: z.string().min(1)
});

const mcpToolCallBodySchema = z.object({
  arguments: z.record(z.unknown()).optional()
});

const mcpDataQuerySchema = z.object({
  optional: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((value) => value === true || value === "true")
});

const segmentDetailsParamsSchema = z.object({
  id: z.coerce.number().int().positive()
});

const customerSearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(200),
  limit: z.coerce.number().int().positive().max(50).optional()
});

const customerParamsSchema = z.object({
  id: z.string().trim().min(1)
});

const audienceProfileQuerySchema = z.object({
  attribute: z.string().trim().min(1).max(200),
  value: z.string().trim().min(1).max(500),
  categoryId: z.string().trim().min(1).max(200).optional(),
  category_id: z.string().trim().min(1).max(200).optional()
});

const audienceSegmentsQuerySchema = z.object({
  attribute: z.string().trim().min(1).max(200),
  value: z.string().trim().min(1).max(500),
  tag: z.string().trim().min(1).max(200).optional()
});

const funnelGroupParamsSchema = z.object({
  id: z.string().trim().min(1)
});

const funnelGroupQuerySchema = z.object({
  startDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
  segmentId: z.string().trim().optional()
});

export interface RegisterMeiroRoutesDeps {
  app: FastifyInstance;
  meiro: MeiroAdapter;
  meiroApi?: MeiroAdapter;
  meiroMcp: MeiroMcpClient;
  requireWriteAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown> | unknown;
  buildResponseError: (reply: FastifyReply, statusCode: number, error: string, details?: unknown) => FastifyReply;
}

const notImplementedResponse = (deps: RegisterMeiroRoutesDeps, reply: FastifyReply, operation: string) => {
  return deps.buildResponseError(reply, 501, `Meiro adapter does not support ${operation}`);
};

const toAdapterErrorResponse = (deps: RegisterMeiroRoutesDeps, reply: FastifyReply, error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown Meiro adapter error";
  const lowered = message.toLowerCase();
  if (lowered.includes("not found")) {
    return deps.buildResponseError(reply, 404, "Meiro campaign not found", { message });
  }
  if (lowered.includes("unsupported") || lowered.includes("not support")) {
    return deps.buildResponseError(reply, 400, "Unsupported Meiro campaign operation", { message });
  }
  return deps.buildResponseError(reply, 502, "Meiro campaign control request failed", { message });
};

const toMeiroApiErrorResponse = (deps: RegisterMeiroRoutesDeps, reply: FastifyReply, error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown Meiro API error";
  const lowered = message.toLowerCase();
  if (lowered.includes("attribute not allowed") || lowered.includes("invalid")) {
    return deps.buildResponseError(reply, 400, "Meiro Audience API rejected the request", { message });
  }
  if (lowered.includes("login failed") || lowered.includes("unauthorized") || lowered.includes("401")) {
    return deps.buildResponseError(reply, 401, "Meiro API authentication failed", { message });
  }
  if (lowered.includes("not configured") || lowered.includes("missing") || lowered.includes("is not configured")) {
    return deps.buildResponseError(reply, 503, "Meiro API is not configured", { message });
  }
  if (lowered.includes("not found")) {
    return deps.buildResponseError(reply, 404, "Meiro API object not found", { message });
  }
  return deps.buildResponseError(reply, 502, "Meiro API request failed", { message });
};

const toMcpErrorResponse = (deps: RegisterMeiroRoutesDeps, reply: FastifyReply, error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown Meiro MCP error";
  const lowered = message.toLowerCase();
  if (lowered.includes("not configured") || lowered.includes("missing")) {
    return deps.buildResponseError(reply, 503, "Meiro MCP is not configured", { message });
  }
  if (lowered.includes("enoent") || lowered.includes("not found")) {
    return deps.buildResponseError(reply, 503, "Meiro MCP command is unavailable", { message });
  }
  if (lowered.includes("timed out") || lowered.includes("exited")) {
    return deps.buildResponseError(reply, 504, "Meiro MCP request timed out", { message });
  }
  return deps.buildResponseError(reply, 502, "Meiro MCP request failed", { message });
};

const toMcpOptionalDataResponse = (error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown Meiro MCP error";
  return {
    items: [],
    cached: false,
    source: "meiro_mcp" as const,
    degraded: true,
    error: message
  };
};

type CacheEntry<T> = {
  expiresAt: number;
  value: T;
};

const MCP_METADATA_CACHE_TTL_MS = 5 * 60 * 1000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const firstString = (record: Record<string, unknown>, keys: string[]): string | null => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return null;
};

const firstNumber = (record: Record<string, unknown>, keys: string[]): number | null => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return null;
};

const parseMaybeJson = (value: string): unknown => {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

const mcpContentText = (result: MeiroMcpToolCallResult): string => {
  return result.content
    .map((entry) => {
      if (isRecord(entry) && typeof entry.text === "string") {
        return entry.text;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
};

const mcpPayload = (tool: string, result: MeiroMcpToolCallResult): unknown => {
  if (result.isError) {
    throw new Error(mcpContentText(result) || `Meiro MCP tool '${tool}' returned an error`);
  }
  if (result.structuredContent !== undefined) {
    if (isRecord(result.structuredContent) && "result" in result.structuredContent) {
      return result.structuredContent.result;
    }
    return result.structuredContent;
  }
  const textEntries = result.content
    .map((entry) => (isRecord(entry) && typeof entry.text === "string" ? parseMaybeJson(entry.text) : entry))
    .filter((entry) => entry !== undefined && entry !== null);
  if (textEntries.length === 1) {
    return textEntries[0];
  }
  return textEntries;
};

const payloadItems = (payload: unknown, collectionKeys: string[] = ["items", "results", "result", "data"]): unknown[] => {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (!isRecord(payload)) {
    return [];
  }
  for (const key of collectionKeys) {
    const value = payload[key];
    if (Array.isArray(value)) {
      return value;
    }
  }
  return [];
};

const normalizeMcpDataType = (value: unknown): string | null => {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.startsWith("compound(")) {
    return "compound";
  }
  return trimmed;
};

const normalizeSegment = (entry: unknown) => {
  if (!isRecord(entry)) {
    return null;
  }
  const id = firstString(entry, ["id", "segment_id", "segmentId", "key"]);
  const name = firstString(entry, ["name", "title", "label"]) ?? id;
  if (!id || !name) {
    return null;
  }
  return {
    id,
    name,
    key: firstString(entry, ["key", "slug", "segment_key", "segmentKey"]),
    description: firstString(entry, ["description", "desc"]),
    customerCount: firstNumber(entry, ["customer_count", "customers_count", "customerCount", "customers", "count", "size"]),
    url: firstString(entry, ["url", "href", "link"]),
    raw: entry
  };
};

const normalizeAttribute = (entry: unknown) => {
  if (!isRecord(entry)) {
    return null;
  }
  const id = firstString(entry, ["id", "attribute_id", "attributeId", "key"]);
  const name = firstString(entry, ["name", "title", "label"]) ?? id;
  if (!id || !name) {
    return null;
  }
  const subAttributes = Array.isArray(entry.sub_attributes)
    ? entry.sub_attributes
        .map((subEntry) => {
          if (!isRecord(subEntry)) {
            return null;
          }
          const subId = firstString(subEntry, ["id", "key"]);
          const subName = firstString(subEntry, ["name", "label"]) ?? subId;
          if (!subId || !subName) {
            return null;
          }
          return {
            id: subId,
            name: subName,
            dataType: normalizeMcpDataType(subEntry.type ?? subEntry.data_type) ?? "string"
          };
        })
        .filter((item): item is { id: string; name: string; dataType: string } => item !== null)
    : [];
  return {
    id,
    name,
    dataType: normalizeMcpDataType(entry.data_type ?? entry.dataType ?? entry.type) ?? "string",
    description: firstString(entry, ["description", "desc"]),
    subAttributes,
    raw: entry
  };
};

const normalizeEvent = (entry: unknown) => {
  if (!isRecord(entry)) {
    return null;
  }
  const id = firstString(entry, ["id", "event_id", "eventId", "key"]);
  const name = firstString(entry, ["name", "title", "label"]) ?? id;
  if (!id || !name) {
    return null;
  }
  return {
    id,
    name,
    description: firstString(entry, ["description", "desc"]),
    examples: Array.isArray(entry.examples) ? entry.examples : [],
    raw: entry
  };
};

const normalizeCustomer = (entry: unknown) => {
  if (!isRecord(entry)) {
    return null;
  }
  const id = firstString(entry, ["customer_entity_id", "customerEntityId", "id", "entity_id", "entityId"]);
  if (!id) {
    return null;
  }
  return {
    id,
    displayName: firstString(entry, ["name", "display_name", "displayName", "email"]) ?? id,
    email: firstString(entry, ["email", "email_address", "emailAddress"]),
    raw: entry
  };
};

const normalizeFunnel = (entry: unknown) => {
  if (!isRecord(entry)) {
    return null;
  }
  const id = firstString(entry, ["id", "funnel_id", "funnelId", "key"]);
  const name = firstString(entry, ["name", "title", "label"]) ?? id;
  if (!id || !name) {
    return null;
  }
  return {
    id,
    name,
    description: firstString(entry, ["description", "desc"]),
    steps: Array.isArray(entry.steps) ? entry.steps : [],
    raw: entry
  };
};

const normalizeFunnelGroup = (entry: unknown) => {
  if (!isRecord(entry)) {
    return null;
  }
  const id = firstString(entry, ["id", "group_id", "groupId", "key"]);
  const name = firstString(entry, ["name", "title", "label"]) ?? id;
  if (!id || !name) {
    return null;
  }
  return {
    id,
    name,
    funnels: payloadItems(entry, ["funnels"]).map(normalizeFunnel).filter((item): item is NonNullable<ReturnType<typeof normalizeFunnel>> => item !== null),
    raw: entry
  };
};

const normalizeCustomerAttributes = (customerEntityId: string, payload: unknown) => {
  const attributes = isRecord(payload) && isRecord(payload.attributes) ? payload.attributes : isRecord(payload) ? payload : {};
  return {
    customerEntityId,
    attributes,
    raw: payload
  };
};

export const registerMeiroRoutes = async (deps: RegisterMeiroRoutesDeps) => {
  const mcpCache = new Map<string, CacheEntry<unknown>>();
  let mcpQueue = Promise.resolve();

  const cached = async <T>(key: string, loader: () => Promise<T>, ttlMs = MCP_METADATA_CACHE_TTL_MS): Promise<{ value: T; cached: boolean }> => {
    const now = Date.now();
    const existing = mcpCache.get(key) as CacheEntry<T> | undefined;
    if (existing && existing.expiresAt > now) {
      return { value: existing.value, cached: true };
    }
    const value = await loader();
    mcpCache.set(key, { value, expiresAt: now + ttlMs });
    return { value, cached: false };
  };

  const withMcpQueue = async <T>(operation: () => Promise<T>): Promise<T> => {
    const run = mcpQueue.then(operation, operation);
    mcpQueue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  };

  const callMcpTool = async (tool: string, args: Record<string, unknown> = {}) =>
    withMcpQueue(async () => mcpPayload(tool, await deps.meiroMcp.callTool(tool, args)));
  const meiroApi = deps.meiroApi ?? deps.meiro;

  deps.app.get("/v1/meiro/api/status", { preHandler: deps.requireWriteAuth }, async (_request, reply) => {
    if (!meiroApi.checkApiLogin) {
      return notImplementedResponse(deps, reply, "API login check");
    }
    try {
      return await meiroApi.checkApiLogin();
    } catch (error) {
      return toMeiroApiErrorResponse(deps, reply, error);
    }
  });

  deps.app.post("/v1/meiro/api/check-login", { preHandler: deps.requireWriteAuth }, async (_request, reply) => {
    if (!meiroApi.checkApiLogin) {
      return notImplementedResponse(deps, reply, "API login check");
    }
    try {
      return await meiroApi.checkApiLogin();
    } catch (error) {
      return toMeiroApiErrorResponse(deps, reply, error);
    }
  });

  deps.app.get("/v1/meiro/audience/profile", { preHandler: deps.requireWriteAuth }, async (request, reply) => {
    const parsed = audienceProfileQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return deps.buildResponseError(reply, 400, "Invalid query", parsed.error.flatten());
    }
    if (!meiroApi.getAudienceProfile) {
      return notImplementedResponse(deps, reply, "audience profile lookup");
    }
    try {
      const result = await meiroApi.getAudienceProfile({
        attribute: parsed.data.attribute,
        value: parsed.data.value,
        categoryId: parsed.data.categoryId ?? parsed.data.category_id
      });
      return {
        status: result.status,
        customerEntityId: result.customerEntityId,
        returnedAttributes: result.returnedAttributes,
        data: result.data,
        raw: result.raw,
        source: "meiro_api" as const
      };
    } catch (error) {
      return toMeiroApiErrorResponse(deps, reply, error);
    }
  });

  deps.app.get("/v1/meiro/audience/segments", { preHandler: deps.requireWriteAuth }, async (request, reply) => {
    const parsed = audienceSegmentsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return deps.buildResponseError(reply, 400, "Invalid query", parsed.error.flatten());
    }
    if (!meiroApi.getAudienceSegments) {
      return notImplementedResponse(deps, reply, "audience segment lookup");
    }
    try {
      const result = await meiroApi.getAudienceSegments(parsed.data);
      return {
        status: result.status,
        segmentIds: result.segmentIds,
        raw: result.raw,
        source: "meiro_api" as const
      };
    } catch (error) {
      return toMeiroApiErrorResponse(deps, reply, error);
    }
  });

  deps.app.get("/v1/meiro/native-campaigns", { preHandler: deps.requireWriteAuth }, async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return deps.buildResponseError(reply, 400, "Invalid query", parsed.error.flatten());
    }

    if (!meiroApi.listCampaigns) {
      return notImplementedResponse(deps, reply, "native campaign listing");
    }

    try {
      const result = await meiroApi.listCampaigns({
        channel: parsed.data.channel,
        limit: parsed.data.limit,
        offset: parsed.data.offset,
        searchedText: parsed.data.q,
        includeDeleted: parsed.data.includeDeleted
      });

      return {
        channel: result.channel,
        total: result.total,
        selection: result.selection,
        items: result.items,
        source: "meiro_api" as const
      };
    } catch (error) {
      return toMeiroApiErrorResponse(deps, reply, error);
    }
  });

  deps.app.get("/v1/meiro/native-campaigns/:channel/:id", { preHandler: deps.requireWriteAuth }, async (request, reply) => {
    const parsed = idParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      return deps.buildResponseError(reply, 400, "Invalid params", parsed.error.flatten());
    }

    if (!meiroApi.getCampaign) {
      return notImplementedResponse(deps, reply, "native campaign retrieval");
    }

    try {
      const item = await meiroApi.getCampaign({
        channel: parsed.data.channel,
        campaignId: parsed.data.id
      });
      return { item, source: "meiro_api" as const };
    } catch (error) {
      return toMeiroApiErrorResponse(deps, reply, error);
    }
  });

  deps.app.patch("/v1/meiro/native-campaigns/:channel/:id", { preHandler: deps.requireWriteAuth }, async (request, reply) => {
    const parsedParams = idParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return deps.buildResponseError(reply, 400, "Invalid params", parsedParams.error.flatten());
    }
    const parsedBody = updateBodySchema.safeParse(request.body);
    if (!parsedBody.success) {
      return deps.buildResponseError(reply, 400, "Invalid body", parsedBody.error.flatten());
    }

    if (!meiroApi.updateCampaign) {
      return notImplementedResponse(deps, reply, "native campaign updates");
    }

    try {
      const item = await meiroApi.updateCampaign({
        channel: parsedParams.data.channel,
        campaignId: parsedParams.data.id,
        body: parsedBody.data
      });
      return { item, source: "meiro_api" as const };
    } catch (error) {
      return toMeiroApiErrorResponse(deps, reply, error);
    }
  });

  deps.app.put("/v1/meiro/native-campaigns/:channel/:id/activation-settings", { preHandler: deps.requireWriteAuth }, async (request, reply) => {
    const parsedParams = idParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return deps.buildResponseError(reply, 400, "Invalid params", parsedParams.error.flatten());
    }
    const parsedBody = updateBodySchema.safeParse(request.body);
    if (!parsedBody.success) {
      return deps.buildResponseError(reply, 400, "Invalid body", parsedBody.error.flatten());
    }

    if (!meiroApi.updateCampaignActivationSettings) {
      return notImplementedResponse(deps, reply, "native campaign activation settings updates");
    }

    const channel = parsedParams.data.channel as MeiroCampaignChannel;
    if (channel !== "whatsapp") {
      return deps.buildResponseError(reply, 400, "Activation settings are supported only for WhatsApp campaigns.");
    }

    try {
      const item = await meiroApi.updateCampaignActivationSettings({
        channel,
        campaignId: parsedParams.data.id,
        body: parsedBody.data
      });
      return { item, source: "meiro_api" as const };
    } catch (error) {
      return toMeiroApiErrorResponse(deps, reply, error);
    }
  });

  deps.app.post("/v1/meiro/native-campaigns/:channel/:id/manual-activation", { preHandler: deps.requireWriteAuth }, async (request, reply) => {
    const parsedParams = idParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return deps.buildResponseError(reply, 400, "Invalid params", parsedParams.error.flatten());
    }
    const parsedBody = activationBodySchema.safeParse(request.body);
    if (!parsedBody.success) {
      return deps.buildResponseError(reply, 400, "Invalid body", parsedBody.error.flatten());
    }

    if (!meiroApi.activateCampaign) {
      return notImplementedResponse(deps, reply, "native campaign manual activation");
    }

    try {
      const activation = await meiroApi.activateCampaign({
        channel: parsedParams.data.channel,
        campaignId: parsedParams.data.id,
        segmentIds: parsedBody.data.segmentIds
      });
      return {
        status: activation.status,
        channel: activation.channel,
        campaignId: activation.campaignId,
        raw: activation.raw,
        source: "meiro_api" as const
      };
    } catch (error) {
      return toMeiroApiErrorResponse(deps, reply, error);
    }
  });

  deps.app.post("/v1/meiro/native-campaigns/:channel/:id/test-activation", { preHandler: deps.requireWriteAuth }, async (request, reply) => {
    const parsedParams = idParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return deps.buildResponseError(reply, 400, "Invalid params", parsedParams.error.flatten());
    }
    const parsedBody = testActivationBodySchema.safeParse(request.body);
    if (!parsedBody.success) {
      return deps.buildResponseError(reply, 400, "Invalid body", parsedBody.error.flatten());
    }

    if (!meiroApi.testCampaign) {
      return notImplementedResponse(deps, reply, "native campaign test activation");
    }

    try {
      const testActivation = await meiroApi.testCampaign({
        channel: parsedParams.data.channel,
        campaignId: parsedParams.data.id,
        recipients: parsedBody.data.recipients,
        customerId: parsedBody.data.customerId
      });
      return {
        status: testActivation.status,
        channel: testActivation.channel,
        campaignId: testActivation.campaignId,
        raw: testActivation.raw,
        source: "meiro_api" as const
      };
    } catch (error) {
      return toMeiroApiErrorResponse(deps, reply, error);
    }
  });

  deps.app.get("/v1/meiro/mcp/status", { preHandler: deps.requireWriteAuth }, async () => {
    return {
      status: deps.meiroMcp.getStatus()
    };
  });

  deps.app.post("/v1/meiro/mcp/check", { preHandler: deps.requireWriteAuth }, async (_request, reply) => {
    try {
      const result = await deps.meiroMcp.check();
      return {
        status: deps.meiroMcp.getStatus(),
        tools: result.tools
      };
    } catch (error) {
      return toMcpErrorResponse(deps, reply, error);
    }
  });

  deps.app.get("/v1/meiro/mcp/tools", { preHandler: deps.requireWriteAuth }, async (_request, reply) => {
    try {
      const result = await deps.meiroMcp.listTools();
      return {
        tools: result.tools
      };
    } catch (error) {
      return toMcpErrorResponse(deps, reply, error);
    }
  });

  deps.app.post("/v1/meiro/mcp/tools/:name/call", { preHandler: deps.requireWriteAuth }, async (request, reply) => {
    const parsedParams = mcpToolParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return deps.buildResponseError(reply, 400, "Invalid params", parsedParams.error.flatten());
    }

    const parsedBody = mcpToolCallBodySchema.safeParse(request.body);
    if (!parsedBody.success) {
      return deps.buildResponseError(reply, 400, "Invalid body", parsedBody.error.flatten());
    }

    try {
      const result = await deps.meiroMcp.callTool(parsedParams.data.name, parsedBody.data.arguments ?? {});
      return result;
    } catch (error) {
      return toMcpErrorResponse(deps, reply, error);
    }
  });

  deps.app.get("/v1/meiro/mcp/data/segments", { preHandler: deps.requireWriteAuth }, async (request, reply) => {
    const parsedQuery = mcpDataQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      return deps.buildResponseError(reply, 400, "Invalid query", parsedQuery.error.flatten());
    }
    try {
      const { value, cached: cacheHit } = await cached("segments", async () => {
        const payload = await callMcpTool("list_segments");
        return payloadItems(payload, ["segments", "items", "results", "data"])
          .map(normalizeSegment)
          .filter((item): item is NonNullable<ReturnType<typeof normalizeSegment>> => item !== null);
      });
      return { items: value, cached: cacheHit, source: "meiro_mcp" };
    } catch (error) {
      if (parsedQuery.data.optional) {
        return toMcpOptionalDataResponse(error);
      }
      return toMcpErrorResponse(deps, reply, error);
    }
  });

  deps.app.get("/v1/meiro/mcp/data/segments/:id", { preHandler: deps.requireWriteAuth }, async (request, reply) => {
    const parsed = segmentDetailsParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      return deps.buildResponseError(reply, 400, "Invalid params", parsed.error.flatten());
    }
    try {
      const { value, cached: cacheHit } = await cached(`segment:${parsed.data.id}`, async () => {
        const payload = await callMcpTool("get_segment_details", { segment_id: parsed.data.id });
        return {
          item: normalizeSegment(payload),
          details: payload
        };
      });
      return { ...value, cached: cacheHit, source: "meiro_mcp" };
    } catch (error) {
      return toMcpErrorResponse(deps, reply, error);
    }
  });

  deps.app.get("/v1/meiro/mcp/data/attributes", { preHandler: deps.requireWriteAuth }, async (request, reply) => {
    const parsedQuery = mcpDataQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      return deps.buildResponseError(reply, 400, "Invalid query", parsedQuery.error.flatten());
    }
    try {
      const { value, cached: cacheHit } = await cached("attributes", async () => {
        const payload = await callMcpTool("list_attributes");
        return payloadItems(payload, ["attributes", "items", "results", "data"])
          .map(normalizeAttribute)
          .filter((item): item is NonNullable<ReturnType<typeof normalizeAttribute>> => item !== null);
      });
      return { items: value, cached: cacheHit, source: "meiro_mcp" };
    } catch (error) {
      if (parsedQuery.data.optional) {
        return toMcpOptionalDataResponse(error);
      }
      return toMcpErrorResponse(deps, reply, error);
    }
  });

  deps.app.get("/v1/meiro/mcp/data/events", { preHandler: deps.requireWriteAuth }, async (request, reply) => {
    const parsedQuery = mcpDataQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      return deps.buildResponseError(reply, 400, "Invalid query", parsedQuery.error.flatten());
    }
    try {
      const { value, cached: cacheHit } = await cached("events", async () => {
        const payload = await callMcpTool("list_events");
        return payloadItems(payload, ["events", "items", "results", "data"])
          .map(normalizeEvent)
          .filter((item): item is NonNullable<ReturnType<typeof normalizeEvent>> => item !== null);
      });
      return { items: value, cached: cacheHit, source: "meiro_mcp" };
    } catch (error) {
      if (parsedQuery.data.optional) {
        return toMcpOptionalDataResponse(error);
      }
      return toMcpErrorResponse(deps, reply, error);
    }
  });

  deps.app.get("/v1/meiro/mcp/data/funnels", { preHandler: deps.requireWriteAuth }, async (request, reply) => {
    const parsedQuery = mcpDataQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      return deps.buildResponseError(reply, 400, "Invalid query", parsedQuery.error.flatten());
    }
    try {
      const { value, cached: cacheHit } = await cached("funnels", async () => {
        const payload = await callMcpTool("list_funnels");
        return payloadItems(payload, ["funnels", "groups", "items", "results", "data"])
          .map(normalizeFunnelGroup)
          .filter((item): item is NonNullable<ReturnType<typeof normalizeFunnelGroup>> => item !== null);
      });
      return { items: value, cached: cacheHit, source: "meiro_mcp" };
    } catch (error) {
      if (parsedQuery.data.optional) {
        return toMcpOptionalDataResponse(error);
      }
      return toMcpErrorResponse(deps, reply, error);
    }
  });

  deps.app.get("/v1/meiro/mcp/data/funnels/:id/groups", { preHandler: deps.requireWriteAuth }, async (request, reply) => {
    const parsedParams = funnelGroupParamsSchema.safeParse(request.params);
    const parsedQuery = funnelGroupQuerySchema.safeParse(request.query);
    if (!parsedParams.success) {
      return deps.buildResponseError(reply, 400, "Invalid params", parsedParams.error.flatten());
    }
    if (!parsedQuery.success) {
      return deps.buildResponseError(reply, 400, "Invalid query", parsedQuery.error.flatten());
    }
    try {
      const payload = await callMcpTool("get_funnel_group_data", {
        funnel_group_id: parsedParams.data.id,
        start_date: parsedQuery.data.startDate,
        end_date: parsedQuery.data.endDate,
        segment_id: parsedQuery.data.segmentId ?? null
      });
      return { item: payload, source: "meiro_mcp" };
    } catch (error) {
      return toMcpErrorResponse(deps, reply, error);
    }
  });

  deps.app.get("/v1/meiro/mcp/data/customers/search", { preHandler: deps.requireWriteAuth }, async (request, reply) => {
    const parsed = customerSearchQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return deps.buildResponseError(reply, 400, "Invalid query", parsed.error.flatten());
    }
    try {
      const payload = await callMcpTool("search_customers", { search_text: parsed.data.q });
      const items = payloadItems(payload, ["customers", "items", "results", "data"])
        .map(normalizeCustomer)
        .filter((item): item is NonNullable<ReturnType<typeof normalizeCustomer>> => item !== null)
        .slice(0, parsed.data.limit ?? 10);
      return { items, source: "meiro_mcp" };
    } catch (error) {
      return toMcpErrorResponse(deps, reply, error);
    }
  });

  deps.app.get("/v1/meiro/mcp/data/customers/:id/attributes", { preHandler: deps.requireWriteAuth }, async (request, reply) => {
    const parsed = customerParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      return deps.buildResponseError(reply, 400, "Invalid params", parsed.error.flatten());
    }
    try {
      const payload = await callMcpTool("get_customer_attributes", { customer_entity_id: parsed.data.id });
      return {
        item: normalizeCustomerAttributes(parsed.data.id, payload),
        source: "meiro_mcp"
      };
    } catch (error) {
      return toMcpErrorResponse(deps, reply, error);
    }
  });

  deps.app.get("/v1/meiro/campaigns", { preHandler: deps.requireWriteAuth }, async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return deps.buildResponseError(reply, 400, "Invalid query", parsed.error.flatten());
    }

    if (!deps.meiro.listCampaigns) {
      return notImplementedResponse(deps, reply, "campaign listing");
    }

    try {
      const result = await deps.meiro.listCampaigns({
        channel: parsed.data.channel,
        limit: parsed.data.limit,
        offset: parsed.data.offset,
        searchedText: parsed.data.q,
        includeDeleted: parsed.data.includeDeleted
      });

      return {
        channel: result.channel,
        total: result.total,
        selection: result.selection,
        items: result.items
      };
    } catch (error) {
      return toAdapterErrorResponse(deps, reply, error);
    }
  });

  deps.app.get("/v1/meiro/campaigns/:channel/:id", { preHandler: deps.requireWriteAuth }, async (request, reply) => {
    const parsed = idParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      return deps.buildResponseError(reply, 400, "Invalid params", parsed.error.flatten());
    }

    if (!deps.meiro.getCampaign) {
      return notImplementedResponse(deps, reply, "campaign retrieval");
    }

    try {
      const item = await deps.meiro.getCampaign({
        channel: parsed.data.channel,
        campaignId: parsed.data.id
      });
      return { item };
    } catch (error) {
      return toAdapterErrorResponse(deps, reply, error);
    }
  });

  deps.app.patch("/v1/meiro/campaigns/:channel/:id", { preHandler: deps.requireWriteAuth }, async (request, reply) => {
    const parsedParams = idParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return deps.buildResponseError(reply, 400, "Invalid params", parsedParams.error.flatten());
    }
    const parsedBody = updateBodySchema.safeParse(request.body);
    if (!parsedBody.success) {
      return deps.buildResponseError(reply, 400, "Invalid body", parsedBody.error.flatten());
    }

    if (!deps.meiro.updateCampaign) {
      return notImplementedResponse(deps, reply, "campaign updates");
    }

    const input: MeiroCampaignUpdateInput = {
      channel: parsedParams.data.channel,
      campaignId: parsedParams.data.id,
      body: parsedBody.data
    };

    try {
      const item = await deps.meiro.updateCampaign(input);
      return { item };
    } catch (error) {
      return toAdapterErrorResponse(deps, reply, error);
    }
  });

  deps.app.put("/v1/meiro/campaigns/:channel/:id/activation-settings", { preHandler: deps.requireWriteAuth }, async (request, reply) => {
    const parsedParams = idParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return deps.buildResponseError(reply, 400, "Invalid params", parsedParams.error.flatten());
    }
    const parsedBody = updateBodySchema.safeParse(request.body);
    if (!parsedBody.success) {
      return deps.buildResponseError(reply, 400, "Invalid body", parsedBody.error.flatten());
    }

    if (!deps.meiro.updateCampaignActivationSettings) {
      return notImplementedResponse(deps, reply, "campaign activation settings updates");
    }

    const channel = parsedParams.data.channel as MeiroCampaignChannel;
    if (channel !== "whatsapp") {
      return deps.buildResponseError(reply, 400, "Activation settings are supported only for WhatsApp campaigns.");
    }

    const input: MeiroCampaignActivationSettingsInput = {
      channel,
      campaignId: parsedParams.data.id,
      body: parsedBody.data
    };

    try {
      const item = await deps.meiro.updateCampaignActivationSettings(input);
      return { item };
    } catch (error) {
      return toAdapterErrorResponse(deps, reply, error);
    }
  });

  deps.app.post("/v1/meiro/campaigns/:channel/:id/manual-activation", { preHandler: deps.requireWriteAuth }, async (request, reply) => {
    const parsedParams = idParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return deps.buildResponseError(reply, 400, "Invalid params", parsedParams.error.flatten());
    }
    const parsedBody = activationBodySchema.safeParse(request.body);
    if (!parsedBody.success) {
      return deps.buildResponseError(reply, 400, "Invalid body", parsedBody.error.flatten());
    }

    if (!deps.meiro.activateCampaign) {
      return notImplementedResponse(deps, reply, "campaign manual activation");
    }

    const input: MeiroCampaignManualActivationInput = {
      channel: parsedParams.data.channel,
      campaignId: parsedParams.data.id,
      segmentIds: parsedBody.data.segmentIds
    };

    try {
      const activation = await deps.meiro.activateCampaign(input);
      return {
        status: activation.status,
        channel: activation.channel,
        campaignId: activation.campaignId,
        raw: activation.raw
      };
    } catch (error) {
      return toAdapterErrorResponse(deps, reply, error);
    }
  });

  deps.app.post("/v1/meiro/campaigns/:channel/:id/test-activation", { preHandler: deps.requireWriteAuth }, async (request, reply) => {
    const parsedParams = idParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return deps.buildResponseError(reply, 400, "Invalid params", parsedParams.error.flatten());
    }
    const parsedBody = testActivationBodySchema.safeParse(request.body);
    if (!parsedBody.success) {
      return deps.buildResponseError(reply, 400, "Invalid body", parsedBody.error.flatten());
    }

    if (!deps.meiro.testCampaign) {
      return notImplementedResponse(deps, reply, "campaign test activation");
    }

    const input: MeiroCampaignTestActivationInput = {
      channel: parsedParams.data.channel,
      campaignId: parsedParams.data.id,
      recipients: parsedBody.data.recipients,
      customerId: parsedBody.data.customerId
    };

    try {
      const testActivation = await deps.meiro.testCampaign(input);
      return {
        status: testActivation.status,
        channel: testActivation.channel,
        campaignId: testActivation.campaignId,
        raw: testActivation.raw
      };
    } catch (error) {
      return toAdapterErrorResponse(deps, reply, error);
    }
  });
};

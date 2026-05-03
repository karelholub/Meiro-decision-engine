import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Environment, PrismaClient } from "@prisma/client";
import { z } from "zod";

const activationMeasurementQuerySchema = z.object({
  object_type: z
    .enum(["campaign", "decision", "decision_stack", "asset", "offer", "content", "bundle", "experiment", "variant", "placement", "template"])
    .default("campaign"),
  object_id: z.string().min(1),
  date_from: z.string().min(1).optional(),
  date_to: z.string().min(1).optional(),
  conversion_key: z.string().min(1).optional()
});

const activationEvidenceQuerySchema = activationMeasurementQuerySchema.extend({
  limit: z.coerce.number().int().min(1).max(100).optional()
});

export const registerMeasurementRoutes = async (deps: {
  app: FastifyInstance;
  prisma: PrismaClient;
  measurementApiBaseUrl?: string;
  measurementApiTimeoutMs: number;
  resolveEnvironment?: (request: FastifyRequest, reply: FastifyReply) => Environment | null;
  requireReadAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown> | unknown;
  buildResponseError: (reply: FastifyReply, statusCode: number, error: string, details?: unknown) => unknown;
}) => {
  const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

  const firstString = (record: Record<string, unknown>, keys: string[]) => {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) return value;
      if (typeof value === "number" || typeof value === "boolean") return String(value);
    }
    return undefined;
  };

  const sourceMetadataFromRecord = (value: unknown) => {
    const record = isRecord(value) ? value : {};
    const metadata = {
      sourceSystem: firstString(record, ["source_system", "sourceSystem"]),
      nativeMeiroCampaignId: firstString(record, ["native_meiro_campaign_id", "nativeMeiroCampaignId"]),
      nativeMeiroAssetId: firstString(record, ["native_meiro_asset_id", "nativeMeiroAssetId"]),
      nativeMeiroCatalogId: firstString(record, ["native_meiro_catalog_id", "nativeMeiroCatalogId"]),
      activationCampaignId: firstString(record, ["activation_campaign_id", "activationCampaignId"]),
      creativeAssetId: firstString(record, ["creative_asset_id", "creativeAssetId"]),
      offerCatalogId: firstString(record, ["offer_catalog_id", "offerCatalogId"]),
      channel: firstString(record, ["channel"]),
      prismSourceId: firstString(record, ["prism_source_id", "prismSourceId"]),
      importedFrom: firstString(record, ["imported_from", "importedFrom"])
    };
    return Object.values(metadata).some(Boolean) ? metadata : null;
  };

  const resolveSourceMetadata = async (environment: Environment, objectType: string, objectId: string) => {
    if (objectType === "campaign") {
      const row = await (deps.prisma as any).inAppCampaign.findFirst({
        where: { environment, key: objectId },
        select: { tokenBindingsJson: true }
      });
      return sourceMetadataFromRecord(row?.tokenBindingsJson);
    }
    if (objectType === "content" || objectType === "asset") {
      const row = await deps.prisma.contentBlock.findFirst({
        where: { environment, key: objectId },
        orderBy: { version: "desc" },
        select: { tokenBindings: true }
      });
      return sourceMetadataFromRecord(row?.tokenBindings);
    }
    if (objectType === "bundle") {
      const row = await (deps.prisma as any).assetBundle.findFirst({
        where: { environment, key: objectId },
        orderBy: { version: "desc" },
        select: { metadataJson: true }
      });
      return sourceMetadataFromRecord(row?.metadataJson);
    }
    return null;
  };

  const proxyMeasurementRequest = async (
    request: FastifyRequest,
    reply: FastifyReply,
    schema: typeof activationMeasurementQuerySchema | typeof activationEvidenceQuerySchema,
    upstreamPath: string
  ) => {
    const parsed = schema.safeParse(request.query);
    if (!parsed.success) {
      return deps.buildResponseError(reply, 400, "Invalid query", parsed.error.flatten());
    }
    const environment = deps.resolveEnvironment?.(request, reply) ?? "DEV";
    if (!environment) return;
    const sourceMetadata = await resolveSourceMetadata(environment, parsed.data.object_type, parsed.data.object_id);

    const baseUrl = String(deps.measurementApiBaseUrl || "").replace(/\/+$/, "");
    if (!baseUrl) {
      return {
        object: { type: parsed.data.object_type, id: parsed.data.object_id },
        sourceMetadata,
        status: "unavailable",
        reason: "Measurement API base URL is not configured."
      };
    }

    const params = new URLSearchParams();
    params.set("object_type", parsed.data.object_type);
    params.set("object_id", parsed.data.object_id);
    if (parsed.data.date_from) params.set("date_from", parsed.data.date_from);
    if (parsed.data.date_to) params.set("date_to", parsed.data.date_to);
    if (parsed.data.conversion_key) params.set("conversion_key", parsed.data.conversion_key);
    if ("limit" in parsed.data && parsed.data.limit) params.set("limit", String(parsed.data.limit));
    if (sourceMetadata?.sourceSystem) params.set("source_system", sourceMetadata.sourceSystem);
    if (sourceMetadata?.nativeMeiroCampaignId) params.set("native_meiro_campaign_id", sourceMetadata.nativeMeiroCampaignId);
    if (sourceMetadata?.nativeMeiroAssetId) params.set("native_meiro_asset_id", sourceMetadata.nativeMeiroAssetId);
    if (sourceMetadata?.nativeMeiroCatalogId) params.set("native_meiro_catalog_id", sourceMetadata.nativeMeiroCatalogId);
    if (sourceMetadata?.activationCampaignId) params.set("activation_campaign_id", sourceMetadata.activationCampaignId);
    if (sourceMetadata?.creativeAssetId) params.set("creative_asset_id", sourceMetadata.creativeAssetId);
    if (sourceMetadata?.offerCatalogId) params.set("offer_catalog_id", sourceMetadata.offerCatalogId);
    if (sourceMetadata?.channel) params.set("channel", sourceMetadata.channel);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.max(100, deps.measurementApiTimeoutMs));
    try {
      const response = await fetch(`${baseUrl}${upstreamPath}?${params.toString()}`, {
        headers: {
          "X-User-Id": "deciengine-measurement-proxy",
          "X-User-Role": "analyst"
        },
        signal: controller.signal
      });
      const text = await response.text();
      const payload = text ? JSON.parse(text) : {};
      if (!response.ok) {
        return {
          object: { type: parsed.data.object_type, id: parsed.data.object_id },
          sourceMetadata,
          status: "unavailable",
          reason: payload?.detail || payload?.error || "Measurement API returned an error.",
          upstreamStatus: response.status
        };
      }
      return {
        status: "ok",
        source: "meiro_mmm_app",
        sourceMetadata,
        ...payload
      };
    } catch (error) {
      return {
        object: { type: parsed.data.object_type, id: parsed.data.object_id },
        sourceMetadata,
        status: "unavailable",
        reason: error instanceof Error ? error.message : "Measurement API request failed."
      };
    } finally {
      clearTimeout(timeout);
    }
  };

  deps.app.get("/v1/measurement/activation-summary", { preHandler: deps.requireReadAuth }, async (request, reply) => {
    return proxyMeasurementRequest(request, reply, activationMeasurementQuerySchema, "/api/measurement/activation-summary");
  });

  deps.app.get("/v1/measurement/activation-evidence", { preHandler: deps.requireReadAuth }, async (request, reply) => {
    return proxyMeasurementRequest(request, reply, activationEvidenceQuerySchema, "/api/measurement/activation-evidence");
  });
};

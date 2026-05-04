import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Environment, PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
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

const activationFeedbackImportListQuerySchema = z.object({
  object_type: z.string().min(1).optional(),
  object_id: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10)
});

const activationFeedbackSignalSchema = z
  .object({
    signal_id: z.string().min(1).optional(),
    object: z
      .object({
        type: z.string().min(1).optional(),
        id: z.string().min(1).optional(),
        label: z.string().optional()
      })
      .passthrough()
      .optional(),
    recommendation: z.string().optional(),
    status: z.string().optional(),
    metrics: z.record(z.unknown()).optional(),
    decision_engine_hint: z.record(z.unknown()).optional()
  })
  .passthrough();

const activationFeedbackImportBodySchema = z
  .object({
    schema_version: z.string().min(1),
    generated_at: z.string().optional(),
    generated_by: z.string().optional(),
    source: z.record(z.unknown()).optional(),
    summary: z.record(z.unknown()).optional(),
    decision: z.record(z.unknown()).optional(),
    signals: z.array(activationFeedbackSignalSchema).default([])
  })
  .passthrough();

type ActivationFeedbackImportPayload = z.infer<typeof activationFeedbackImportBodySchema>;

type ActivationFeedbackImportRun = {
  id: string;
  receivedAt: string;
  schemaVersion: string;
  generatedAt?: string;
  generatedBy?: string;
  source?: Record<string, unknown>;
  summary?: Record<string, unknown>;
  decision?: Record<string, unknown>;
  signalCount: number;
  objectTypes: string[];
  objectIds: string[];
  signals: ActivationFeedbackImportPayload["signals"];
  payload: ActivationFeedbackImportPayload;
};

export const registerMeasurementRoutes = async (deps: {
  app: FastifyInstance;
  prisma: PrismaClient;
  measurementApiBaseUrl?: string;
  measurementApiTimeoutMs: number;
  resolveEnvironment?: (request: FastifyRequest, reply: FastifyReply) => Environment | null;
  requireReadAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown> | unknown;
  requireWriteAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown> | unknown;
  buildResponseError: (reply: FastifyReply, statusCode: number, error: string, details?: unknown) => unknown;
}) => {
  const feedbackImportsPath = resolve(
    process.cwd(),
    process.env.ACTIVATION_FEEDBACK_IMPORTS_FILE ?? "apps/api/src/data/activation_feedback_imports.json"
  );

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

  const readFeedbackImports = async (): Promise<ActivationFeedbackImportRun[]> => {
    try {
      const raw = await readFile(feedbackImportsPath, "utf8");
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed?.runs) ? parsed.runs : [];
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return [];
      throw error;
    }
  };

  const writeFeedbackImports = async (runs: ActivationFeedbackImportRun[]) => {
    await mkdir(dirname(feedbackImportsPath), { recursive: true });
    await writeFile(feedbackImportsPath, `${JSON.stringify({ runs: runs.slice(0, 50) }, null, 2)}\n`, "utf8");
  };

  const summarizeFeedbackImport = (run: ActivationFeedbackImportRun) => ({
    id: run.id,
    receivedAt: run.receivedAt,
    schemaVersion: run.schemaVersion,
    generatedAt: run.generatedAt,
    generatedBy: run.generatedBy,
    source: run.source,
    summary: run.summary,
    decision: run.decision,
    signalCount: run.signalCount,
    objectTypes: run.objectTypes,
    objectIds: run.objectIds,
    signals: run.signals.slice(0, 5)
  });

  const buildFeedbackImportRun = (payload: ActivationFeedbackImportPayload): ActivationFeedbackImportRun => {
    const objectTypes = Array.from(
      new Set(payload.signals.map((signal) => signal.object?.type).filter((value): value is string => Boolean(value)))
    );
    const objectIds = Array.from(
      new Set(payload.signals.map((signal) => signal.object?.id).filter((value): value is string => Boolean(value)))
    );
    return {
      id: `afi_${Date.now()}_${randomUUID().slice(0, 8)}`,
      receivedAt: new Date().toISOString(),
      schemaVersion: payload.schema_version,
      generatedAt: payload.generated_at,
      generatedBy: payload.generated_by,
      source: payload.source,
      summary: payload.summary,
      decision: payload.decision,
      signalCount: payload.signals.length,
      objectTypes,
      objectIds,
      signals: payload.signals,
      payload
    };
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

  deps.app.post("/v1/measurement/activation-feedback/import", { preHandler: deps.requireWriteAuth }, async (request, reply) => {
    const parsed = activationFeedbackImportBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return deps.buildResponseError(reply, 400, "Invalid activation feedback import", parsed.error.flatten());
    }
    const run = buildFeedbackImportRun(parsed.data);
    const existing = await readFeedbackImports();
    await writeFeedbackImports([run, ...existing]);
    return reply.code(202).send({
      status: "accepted",
      run: summarizeFeedbackImport(run),
      summary: {
        signal_count: run.signalCount,
        object_types: run.objectTypes,
        object_ids: run.objectIds
      }
    });
  });

  deps.app.get("/v1/measurement/activation-feedback/imports", { preHandler: deps.requireReadAuth }, async (request, reply) => {
    const parsed = activationFeedbackImportListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return deps.buildResponseError(reply, 400, "Invalid query", parsed.error.flatten());
    }
    const runs = await readFeedbackImports();
    const filtered = runs.filter((run) => {
      const objectTypeMatches = parsed.data.object_type
        ? run.signals.some((signal) => signal.object?.type === parsed.data.object_type)
        : true;
      const objectIdMatches = parsed.data.object_id
        ? run.signals.some((signal) => signal.object?.id === parsed.data.object_id)
        : true;
      return objectTypeMatches && objectIdMatches;
    });
    return {
      total: filtered.length,
      items: filtered.slice(0, parsed.data.limit).map(summarizeFeedbackImport)
    };
  });

  deps.app.get("/v1/measurement/activation-feedback/imports/:id", { preHandler: deps.requireReadAuth }, async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
    if (!params.success) {
      return deps.buildResponseError(reply, 400, "Invalid import id", params.error.flatten());
    }
    const runs = await readFeedbackImports();
    const run = runs.find((item) => item.id === params.data.id);
    if (!run) {
      return deps.buildResponseError(reply, 404, "Activation feedback import not found");
    }
    return { item: run };
  });
};

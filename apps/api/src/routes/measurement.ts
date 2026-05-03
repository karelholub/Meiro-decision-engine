import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
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
  measurementApiBaseUrl?: string;
  measurementApiTimeoutMs: number;
  requireReadAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown> | unknown;
  buildResponseError: (reply: FastifyReply, statusCode: number, error: string, details?: unknown) => unknown;
}) => {
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

    const baseUrl = String(deps.measurementApiBaseUrl || "").replace(/\/+$/, "");
    if (!baseUrl) {
      return {
        object: { type: parsed.data.object_type, id: parsed.data.object_id },
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
          status: "unavailable",
          reason: payload?.detail || payload?.error || "Measurement API returned an error.",
          upstreamStatus: response.status
        };
      }
      return {
        status: "ok",
        source: "meiro_mmm_app",
        ...payload
      };
    } catch (error) {
      return {
        object: { type: parsed.data.object_type, id: parsed.data.object_id },
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

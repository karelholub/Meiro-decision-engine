import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import {
  activationEntityTypes,
  buildActivationTimeline,
  type ActivationEntityType
} from "../services/activationTimeline";

const activationTimelineQuerySchema = z.object({
  type: z.enum(activationEntityTypes),
  key: z.string().trim().min(1),
  environment: z.enum(["DEV", "STAGE", "PROD"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional()
});

export const registerActivationTimelineRoutes = async (deps: {
  app: FastifyInstance;
  prisma: PrismaClient;
  resolveEnvironment: (request: FastifyRequest, reply: FastifyReply) => string | null;
  buildResponseError: (reply: FastifyReply, statusCode: number, error: string, details?: unknown) => unknown;
  requireAnyPermission: (permissions: string[]) => (request: FastifyRequest, reply: FastifyReply) => Promise<unknown> | unknown;
}) => {
  deps.app.get(
    "/v1/activation-timeline",
    { preHandler: deps.requireAnyPermission(["decision.read", "engage.campaign.read", "catalog.content.read", "promotion.create", "logs.read"]) },
    async (request, reply) => {
      const environment = deps.resolveEnvironment(request, reply);
      if (!environment) {
        return;
      }

      const query = activationTimelineQuerySchema.safeParse(request.query);
      if (!query.success) {
        return deps.buildResponseError(reply, 400, "Invalid activation timeline query", query.error.flatten());
      }

      return buildActivationTimeline({
        prisma: deps.prisma,
        environment: query.data.environment ?? environment,
        type: query.data.type as ActivationEntityType,
        key: query.data.key,
        limit: query.data.limit
      });
    }
  );
};


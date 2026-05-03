import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import {
  activationActionTypes,
  activationEntityTypes,
  buildActivationActionPreview,
  buildActivationGraph,
  type ActivationActionType,
  type ActivationEntityType
} from "../services/activationGraph";

const activationGraphQuerySchema = z.object({
  type: z.enum(activationEntityTypes),
  key: z.string().trim().min(1),
  environment: z.enum(["DEV", "STAGE", "PROD"]).optional()
});

const activationActionPreviewQuerySchema = activationGraphQuerySchema.extend({
  action: z.enum(activationActionTypes)
});

export const registerActivationGraphRoutes = async (deps: {
  app: FastifyInstance;
  prisma: PrismaClient;
  resolveEnvironment: (request: FastifyRequest, reply: FastifyReply) => string | null;
  buildResponseError: (reply: FastifyReply, statusCode: number, error: string, details?: unknown) => unknown;
  requireAnyPermission: (permissions: string[]) => (request: FastifyRequest, reply: FastifyReply) => Promise<unknown> | unknown;
}) => {
  deps.app.get(
    "/v1/activation-graph",
    { preHandler: deps.requireAnyPermission(["decision.read", "engage.campaign.read", "catalog.content.read", "promotion.create", "logs.read"]) },
    async (request, reply) => {
      const environment = deps.resolveEnvironment(request, reply);
      if (!environment) {
        return;
      }

      const query = activationGraphQuerySchema.safeParse(request.query);
      if (!query.success) {
        return deps.buildResponseError(reply, 400, "Invalid activation graph query", query.error.flatten());
      }

      const graphEnvironment = query.data.environment ?? environment;
      const graph = await buildActivationGraph({
        prisma: deps.prisma,
        environment: graphEnvironment,
        root: {
          type: query.data.type as ActivationEntityType,
          key: query.data.key
        }
      });

      if (graph.rootNode.missing) {
        return deps.buildResponseError(reply, 404, "Activation entity not found", {
          type: query.data.type,
          key: query.data.key,
          environment: graphEnvironment
        });
      }

      return graph;
    }
  );

  deps.app.get(
    "/v1/activation-action-preview",
    { preHandler: deps.requireAnyPermission(["decision.read", "engage.campaign.read", "catalog.content.read", "promotion.create", "logs.read"]) },
    async (request, reply) => {
      const environment = deps.resolveEnvironment(request, reply);
      if (!environment) {
        return;
      }

      const query = activationActionPreviewQuerySchema.safeParse(request.query);
      if (!query.success) {
        return deps.buildResponseError(reply, 400, "Invalid activation action preview query", query.error.flatten());
      }

      const graphEnvironment = query.data.environment ?? environment;
      const preview = await buildActivationActionPreview({
        prisma: deps.prisma,
        environment: graphEnvironment,
        action: query.data.action as ActivationActionType,
        root: {
          type: query.data.type as ActivationEntityType,
          key: query.data.key
        }
      });

      if (preview.affectedEntities[0]?.missing) {
        return deps.buildResponseError(reply, 404, "Activation entity not found", {
          type: query.data.type,
          key: query.data.key,
          environment: graphEnvironment
        });
      }

      return preview;
    }
  );
};

import type { Environment, Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  RUNTIME_SETTINGS_KEY,
  normalizeRuntimeSettings,
  parseRuntimeSettings,
  runtimeSettingsSchema,
  type RuntimeSettings
} from "../settings/runtimeSettings";

const runtimeSettingsBodySchema = z.object({
  settings: runtimeSettingsSchema
});

export interface RegisterRuntimeSettingsRoutesDeps {
  app: FastifyInstance;
  prisma: PrismaClient;
  requireWriteAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown> | unknown;
  resolveEnvironment: (request: FastifyRequest, reply: FastifyReply) => Environment | null;
  buildResponseError: (reply: FastifyReply, statusCode: number, error: string, details?: unknown) => FastifyReply;
  defaults: RuntimeSettings;
  getEffective: (environment: Environment) => RuntimeSettings;
  applyOverride: (environment: Environment, settings: RuntimeSettings) => void;
  clearOverride: (environment: Environment) => void;
}

export const registerRuntimeSettingsRoutes = async (deps: RegisterRuntimeSettingsRoutesDeps) => {
  deps.app.get("/v1/settings/runtime", async (request, reply) => {
    const environment = deps.resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const row = await deps.prisma.appSetting.findFirst({
      where: {
        environment,
        key: RUNTIME_SETTINGS_KEY
      }
    });

    const override = row ? parseRuntimeSettings(row.valueJson, deps.defaults) : null;
    return {
      environment,
      defaults: deps.defaults,
      override,
      effective: deps.getEffective(environment),
      updatedAt: row?.updatedAt.toISOString() ?? null
    };
  });

  deps.app.put("/v1/settings/runtime", { preHandler: deps.requireWriteAuth }, async (request, reply) => {
    const environment = deps.resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const parsed = runtimeSettingsBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return deps.buildResponseError(reply, 400, "Invalid body", parsed.error.flatten());
    }

    const normalized = normalizeRuntimeSettings(parsed.data.settings, deps.defaults);
    const existing = await deps.prisma.appSetting.findFirst({
      where: {
        environment,
        key: RUNTIME_SETTINGS_KEY
      }
    });

    if (!existing) {
      await deps.prisma.appSetting.create({
        data: {
          environment,
          key: RUNTIME_SETTINGS_KEY,
          valueJson: normalized as Prisma.InputJsonValue
        }
      });
    } else {
      await deps.prisma.appSetting.update({
        where: {
          id: existing.id
        },
        data: {
          valueJson: normalized as Prisma.InputJsonValue
        }
      });
    }

    deps.applyOverride(environment, normalized);

    const reloaded = await deps.prisma.appSetting.findFirst({
      where: {
        environment,
        key: RUNTIME_SETTINGS_KEY
      }
    });

    return {
      environment,
      defaults: deps.defaults,
      override: normalized,
      effective: deps.getEffective(environment),
      updatedAt: reloaded?.updatedAt.toISOString() ?? null
    };
  });

  deps.app.delete("/v1/settings/runtime", { preHandler: deps.requireWriteAuth }, async (request, reply) => {
    const environment = deps.resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    await deps.prisma.appSetting.deleteMany({
      where: {
        environment,
        key: RUNTIME_SETTINGS_KEY
      }
    });

    deps.clearOverride(environment);

    return {
      status: "ok",
      environment,
      defaults: deps.defaults,
      override: null,
      effective: deps.getEffective(environment),
      updatedAt: null
    };
  });
};

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ApiRuntimeRole } from "../config";

interface BootstrapAuthContext {
  email: string | null;
  userId: string | null;
  permissionsByEnv: unknown;
}

export interface RegisterBootstrapRoutesDeps {
  app: FastifyInstance;
  now: () => Date;
  runtimeRole: ApiRuntimeRole;
  workers: {
    dlq: boolean;
    inappEvents: boolean;
    orchestrationEvents: boolean;
    retention: boolean;
  };
  resolveAuthContext: (request: FastifyRequest, reply: FastifyReply) => Promise<BootstrapAuthContext | null>;
  apiWriteKey?: string;
  allPermissions: () => string[];
  buildResponseError: (reply: FastifyReply, statusCode: number, error: string, details?: unknown) => FastifyReply;
}

export const registerBootstrapRoutes = async (deps: RegisterBootstrapRoutesDeps) => {
  deps.app.get("/health", async () => {
    return {
      status: "ok",
      timestamp: deps.now().toISOString(),
      runtime: {
        role: deps.runtimeRole,
        workers: deps.workers
      }
    };
  });

  deps.app.get("/", async () => {
    return {
      name: "decisioning-api",
      status: "ok",
      docsHint: "Use /health or /v1/* endpoints."
    };
  });

  deps.app.get("/v1/me", async (request, reply) => {
    const auth = await deps.resolveAuthContext(request, reply);
    if (!auth) {
      if (!deps.apiWriteKey) {
        return {
          email: null,
          userId: null,
          envPermissions: {
            DEV: deps.allPermissions(),
            STAGE: deps.allPermissions(),
            PROD: deps.allPermissions()
          }
        };
      }
      return deps.buildResponseError(reply, 401, "Unauthorized");
    }

    return {
      email: auth.email,
      userId: auth.userId,
      envPermissions: auth.permissionsByEnv
    };
  });
};

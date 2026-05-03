import { spawnSync } from "node:child_process";
import { Prisma, type Environment, type PrismaClient } from "@prisma/client";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

const PRISM_IMPORT_SNAPSHOT_KEY = "pipes-prism.importSnapshot";
type PrismSourceMode = "pipes_cli" | "meiro_mcp";

const normalizeBaseUrl = (value: string | undefined): string | null => {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.replace(/\/+$/, "");
};

const redactUrl = (value: string | null): string | null => {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return value.replace(/(token|key|secret)=([^&]+)/gi, "$1=redacted");
  }
};

const cliStatus = (command: string) => {
  const startedAt = Date.now();
  const result = spawnSync(command, ["--version"], {
    encoding: "utf8",
    timeout: 1500,
    shell: false
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  return {
    command,
    installed: !result.error && result.status === 0,
    version: !result.error && result.status === 0 ? output.split(/\r?\n/)[0] || null : null,
    error: result.error ? result.error.message : result.status === 0 ? null : output || `exit ${result.status ?? "unknown"}`,
    durationMs: Date.now() - startedAt
  };
};

const cliApiStatus = (input: {
  command: string;
  baseUrl: string;
  token: string;
  path: string;
  timeoutMs: number;
}) => {
  const startedAt = Date.now();
  const result = spawnSync(input.command, ["api", "GET", input.path], {
    encoding: "utf8",
    timeout: Math.max(500, input.timeoutMs),
    shell: false,
    env: {
      ...process.env,
      MPCLI_URL: input.baseUrl,
      MPCLI_TOKEN: input.token,
      MEIRO_PIPES_BASE_URL: input.baseUrl,
      MEIRO_PIPES_TOKEN: input.token
    }
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  let payload: unknown = null;
  if (result.stdout?.trim()) {
    try {
      payload = JSON.parse(result.stdout) as unknown;
    } catch {
      payload = result.stdout.slice(0, 500);
    }
  }
  return {
    path: input.path,
    ok: !result.error && result.status === 0,
    reachable: !result.error,
    exitCode: result.status,
    error: result.error ? result.error.message : result.status === 0 ? null : output || `exit ${result.status ?? "unknown"}`,
    payloadShape:
      payload && typeof payload === "object" && !Array.isArray(payload)
        ? Object.keys(payload as Record<string, unknown>).slice(0, 8)
        : typeof payload,
    durationMs: Date.now() - startedAt
  };
};

const runCliApi = (input: {
  command: string;
  baseUrl: string;
  token: string;
  method: string;
  path: string;
  timeoutMs: number;
}) => {
  const startedAt = Date.now();
  const result = spawnSync(input.command, ["api", input.method, input.path], {
    encoding: "utf8",
    timeout: Math.max(500, input.timeoutMs),
    shell: false,
    env: {
      ...process.env,
      MPCLI_URL: input.baseUrl,
      MPCLI_TOKEN: input.token,
      MEIRO_PIPES_BASE_URL: input.baseUrl,
      MEIRO_PIPES_TOKEN: input.token
    }
  });
  const stderr = result.stderr?.trim();
  const stdout = result.stdout?.trim();
  if (result.error || result.status !== 0) {
    return {
      ok: false as const,
      path: input.path,
      exitCode: result.status,
      durationMs: Date.now() - startedAt,
      error: result.error ? result.error.message : stderr || stdout?.slice(0, 500) || `exit ${result.status ?? "unknown"}`
    };
  }

  try {
    return {
      ok: true as const,
      path: input.path,
      exitCode: result.status,
      durationMs: Date.now() - startedAt,
      payload: stdout ? (JSON.parse(stdout) as unknown) : null
    };
  } catch {
    return {
      ok: true as const,
      path: input.path,
      exitCode: result.status,
      durationMs: Date.now() - startedAt,
      payload: stdout ?? null
    };
  }
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const firstString = (record: Record<string, unknown>, keys: string[]): string | null => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
  }
  return null;
};

const collectionFromPayload = (payload: unknown): unknown[] => {
  if (Array.isArray(payload)) return payload;
  const record = asRecord(payload);
  if (!record) return [];
  for (const key of ["items", "data", "results", "audiences", "assets", "catalogs", "campaigns", "attributes"]) {
    const value = record[key];
    if (Array.isArray(value)) return value;
  }
  return [];
};

const summarizeItems = (payload: unknown) =>
  collectionFromPayload(payload)
    .map((item) => {
      const record = asRecord(item);
      if (!record) return null;
      const id = firstString(record, ["id", "audienceId", "assetId", "catalogId", "campaignId", "attributeId", "_id"]);
      const name = firstString(record, ["name", "title", "label", "key", "slug"]);
      return {
        id: id ?? name ?? "unknown",
        name: name ?? id ?? "Unnamed",
        key: firstString(record, ["key", "slug", "code"]),
        status: firstString(record, ["status", "state", "lifecycle", "enabled"]),
        type: firstString(record, ["type", "channel", "kind", "format"]),
        updatedAt: firstString(record, ["updatedAt", "updated_at", "modifiedAt", "modified_at"])
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .slice(0, 25);

const sectionItems = (snapshot: unknown, key: string) => {
  const record = asRecord(snapshot);
  const sections = Array.isArray(record?.sections) ? record.sections : [];
  const section = sections.map(asRecord).find((entry) => entry?.key === key);
  return Array.isArray(section?.items) ? section.items.map(asRecord).filter((entry): entry is Record<string, unknown> => Boolean(entry)) : [];
};

const fieldTypeFromPrismType = (value: unknown) => {
  const normalized = typeof value === "string" ? value.toLowerCase() : "";
  if (normalized.includes("number") || normalized.includes("int") || normalized.includes("float") || normalized.includes("decimal")) return "number";
  if (normalized.includes("bool")) return "boolean";
  if (normalized.includes("array") || normalized.includes("compound")) return "array";
  return "string";
};

const slugify = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);

const fallbackShortId = (value: string) => value.replace(/[^a-zA-Z0-9]/g, "").slice(0, 10).toLowerCase() || "item";

const recommendedKey = (prefix: string, item: Record<string, unknown>, channel?: string | null) => {
  const id = firstString(item, ["id", "key", "name"]) ?? "unknown";
  const name = firstString(item, ["name", "key", "id"]) ?? id;
  const slug = slugify(name) || fallbackShortId(id);
  const parts = channel ? [prefix, slugify(channel) || "channel", slug] : [prefix, slug];
  return parts.filter(Boolean).join("_");
};

const buildMappingRecommendations = (snapshot: unknown) => {
  const campaigns = sectionItems(snapshot, "campaigns");
  const assets = sectionItems(snapshot, "assets");
  const catalogs = sectionItems(snapshot, "catalogs");
  const attributes = sectionItems(snapshot, "attributes");
  const audiences = sectionItems(snapshot, "audiences");

  const campaignMappings = campaigns.map((item) => {
    const id = firstString(item, ["id", "key", "name"]) ?? "unknown";
    const channel = firstString(item, ["type", "channel", "kind"]);
    return {
      sourceId: id,
      sourceName: firstString(item, ["name", "id"]) ?? "Unnamed campaign",
      sourceType: "prism_campaign",
      targetType: "activation_campaign",
      recommendedKey: recommendedKey("prism_campaign", item, channel),
      confidence: channel ? "high" : "medium",
      reason: "Use this key as the deciEngine activation campaign key and as a stable measurement campaign_id.",
      measurementTags: {
        source_system: "meiro_prism",
        native_meiro_campaign_id: id,
        activation_campaign_id: recommendedKey("prism_campaign", item, channel),
        channel: channel ?? "unknown"
      }
    };
  });

  const assetMappings = assets.map((item) => {
    const id = firstString(item, ["id", "key", "name"]) ?? "unknown";
    return {
      sourceId: id,
      sourceName: firstString(item, ["name", "id"]) ?? "Unnamed asset",
      sourceType: "prism_asset",
      targetType: "content_asset",
      recommendedKey: recommendedKey("prism_asset", item),
      confidence: "medium",
      reason: "Attach this asset key to decision variants so MTA/MMM can separate content effects from campaign effects.",
      measurementTags: {
        source_system: "meiro_prism",
        native_meiro_asset_id: id,
        creative_asset_id: recommendedKey("prism_asset", item)
      }
    };
  });

  const catalogMappings = catalogs.map((item) => {
    const id = firstString(item, ["id", "key", "name"]) ?? "unknown";
    return {
      sourceId: id,
      sourceName: firstString(item, ["name", "id"]) ?? "Unnamed catalog",
      sourceType: "prism_catalog",
      targetType: "offer_catalog",
      recommendedKey: recommendedKey("prism_catalog", item),
      confidence: "medium",
      reason: "Expose this catalog as offer or product context for decision rules and saved feed personalization.",
      measurementTags: {
        source_system: "meiro_prism",
        native_meiro_catalog_id: id,
        offer_catalog_id: recommendedKey("prism_catalog", item)
      }
    };
  });

  const decisionInputs = [
    ...attributes.map((item) => {
      const field = firstString(item, ["id", "key", "name"]) ?? "unknown";
      return {
        sourceId: field,
        sourceName: firstString(item, ["name", "id"]) ?? field,
        sourceType: "prism_attribute",
        targetType: "decision_profile_field",
        recommendedKey: field,
        confidence: "high",
        reason: "Use the Prism attribute directly in decision eligibility and scoring logic.",
        dataType: fieldTypeFromPrismType(item.type)
      };
    }),
    ...audiences.map((item) => {
      const id = firstString(item, ["id", "key", "name"]) ?? "unknown";
      return {
        sourceId: id,
        sourceName: firstString(item, ["name", "id"]) ?? id,
        sourceType: "prism_audience",
        targetType: "decision_audience",
        recommendedKey: id,
        confidence: "high",
        reason: "Use the Prism audience as a reusable eligibility gate in decisions and journeys."
      };
    })
  ];

  const measurementJoins = [
    {
      key: "campaign_id",
      source: "activation_campaign_id",
      description: "Primary join from deciEngine decisions to MTA/MMM campaign spend and outcome tables."
    },
    {
      key: "native_meiro_campaign_id",
      source: "Prism campaign id",
      description: "Keep the native Prism campaign id for audit, replay, and reverse lookup."
    },
    {
      key: "creative_asset_id",
      source: "Prism asset mapping key",
      description: "Use on decision exposure and conversion events to analyze asset-level lift."
    },
    {
      key: "offer_catalog_id",
      source: "Prism catalog mapping key",
      description: "Use when offer/catalog selection is part of the decision treatment."
    }
  ];

  return {
    campaignMappings,
    assetMappings,
    catalogMappings,
    decisionInputs,
    measurementJoins,
    counts: {
      campaigns: campaignMappings.length,
      assets: assetMappings.length,
      catalogs: catalogMappings.length,
      decisionInputs: decisionInputs.length,
      measurementJoins: measurementJoins.length
    }
  };
};

const buildImportPreview = async (input: { prisma: PrismaClient; environment: Environment; snapshot: unknown }) => {
  const mappings = buildMappingRecommendations(input.snapshot);
  const campaignKeys = mappings.campaignMappings.map((mapping) => mapping.recommendedKey);
  const assetKeys = mappings.assetMappings.map((mapping) => mapping.recommendedKey);
  const catalogKeys = mappings.catalogMappings.map((mapping) => mapping.recommendedKey);

  const [campaigns, contentBlocks, bundles] = await Promise.all([
    (input.prisma as any).inAppCampaign.findMany({
      where: { environment: input.environment, key: { in: campaignKeys } },
      select: { id: true, key: true, name: true, status: true, updatedAt: true }
    }),
    input.prisma.contentBlock.findMany({
      where: { environment: input.environment, key: { in: assetKeys } },
      select: { id: true, key: true, name: true, status: true, version: true, updatedAt: true },
      orderBy: [{ key: "asc" }, { version: "desc" }]
    }),
    (input.prisma as any).assetBundle.findMany({
      where: { environment: input.environment, key: { in: catalogKeys } },
      select: { id: true, key: true, name: true, status: true, version: true, updatedAt: true },
      orderBy: [{ key: "asc" }, { version: "desc" }]
    })
  ]);

  const campaignByKey = new Map(campaigns.map((item: any) => [item.key, item]));
  const contentByKey = new Map<string, any>();
  for (const item of contentBlocks) {
    if (!contentByKey.has(item.key)) contentByKey.set(item.key, item);
  }
  const bundleByKey = new Map<string, any>();
  for (const item of bundles) {
    if (!bundleByKey.has(item.key)) bundleByKey.set(item.key, item);
  }

  const toExisting = (item: any) =>
    item
      ? {
          id: item.id,
          key: item.key,
          name: item.name,
          status: item.status,
          version: typeof item.version === "number" ? item.version : null,
          updatedAt: item.updatedAt?.toISOString?.() ?? null
        }
      : null;

  const campaignOperations = mappings.campaignMappings.map((mapping) => {
    const existing = campaignByKey.get(mapping.recommendedKey);
    return {
      sourceId: mapping.sourceId,
      sourceName: mapping.sourceName,
      targetType: "in_app_campaign",
      targetKey: mapping.recommendedKey,
      action: existing ? "link_existing" : "create_draft",
      existing: toExisting(existing),
      writable: false,
      reason: existing
        ? "A local campaign already uses this recommended key."
        : "A local draft campaign can be created from this Prism campaign after write import is enabled.",
      draft: {
        key: mapping.recommendedKey,
        name: mapping.sourceName,
        status: "DRAFT",
        metadata: mapping.measurementTags
      }
    };
  });

  const assetOperations = mappings.assetMappings.map((mapping) => {
    const existing = contentByKey.get(mapping.recommendedKey);
    return {
      sourceId: mapping.sourceId,
      sourceName: mapping.sourceName,
      targetType: "content_block",
      targetKey: mapping.recommendedKey,
      action: existing ? "link_existing" : "create_draft",
      existing: toExisting(existing),
      writable: false,
      reason: existing
        ? "A local content block already uses this recommended key."
        : "A local draft content block can be created from this Prism asset after payload mapping is selected.",
      draft: {
        key: mapping.recommendedKey,
        name: mapping.sourceName,
        status: "DRAFT",
        tags: ["meiro_prism", "prism_asset"],
        metadata: mapping.measurementTags
      }
    };
  });

  const catalogOperations = mappings.catalogMappings.map((mapping) => {
    const existing = bundleByKey.get(mapping.recommendedKey);
    return {
      sourceId: mapping.sourceId,
      sourceName: mapping.sourceName,
      targetType: "asset_bundle",
      targetKey: mapping.recommendedKey,
      action: existing ? "link_existing" : "create_draft",
      existing: toExisting(existing),
      writable: false,
      reason: existing
        ? "A local asset bundle already uses this recommended key."
        : "A local draft asset bundle can represent this Prism catalog after offer/content references are chosen.",
      draft: {
        key: mapping.recommendedKey,
        name: mapping.sourceName,
        status: "DRAFT",
        tags: ["meiro_prism", "prism_catalog"],
        metadata: mapping.measurementTags
      }
    };
  });

  const operations = [...campaignOperations, ...assetOperations, ...catalogOperations];
  return {
    operations,
    decisionInputOperations: mappings.decisionInputs.map((mapping) => ({
      sourceId: mapping.sourceId,
      sourceName: mapping.sourceName,
      targetType: mapping.targetType,
      targetKey: mapping.recommendedKey,
      action: "available_for_authoring",
      writable: false,
      reason: mapping.reason,
      dataType: "dataType" in mapping ? mapping.dataType : null
    })),
    counts: {
      total: operations.length,
      createDraft: operations.filter((operation) => operation.action === "create_draft").length,
      linkExisting: operations.filter((operation) => operation.action === "link_existing").length,
      campaigns: campaignOperations.length,
      assets: assetOperations.length,
      catalogs: catalogOperations.length,
      decisionInputs: mappings.decisionInputs.length
    },
    warnings: [
      "Preview only: no local records are created or changed.",
      "Write import should stay opt-in because local campaigns and assets need channel, placement, template, and payload choices."
    ]
  };
};

const parsePayload = async (response: Response): Promise<unknown> => {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text.slice(0, 500);
  }
};

const checkCandidate = async (input: {
  baseUrl: string;
  token: string;
  path: string;
  timeoutMs: number;
}) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(500, input.timeoutMs));
  try {
    const response = await fetch(`${input.baseUrl}${input.path}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${input.token}`,
        "X-Access-Token": input.token,
        "X-API-Key": input.token,
        Accept: "application/json"
      },
      signal: controller.signal
    });
    const payload = await parsePayload(response);
    return {
      path: input.path,
      ok: response.ok,
      status: response.status,
      reachable: true,
      payloadShape:
        payload && typeof payload === "object" && !Array.isArray(payload)
          ? Object.keys(payload as Record<string, unknown>).slice(0, 8)
          : typeof payload
    };
  } finally {
    clearTimeout(timeout);
  }
};

export const registerPipesPrismRoutes = async (deps: {
  app: FastifyInstance;
  prisma?: PrismaClient;
  requireReadAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown> | unknown;
  requireWriteAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown> | unknown;
  resolveEnvironment?: (request: FastifyRequest, reply: FastifyReply) => Environment | null;
  buildResponseError: (reply: FastifyReply, statusCode: number, error: string, details?: unknown) => unknown;
  baseUrl?: string;
  token?: string;
  timeoutMs: number;
  cliCommand: string;
  sourceMode: PrismSourceMode;
}) => {
  const requirePipesCliSource = (reply: FastifyReply) => {
    if (deps.sourceMode === "pipes_cli") return true;
    deps.buildResponseError(reply, 409, "Prism/Pipes CLI source is disabled.", {
      sourceMode: deps.sourceMode,
      activeSource: "meiro_mcp",
      message: "This instance is configured to read Meiro CDP metadata through MCP. Switch MEIRO_PRISM_SOURCE_MODE=pipes_cli to use mpcli/Pipes endpoints."
    });
    return false;
  };

  deps.app.get("/v1/settings/pipes-prism/status", { preHandler: deps.requireReadAuth }, async () => {
    const baseUrl = normalizeBaseUrl(deps.baseUrl);
    const tokenConfigured = Boolean(deps.token?.trim());
    return {
      configured: Boolean(baseUrl && tokenConfigured),
      sourceMode: deps.sourceMode,
      activeSource: deps.sourceMode === "pipes_cli" ? "Pipes CLI" : "Meiro MCP",
      mixedSourceReadsAllowed: false,
      baseUrl: redactUrl(baseUrl),
      tokenConfigured,
      env: {
        baseUrl: "MEIRO_PIPES_BASE_URL",
        token: "MEIRO_PIPES_TOKEN",
        tokenFile: "MEIRO_PIPES_TOKEN_FILE",
        timeoutMs: "MEIRO_PIPES_TIMEOUT_MS",
        cliCommand: "MEIRO_PIPES_CLI_COMMAND",
        sourceMode: "MEIRO_PRISM_SOURCE_MODE",
        mpcliUrl: "MPCLI_URL",
        mpcliToken: "MPCLI_TOKEN",
        mpcliTokenFile: "MPCLI_TOKEN_FILE"
      },
      cli: cliStatus(deps.cliCommand),
      notes: [
        "Only one Meiro data source is active per request. Use MEIRO_PRISM_SOURCE_MODE=pipes_cli or meiro_mcp; mixed source reads are intentionally disabled.",
        "Token values are read only from environment and are never returned by this endpoint.",
        "CLI detection checks whether the configured command is available in the API container."
      ]
    };
  });

  deps.app.post("/v1/settings/pipes-prism/check", { preHandler: deps.requireWriteAuth }, async (_request, reply) => {
    if (!requirePipesCliSource(reply)) return;
    const baseUrl = normalizeBaseUrl(deps.baseUrl);
    const token = deps.token?.trim();
    if (!baseUrl || !token) {
      return deps.buildResponseError(reply, 400, "MEIRO_PIPES_BASE_URL and MEIRO_PIPES_TOKEN must be configured.");
    }

    const paths = [
      "/api/auth/me",
      "/api/settings",
      "/api/dashboard",
      "/api/health/heartbeat",
      "/api/health/queues",
      "/skill"
    ];
    const cli = cliStatus(deps.cliCommand);
    const attempts = [];
    for (const path of paths) {
      try {
        const attempt = cli.installed
          ? cliApiStatus({
              command: deps.cliCommand,
              baseUrl,
              token,
              path,
              timeoutMs: deps.timeoutMs
            })
          : await checkCandidate({
              baseUrl,
              token,
              path,
              timeoutMs: deps.timeoutMs
            });
        attempts.push(attempt);
        if (attempt.ok) {
          return {
            ok: true,
            baseUrl: redactUrl(baseUrl),
            selectedPath: path,
            attempts,
            cli
          };
        }
      } catch (error) {
        attempts.push({
          path,
          ok: false,
          reachable: false,
          error: error instanceof Error ? error.message : "Request failed"
        });
      }
    }

    return {
      ok: false,
      baseUrl: redactUrl(baseUrl),
      attempts,
      cli
    };
  });

  const collectImportCandidates = (baseUrl: string, token: string) => {
    const cli = cliStatus(deps.cliCommand);
    if (!cli.installed) {
      return { error: "mpcli is not available in the API container.", cli };
    }

    const targets = [
      { key: "audiences", label: "Audiences", path: "/api/audiences", mapsTo: "Activation audiences and decision eligibility inputs" },
      { key: "campaigns", label: "Channel campaigns", path: "/api/channels/campaigns", mapsTo: "Native campaign anchors for decisions and measurement" },
      { key: "assets", label: "Assets", path: "/api/assets", mapsTo: "Reusable content and creative assets" },
      { key: "catalogs", label: "Catalogs", path: "/api/catalogs", mapsTo: "Offers, products, bundles, and saved feeds" },
      { key: "attributes", label: "Attributes", path: "/api/attributes", mapsTo: "Profile fields required by decision logic" }
    ];

    const sections = targets.map((target) => {
      const result = runCliApi({
        command: deps.cliCommand,
        baseUrl,
        token,
        method: "GET",
        path: target.path,
        timeoutMs: deps.timeoutMs
      });
      if (!result.ok) {
        return {
          ...target,
          ok: false,
          count: 0,
          items: [],
          error: result.error,
          durationMs: result.durationMs
        };
      }
      const items = summarizeItems(result.payload);
      return {
        ...target,
        ok: true,
        count: items.length,
        items,
        durationMs: result.durationMs
      };
    });

    return {
      ok: sections.some((section) => section.ok),
      baseUrl: redactUrl(baseUrl),
      cli,
      sections,
      notes: [
        "This endpoint is read-only and returns summarized Prism entities only.",
        "Full Prism payloads and token values are not returned."
      ]
    };
  };

  deps.app.get("/v1/settings/pipes-prism/import-candidates", { preHandler: deps.requireReadAuth }, async (_request, reply) => {
    if (!requirePipesCliSource(reply)) return;
    const baseUrl = normalizeBaseUrl(deps.baseUrl);
    const token = deps.token?.trim();
    if (!baseUrl || !token) {
      return deps.buildResponseError(reply, 400, "MEIRO_PIPES_BASE_URL and MEIRO_PIPES_TOKEN must be configured.");
    }

    const result = collectImportCandidates(baseUrl, token);
    if ("error" in result) {
      return deps.buildResponseError(reply, 503, result.error ?? "Failed to collect Prism import candidates.", result.cli);
    }
    return result;
  });

  deps.app.get("/v1/settings/pipes-prism/import-snapshot", { preHandler: deps.requireReadAuth }, async (request, reply) => {
    if (!requirePipesCliSource(reply)) return;
    const environment = deps.resolveEnvironment?.(request, reply) ?? "DEV";
    if (!environment) return;
    if (!deps.prisma) {
      return deps.buildResponseError(reply, 409, "Prism import snapshot storage is unavailable.");
    }
    const row = await deps.prisma.appSetting.findFirst({
      where: { environment, key: PRISM_IMPORT_SNAPSHOT_KEY }
    });
    return {
      environment,
      sourceMode: deps.sourceMode,
      snapshot: row?.valueJson ?? null,
      updatedAt: row?.updatedAt?.toISOString() ?? null
    };
  });

  deps.app.post("/v1/settings/pipes-prism/import-snapshot", { preHandler: deps.requireWriteAuth }, async (request, reply) => {
    if (!requirePipesCliSource(reply)) return;
    const environment = deps.resolveEnvironment?.(request, reply) ?? "DEV";
    if (!environment) return;
    if (!deps.prisma) {
      return deps.buildResponseError(reply, 409, "Prism import snapshot storage is unavailable.");
    }
    const baseUrl = normalizeBaseUrl(deps.baseUrl);
    const token = deps.token?.trim();
    if (!baseUrl || !token) {
      return deps.buildResponseError(reply, 400, "MEIRO_PIPES_BASE_URL and MEIRO_PIPES_TOKEN must be configured.");
    }

    const result = collectImportCandidates(baseUrl, token);
    if ("error" in result) {
      return deps.buildResponseError(reply, 503, result.error ?? "Failed to collect Prism import candidates.", result.cli);
    }

    const snapshot = {
      ...result,
      environment,
      sourceMode: deps.sourceMode,
      syncedAt: new Date().toISOString()
    };
    const existing = await deps.prisma.appSetting.findFirst({
      where: { environment, key: PRISM_IMPORT_SNAPSHOT_KEY }
    });
    const valueJson = snapshot as unknown as Prisma.InputJsonValue;
    const row = existing
      ? await deps.prisma.appSetting.update({
          where: { id: existing.id },
          data: { valueJson }
        })
      : await deps.prisma.appSetting.create({
          data: {
            environment,
            key: PRISM_IMPORT_SNAPSHOT_KEY,
            valueJson
          }
        });

    return {
      environment,
      snapshot: row.valueJson,
      updatedAt: row.updatedAt.toISOString()
    };
  });

  deps.app.get("/v1/settings/pipes-prism/field-registry", { preHandler: deps.requireReadAuth }, async (request, reply) => {
    if (!requirePipesCliSource(reply)) return;
    const environment = deps.resolveEnvironment?.(request, reply) ?? "DEV";
    if (!environment) return;
    if (!deps.prisma) {
      return deps.buildResponseError(reply, 409, "Prism field registry storage is unavailable.");
    }
    const row = await deps.prisma.appSetting.findFirst({
      where: { environment, key: PRISM_IMPORT_SNAPSHOT_KEY }
    });
    const snapshot = row?.valueJson ?? null;
    const attributes = sectionItems(snapshot, "attributes").map((item) => ({
      field: firstString(item, ["id", "key", "name"]) ?? "unknown",
      label: firstString(item, ["name", "id"]) ?? "Unnamed",
      dataType: fieldTypeFromPrismType(item.type),
      description: "Prism profile attribute",
      source: "prism_snapshot" as const,
      updatedAt: firstString(item, ["updatedAt"])
    }));
    const audiences = sectionItems(snapshot, "audiences").map((item) => ({
      id: firstString(item, ["id", "key", "name"]) ?? "unknown",
      name: firstString(item, ["name", "id"]) ?? "Unnamed",
      source: "prism_snapshot" as const,
      updatedAt: firstString(item, ["updatedAt"])
    }));

    return {
      environment,
      sourceMode: deps.sourceMode,
      updatedAt: row?.updatedAt?.toISOString() ?? null,
      syncedAt: firstString(asRecord(snapshot) ?? {}, ["syncedAt"]),
      attributes,
      audiences,
      counts: {
        attributes: attributes.length,
        audiences: audiences.length
      }
    };
  });

  deps.app.get("/v1/settings/pipes-prism/mapping-recommendations", { preHandler: deps.requireReadAuth }, async (request, reply) => {
    if (!requirePipesCliSource(reply)) return;
    const environment = deps.resolveEnvironment?.(request, reply) ?? "DEV";
    if (!environment) return;
    if (!deps.prisma) {
      return deps.buildResponseError(reply, 409, "Prism mapping recommendation storage is unavailable.");
    }
    const row = await deps.prisma.appSetting.findFirst({
      where: { environment, key: PRISM_IMPORT_SNAPSHOT_KEY }
    });
    const snapshot = row?.valueJson ?? null;

    return {
      environment,
      sourceMode: deps.sourceMode,
      updatedAt: row?.updatedAt?.toISOString() ?? null,
      syncedAt: firstString(asRecord(snapshot) ?? {}, ["syncedAt"]),
      ...buildMappingRecommendations(snapshot)
    };
  });

  deps.app.get("/v1/settings/pipes-prism/import-preview", { preHandler: deps.requireReadAuth }, async (request, reply) => {
    if (!requirePipesCliSource(reply)) return;
    const environment = deps.resolveEnvironment?.(request, reply) ?? "DEV";
    if (!environment) return;
    if (!deps.prisma) {
      return deps.buildResponseError(reply, 409, "Prism import preview storage is unavailable.");
    }
    const row = await deps.prisma.appSetting.findFirst({
      where: { environment, key: PRISM_IMPORT_SNAPSHOT_KEY }
    });
    const snapshot = row?.valueJson ?? null;
    const preview = await buildImportPreview({ prisma: deps.prisma, environment, snapshot });

    return {
      environment,
      sourceMode: deps.sourceMode,
      updatedAt: row?.updatedAt?.toISOString() ?? null,
      syncedAt: firstString(asRecord(snapshot) ?? {}, ["syncedAt"]),
      ...preview
    };
  });
};

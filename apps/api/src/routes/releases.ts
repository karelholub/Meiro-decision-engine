import { Prisma, type PrismaClient } from "@prisma/client";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { deriveDecisionRequiredAttributes } from "../lib/requirements";
import { stableStringify } from "../lib/cacheKey";

const environmentSchema = z.enum(["DEV", "STAGE", "PROD"]);
const releaseEntityTypeSchema = z.enum([
  "decision",
  "stack",
  "offer",
  "content",
  "campaign",
  "policy",
  "template",
  "placement",
  "app"
]);

const selectionSchema = z.object({
  type: releaseEntityTypeSchema,
  key: z.string().min(1),
  version: z.number().int().positive().optional()
});

const planBodySchema = z.object({
  sourceEnv: environmentSchema,
  targetEnv: environmentSchema,
  selection: z.array(selectionSchema).min(1),
  mode: z.enum(["copy_as_draft", "copy_and_activate"]).default("copy_as_draft")
});

const approveBodySchema = z
  .object({
    note: z.string().trim().max(2000).optional()
  })
  .optional();

const releaseIdParamsSchema = z.object({
  id: z.string().uuid()
});

interface ReleasePlanItem {
  type: z.infer<typeof releaseEntityTypeSchema>;
  key: string;
  version: number;
  action: "create_new" | "update_new_version" | "noop";
  dependsOn: Array<{ type: z.infer<typeof releaseEntityTypeSchema>; key: string; version: number }>;
  diff: {
    hasChanges: boolean;
    summary: string;
    jsonPatch?: Array<Record<string, unknown>>;
  };
  riskFlags: string[];
  sourceSnapshot: unknown;
  targetVersion: number;
}

interface AuthLike {
  userId?: string | null;
  email?: string | null;
  permissions: Set<string>;
  isAdmin: boolean;
}

const isObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const toJson = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;

const valueDigest = (value: unknown): string => stableStringify(value);

const topLevelDiffSummary = (source: unknown, target: unknown): string => {
  if (!isObject(source) || !isObject(target)) {
    return source === target ? "No changes" : "Payload changed";
  }
  const changed = new Set<string>();
  for (const key of new Set([...Object.keys(source), ...Object.keys(target)])) {
    if (valueDigest(source[key]) !== valueDigest(target[key])) {
      changed.add(key);
    }
  }
  if (changed.size === 0) {
    return "No changes";
  }
  return `Changed fields: ${[...changed].slice(0, 8).join(", ")}${changed.size > 8 ? ` (+${changed.size - 8} more)` : ""}`;
};

const extractDecisionRefs = (definition: unknown) => {
  const contentKeys = new Set<string>();
  const offerKeys = new Set<string>();

  const walk = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const item of value) {
        walk(item);
      }
      return;
    }
    if (!isObject(value)) {
      return;
    }

    if (isObject(value.payloadRef)) {
      if (typeof value.payloadRef.contentKey === "string" && value.payloadRef.contentKey.trim()) {
        contentKeys.add(value.payloadRef.contentKey.trim());
      }
      if (typeof value.payloadRef.offerKey === "string" && value.payloadRef.offerKey.trim()) {
        offerKeys.add(value.payloadRef.offerKey.trim());
      }
    }

    if (typeof value.offerKey === "string" && value.offerKey.trim()) {
      offerKeys.add(value.offerKey.trim());
    }
    if (typeof value.contentKey === "string" && value.contentKey.trim()) {
      contentKeys.add(value.contentKey.trim());
    }

    for (const nested of Object.values(value)) {
      walk(nested);
    }
  };

  walk(definition);
  return {
    contentKeys: [...contentKeys],
    offerKeys: [...offerKeys]
  };
};

const extractStackDecisionRefs = (definition: unknown): string[] => {
  if (!isObject(definition) || !Array.isArray(definition.steps)) {
    return [];
  }
  const keys = new Set<string>();
  for (const step of definition.steps) {
    if (isObject(step) && typeof step.decisionKey === "string" && step.decisionKey.trim()) {
      keys.add(step.decisionKey.trim());
    }
  }
  return [...keys];
};

const extractContentOfferRefs = (contentSnapshot: unknown): string[] => {
  if (!isObject(contentSnapshot) || !isObject(contentSnapshot.tokenBindings)) {
    return [];
  }
  const offers = new Set<string>();
  for (const value of Object.values(contentSnapshot.tokenBindings)) {
    if (isObject(value) && typeof value.offerKey === "string" && value.offerKey.trim()) {
      offers.add(value.offerKey.trim());
    }
    if (typeof value === "string") {
      const match = value.match(/offer(?:Key)?[:.]([a-zA-Z0-9_-]+)/);
      if (match?.[1]) {
        offers.add(match[1]);
      }
    }
  }
  return [...offers];
};

const buildDecisionRiskFlags = (definition: unknown): string[] => {
  const risks = new Set<string>();
  if (!isObject(definition)) {
    return [];
  }

  const eligibility = isObject(definition.eligibility) ? definition.eligibility : undefined;
  const hasAudience =
    (Array.isArray(eligibility?.audiencesAny) && eligibility.audiencesAny.length > 0) ||
    (Array.isArray(eligibility?.audiencesAll) && eligibility.audiencesAll.length > 0) ||
    (Array.isArray(eligibility?.audiencesNone) && eligibility.audiencesNone.length > 0);
  const hasAttribute = Array.isArray(eligibility?.attributes) && eligibility.attributes.length > 0;
  if (!hasAudience && !hasAttribute) {
    risks.add("APPLIES_TO_ALL");
  }

  const rules = isObject(definition.flow) && Array.isArray(definition.flow.rules) ? definition.flow.rules : [];
  const usesMessage = rules.some((rule) => isObject(rule) && isObject(rule.then) && rule.then.actionType === "message");
  const caps = isObject(definition.caps) ? definition.caps : undefined;
  const hasCaps = typeof caps?.perProfilePerDay === "number" || typeof caps?.perProfilePerWeek === "number";
  if (usesMessage && !hasCaps) {
    risks.add("NO_CAPS");
  }

  return [...risks];
};

const normalizeDecisionDefinitionForTarget = (definition: unknown, targetVersion: number, status: string) => {
  if (!isObject(definition)) {
    return definition;
  }
  return {
    ...definition,
    version: targetVersion,
    status,
    activatedAt: status === "ACTIVE" ? new Date().toISOString() : null,
    updatedAt: new Date().toISOString(),
    metadata: {
      ...(isObject(definition.metadata) ? definition.metadata : {}),
      sourceVersion: isObject(definition) && typeof definition.version === "number" ? definition.version : undefined
    }
  };
};

const normalizeStackDefinitionForTarget = (definition: unknown, targetVersion: number, status: string) => {
  if (!isObject(definition)) {
    return definition;
  }
  return {
    ...definition,
    version: targetVersion,
    status,
    activatedAt: status === "ACTIVE" ? new Date().toISOString() : null,
    updatedAt: new Date().toISOString(),
    metadata: {
      ...(isObject(definition.metadata) ? definition.metadata : {}),
      sourceVersion: isObject(definition) && typeof definition.version === "number" ? definition.version : undefined
    }
  };
};

const releaseItemId = (item: { type: string; key: string; version: number }) => `${item.type}:${item.key}:${item.version}`;

export const registerReleaseRoutes = async (deps: {
  app: FastifyInstance;
  prisma: PrismaClient;
  buildResponseError: (reply: FastifyReply, statusCode: number, error: string, details?: unknown) => unknown;
  resolveAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<AuthLike | null>;
  requirePermission: (permission: string) => (request: FastifyRequest, reply: FastifyReply) => Promise<unknown> | unknown;
  requireAnyPermission: (permissions: string[]) => (request: FastifyRequest, reply: FastifyReply) => Promise<unknown> | unknown;
}) => {
  const { app, prisma, buildResponseError, resolveAuth, requirePermission, requireAnyPermission } = deps;

  const audit = async (input: {
    env?: string;
    action: string;
    actor?: AuthLike | null;
    entityType?: string;
    entityKey?: string;
    entityVersion?: number;
    metadata?: unknown;
  }) => {
    const auditModel = (prisma as any).auditEvent;
    if (!auditModel?.create) {
      return;
    }
    await auditModel.create({
      data: {
        env: input.env,
        actorUserId: input.actor?.userId ?? null,
        actorEmail: input.actor?.email ?? null,
        action: input.action,
        entityType: input.entityType,
        entityKey: input.entityKey,
        entityVersion: input.entityVersion,
        metadata: input.metadata ? toJson(input.metadata) : undefined
      }
    });
  };

  const fetchSourceSnapshot = async (selection: z.infer<typeof selectionSchema>, sourceEnv: string) => {
    switch (selection.type) {
      case "decision": {
        const version = await (prisma as any).decisionVersion.findFirst({
          where: {
            ...(selection.version ? { version: selection.version } : { status: "ACTIVE" }),
            decision: {
              environment: sourceEnv,
              key: selection.key
            }
          },
          include: {
            decision: true
          },
          orderBy: { version: "desc" }
        });
        if (!version) {
          return null;
        }
        return {
          type: selection.type,
          key: selection.key,
          version: version.version as number,
          sourceSnapshot: version.definitionJson,
          record: version
        };
      }
      case "stack": {
        const stack = await (prisma as any).decisionStack.findFirst({
          where: {
            environment: sourceEnv,
            key: selection.key,
            ...(selection.version ? { version: selection.version } : { status: "ACTIVE" })
          },
          orderBy: { version: "desc" }
        });
        if (!stack) {
          return null;
        }
        return {
          type: selection.type,
          key: selection.key,
          version: stack.version as number,
          sourceSnapshot: stack.definitionJson,
          record: stack
        };
      }
      case "offer": {
        const offer = await (prisma as any).offer.findFirst({
          where: {
            environment: sourceEnv,
            key: selection.key,
            ...(selection.version ? { version: selection.version } : { status: "ACTIVE" })
          },
          orderBy: { version: "desc" }
        });
        if (!offer) {
          return null;
        }
        return {
          type: selection.type,
          key: selection.key,
          version: offer.version as number,
          sourceSnapshot: offer,
          record: offer
        };
      }
      case "content": {
        const content = await (prisma as any).contentBlock.findFirst({
          where: {
            environment: sourceEnv,
            key: selection.key,
            ...(selection.version ? { version: selection.version } : { status: "ACTIVE" })
          },
          orderBy: { version: "desc" }
        });
        if (!content) {
          return null;
        }
        return {
          type: selection.type,
          key: selection.key,
          version: content.version as number,
          sourceSnapshot: content,
          record: content
        };
      }
      case "campaign": {
        const campaign = await (prisma as any).inAppCampaign.findFirst({
          where: {
            environment: sourceEnv,
            key: selection.key
          },
          include: {
            variants: true
          }
        });
        if (!campaign) {
          return null;
        }
        return {
          type: selection.type,
          key: selection.key,
          version: 1,
          sourceSnapshot: campaign,
          record: campaign
        };
      }
      case "policy": {
        const policy = await (prisma as any).orchestrationPolicy.findFirst({
          where: {
            environment: sourceEnv,
            key: selection.key,
            ...(selection.version ? { version: selection.version } : { status: "ACTIVE" })
          },
          orderBy: { version: "desc" }
        });
        if (!policy) {
          return null;
        }
        return {
          type: selection.type,
          key: selection.key,
          version: policy.version as number,
          sourceSnapshot: policy.policyJson,
          record: policy
        };
      }
      case "template": {
        const template = await (prisma as any).inAppTemplate.findFirst({
          where: {
            environment: sourceEnv,
            key: selection.key
          }
        });
        if (!template) {
          return null;
        }
        return {
          type: selection.type,
          key: selection.key,
          version: 1,
          sourceSnapshot: template,
          record: template
        };
      }
      case "placement": {
        const placement = await (prisma as any).inAppPlacement.findFirst({
          where: {
            environment: sourceEnv,
            key: selection.key
          }
        });
        if (!placement) {
          return null;
        }
        return {
          type: selection.type,
          key: selection.key,
          version: 1,
          sourceSnapshot: placement,
          record: placement
        };
      }
      case "app": {
        const appRecord = await (prisma as any).inAppApplication.findFirst({
          where: {
            environment: sourceEnv,
            key: selection.key
          }
        });
        if (!appRecord) {
          return null;
        }
        return {
          type: selection.type,
          key: selection.key,
          version: 1,
          sourceSnapshot: appRecord,
          record: appRecord
        };
      }
      default:
        return null;
    }
  };

  const fetchTargetVersionMeta = async (item: { type: string; key: string; sourceSnapshot: unknown }, targetEnv: string) => {
    switch (item.type) {
      case "decision": {
        const decision = await (prisma as any).decision.findFirst({
          where: { environment: targetEnv, key: item.key },
          include: { versions: { orderBy: { version: "desc" }, take: 20 } }
        });
        if (!decision) {
          return { action: "create_new" as const, targetVersion: 1, existingSnapshot: null };
        }
        const maxVersion = decision.versions[0]?.version ?? 0;
        const same = decision.versions.find((version: any) => valueDigest(version.definitionJson) === valueDigest(item.sourceSnapshot));
        if (same) {
          return { action: "noop" as const, targetVersion: same.version as number, existingSnapshot: same.definitionJson };
        }
        return { action: "update_new_version" as const, targetVersion: maxVersion + 1, existingSnapshot: decision.versions[0]?.definitionJson ?? null };
      }
      case "stack": {
        const versions = await (prisma as any).decisionStack.findMany({
          where: { environment: targetEnv, key: item.key },
          orderBy: { version: "desc" },
          take: 20
        });
        if (versions.length === 0) {
          return { action: "create_new" as const, targetVersion: 1, existingSnapshot: null };
        }
        const same = versions.find((version: any) => valueDigest(version.definitionJson) === valueDigest(item.sourceSnapshot));
        if (same) {
          return { action: "noop" as const, targetVersion: same.version as number, existingSnapshot: same.definitionJson };
        }
        return {
          action: "update_new_version" as const,
          targetVersion: (versions[0]?.version ?? 0) + 1,
          existingSnapshot: versions[0]?.definitionJson ?? null
        };
      }
      case "offer": {
        const versions = await (prisma as any).offer.findMany({
          where: { environment: targetEnv, key: item.key },
          orderBy: { version: "desc" },
          take: 20
        });
        if (versions.length === 0) {
          return { action: "create_new" as const, targetVersion: 1, existingSnapshot: null };
        }
        const same = versions.find((version: any) => valueDigest(version.valueJson) === valueDigest((item.sourceSnapshot as any)?.valueJson));
        if (same) {
          return { action: "noop" as const, targetVersion: same.version as number, existingSnapshot: same };
        }
        return { action: "update_new_version" as const, targetVersion: (versions[0]?.version ?? 0) + 1, existingSnapshot: versions[0] };
      }
      case "content": {
        const versions = await (prisma as any).contentBlock.findMany({
          where: { environment: targetEnv, key: item.key },
          orderBy: { version: "desc" },
          take: 20
        });
        if (versions.length === 0) {
          return { action: "create_new" as const, targetVersion: 1, existingSnapshot: null };
        }
        const same = versions.find((version: any) => valueDigest(version.localesJson) === valueDigest((item.sourceSnapshot as any)?.localesJson));
        if (same) {
          return { action: "noop" as const, targetVersion: same.version as number, existingSnapshot: same };
        }
        return { action: "update_new_version" as const, targetVersion: (versions[0]?.version ?? 0) + 1, existingSnapshot: versions[0] };
      }
      case "policy": {
        const versions = await (prisma as any).orchestrationPolicy.findMany({
          where: { environment: targetEnv, key: item.key },
          orderBy: { version: "desc" },
          take: 20
        });
        if (versions.length === 0) {
          return { action: "create_new" as const, targetVersion: 1, existingSnapshot: null };
        }
        const same = versions.find((version: any) => valueDigest(version.policyJson) === valueDigest(item.sourceSnapshot));
        if (same) {
          return { action: "noop" as const, targetVersion: same.version as number, existingSnapshot: same.policyJson };
        }
        return {
          action: "update_new_version" as const,
          targetVersion: (versions[0]?.version ?? 0) + 1,
          existingSnapshot: versions[0]?.policyJson ?? null
        };
      }
      case "campaign": {
        const existing = await (prisma as any).inAppCampaign.findFirst({
          where: { environment: targetEnv, key: item.key },
          include: { variants: true }
        });
        if (!existing) {
          return { action: "create_new" as const, targetVersion: 1, existingSnapshot: null };
        }
        const same = valueDigest(existing) === valueDigest(item.sourceSnapshot);
        return {
          action: same ? ("noop" as const) : ("update_new_version" as const),
          targetVersion: 1,
          existingSnapshot: existing
        };
      }
      case "template": {
        const existing = await (prisma as any).inAppTemplate.findFirst({ where: { environment: targetEnv, key: item.key } });
        if (!existing) {
          return { action: "create_new" as const, targetVersion: 1, existingSnapshot: null };
        }
        return {
          action: valueDigest(existing.schemaJson) === valueDigest((item.sourceSnapshot as any).schemaJson) ? ("noop" as const) : ("update_new_version" as const),
          targetVersion: 1,
          existingSnapshot: existing
        };
      }
      case "placement": {
        const existing = await (prisma as any).inAppPlacement.findFirst({ where: { environment: targetEnv, key: item.key } });
        if (!existing) {
          return { action: "create_new" as const, targetVersion: 1, existingSnapshot: null };
        }
        return {
          action: valueDigest(existing.allowedTemplateKeys) === valueDigest((item.sourceSnapshot as any).allowedTemplateKeys) ? ("noop" as const) : ("update_new_version" as const),
          targetVersion: 1,
          existingSnapshot: existing
        };
      }
      case "app": {
        const existing = await (prisma as any).inAppApplication.findFirst({ where: { environment: targetEnv, key: item.key } });
        if (!existing) {
          return { action: "create_new" as const, targetVersion: 1, existingSnapshot: null };
        }
        return {
          action: valueDigest(existing.platforms) === valueDigest((item.sourceSnapshot as any).platforms) ? ("noop" as const) : ("update_new_version" as const),
          targetVersion: 1,
          existingSnapshot: existing
        };
      }
      default:
        return { action: "create_new" as const, targetVersion: 1, existingSnapshot: null };
    }
  };

  app.post("/v1/releases/plan", { preHandler: requirePermission("promotion.create") }, async (request, reply) => {
    const parsed = planBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return buildResponseError(reply, 400, "Invalid body", parsed.error.flatten());
    }
    if (parsed.data.sourceEnv === parsed.data.targetEnv) {
      return buildResponseError(reply, 400, "sourceEnv and targetEnv must differ");
    }

    const auth = await resolveAuth(request, reply);
    if (!auth) {
      return buildResponseError(reply, 401, "Unauthorized");
    }

    const visited = new Set<string>();
    const itemsById = new Map<string, ReleasePlanItem>();

    const wbsMappingTarget = await (prisma as any).wbsMapping.findFirst({
      where: { environment: parsed.data.targetEnv, isActive: true },
      orderBy: { updatedAt: "desc" }
    });
    const targetFields = new Set<string>();
    if (wbsMappingTarget?.mappingJson && isObject(wbsMappingTarget.mappingJson) && Array.isArray(wbsMappingTarget.mappingJson.attributeMappings)) {
      for (const mapping of wbsMappingTarget.mappingJson.attributeMappings) {
        if (isObject(mapping) && typeof mapping.sourceKey === "string") {
          targetFields.add(mapping.sourceKey);
        }
      }
    }

    const addSelection = async (selection: z.infer<typeof selectionSchema>, dependentOn?: ReleasePlanItem) => {
      const source = await fetchSourceSnapshot(selection, parsed.data.sourceEnv);
      if (!source) {
        return;
      }
      const candidateId = releaseItemId(source);
      if (visited.has(candidateId)) {
        if (dependentOn) {
          const existing = itemsById.get(candidateId);
          if (existing) {
            dependentOn.dependsOn.push({ type: existing.type, key: existing.key, version: existing.version });
          }
        }
        return;
      }
      visited.add(candidateId);

      const targetMeta = await fetchTargetVersionMeta(source, parsed.data.targetEnv);
      const riskFlags = new Set<string>();

      if (source.type === "decision") {
        for (const risk of buildDecisionRiskFlags(source.sourceSnapshot)) {
          riskFlags.add(risk);
        }
        if (isObject(source.sourceSnapshot)) {
          const requiredFields = deriveDecisionRequiredAttributes(source.sourceSnapshot as any);
          if (requiredFields.some((field) => !targetFields.has(field))) {
            riskFlags.add("MISSING_FIELDS_IN_TARGET");
          }
        }
      }

      const newItem: ReleasePlanItem = {
        type: source.type,
        key: source.key,
        version: source.version,
        action: targetMeta.action,
        dependsOn: [],
        diff: {
          hasChanges: targetMeta.action !== "noop",
          summary: topLevelDiffSummary(source.sourceSnapshot, targetMeta.existingSnapshot)
        },
        riskFlags: [...riskFlags],
        sourceSnapshot: source.sourceSnapshot,
        targetVersion: targetMeta.targetVersion
      };
      itemsById.set(candidateId, newItem);

      if (dependentOn) {
        dependentOn.dependsOn.push({ type: newItem.type, key: newItem.key, version: newItem.version });
      }

      if (source.type === "decision") {
        const refs = extractDecisionRefs(source.sourceSnapshot);
        for (const contentKey of refs.contentKeys) {
          await addSelection({ type: "content", key: contentKey }, newItem);
        }
        for (const offerKey of refs.offerKeys) {
          await addSelection({ type: "offer", key: offerKey }, newItem);
        }
      }

      if (source.type === "stack") {
        const decisionKeys = extractStackDecisionRefs(source.sourceSnapshot);
        for (const decisionKey of decisionKeys) {
          await addSelection({ type: "decision", key: decisionKey }, newItem);
        }
      }

      if (source.type === "campaign") {
        const snapshot = source.sourceSnapshot as Record<string, unknown>;
        if (typeof snapshot.appKey === "string" && snapshot.appKey.trim()) {
          await addSelection({ type: "app", key: snapshot.appKey.trim() }, newItem);
        } else {
          newItem.riskFlags.push("MISSING_DEPENDENCY_IN_TARGET");
        }
        if (typeof snapshot.placementKey === "string" && snapshot.placementKey.trim()) {
          await addSelection({ type: "placement", key: snapshot.placementKey.trim() }, newItem);
        } else {
          newItem.riskFlags.push("MISSING_DEPENDENCY_IN_TARGET");
        }
        if (typeof snapshot.templateKey === "string" && snapshot.templateKey.trim()) {
          await addSelection({ type: "template", key: snapshot.templateKey.trim() }, newItem);
        } else {
          newItem.riskFlags.push("MISSING_DEPENDENCY_IN_TARGET");
        }
        if (typeof snapshot.contentKey === "string" && snapshot.contentKey.trim()) {
          await addSelection({ type: "content", key: snapshot.contentKey.trim() }, newItem);
        }
        if (typeof snapshot.offerKey === "string" && snapshot.offerKey.trim()) {
          await addSelection({ type: "offer", key: snapshot.offerKey.trim() }, newItem);
        }
      }

      if (source.type === "content") {
        for (const offerKey of extractContentOfferRefs(source.sourceSnapshot)) {
          await addSelection({ type: "offer", key: offerKey }, newItem);
        }
      }
    };

    for (const selection of parsed.data.selection) {
      await addSelection(selection);
    }

    const items = [...itemsById.values()];
    const plan = {
      sourceEnv: parsed.data.sourceEnv,
      targetEnv: parsed.data.targetEnv,
      mode: parsed.data.mode,
      items,
      graph: items.map((item) => ({
        id: releaseItemId(item),
        dependsOn: item.dependsOn.map((dep) => releaseItemId(dep))
      }))
    };

    const releaseKey = `rel_${new Date().toISOString().slice(0, 10)}_${Math.random().toString(36).slice(2, 8)}`;
    const releaseRecord = await (prisma as any).release.create({
      data: {
        sourceEnv: parsed.data.sourceEnv,
        targetEnv: parsed.data.targetEnv,
        key: releaseKey,
        status: "READY",
        createdByUserId: auth.userId ?? null,
        createdByEmail: auth.email ?? null,
        summary: `${items.length} item(s) from ${parsed.data.sourceEnv} to ${parsed.data.targetEnv}`,
        planJson: toJson(plan)
      }
    });

    await audit({
      env: parsed.data.targetEnv,
      action: "release.plan",
      actor: auth,
      entityType: "release",
      entityKey: releaseRecord.key,
      metadata: { sourceEnv: parsed.data.sourceEnv, targetEnv: parsed.data.targetEnv, itemCount: items.length }
    });

    return reply.code(201).send({
      releaseId: releaseRecord.id,
      plan
    });
  });

  app.post("/v1/releases/:id/approve", { preHandler: requirePermission("promotion.approve") }, async (request, reply) => {
    const params = releaseIdParamsSchema.safeParse(request.params);
    if (!params.success) {
      return buildResponseError(reply, 400, "Invalid release id", params.error.flatten());
    }
    const parsedBody = approveBodySchema.safeParse(request.body);
    if (!parsedBody.success) {
      return buildResponseError(reply, 400, "Invalid body", parsedBody.error.flatten());
    }

    const auth = await resolveAuth(request, reply);
    if (!auth) {
      return buildResponseError(reply, 401, "Unauthorized");
    }

    const updated = await (prisma as any).release.update({
      where: { id: params.data.id },
      data: {
        status: "APPROVED",
        approvalByUserId: auth.userId ?? null,
        approvalNote: parsedBody.data?.note
      }
    });

    await audit({
      env: updated.targetEnv,
      action: "release.approve",
      actor: auth,
      entityType: "release",
      entityKey: updated.key,
      metadata: { note: parsedBody.data?.note ?? null }
    });

    return reply.send({ item: updated });
  });

  app.post("/v1/releases/:id/apply", { preHandler: requirePermission("promotion.apply") }, async (request, reply) => {
    const params = releaseIdParamsSchema.safeParse(request.params);
    if (!params.success) {
      return buildResponseError(reply, 400, "Invalid release id", params.error.flatten());
    }

    const auth = await resolveAuth(request, reply);
    if (!auth) {
      return buildResponseError(reply, 401, "Unauthorized");
    }

    const releaseRecord = await (prisma as any).release.findUnique({ where: { id: params.data.id } });
    if (!releaseRecord) {
      return buildResponseError(reply, 404, "Release not found");
    }
    if (releaseRecord.targetEnv === "PROD" && releaseRecord.status !== "APPROVED" && !auth.isAdmin) {
      return buildResponseError(reply, 403, "Release must be approved before applying to PROD");
    }

    const plan = isObject(releaseRecord.planJson) ? releaseRecord.planJson : null;
    if (!plan || !Array.isArray(plan.items)) {
      return buildResponseError(reply, 409, "Release plan is missing or invalid");
    }

    const mode = plan.mode === "copy_and_activate" ? "copy_and_activate" : "copy_as_draft";
    const items: ReleasePlanItem[] = plan.items as ReleasePlanItem[];

    const resolveActivationPermission = (type: string): string | null => {
      if (type === "decision") return "decision.activate";
      if (type === "stack") return "stack.activate";
      if (type === "offer") return "catalog.offer.activate";
      if (type === "content") return "catalog.content.activate";
      if (type === "campaign") return "engage.campaign.activate";
      if (type === "policy") return "engage.campaign.activate";
      return null;
    };

    if (mode === "copy_and_activate") {
      for (const item of items) {
        const activationPermission = resolveActivationPermission(item.type);
        if (activationPermission && !auth.isAdmin && !auth.permissions.has(activationPermission)) {
          return buildResponseError(reply, 403, `Missing activation permission in target env: ${activationPermission}`);
        }
      }
    }

    const applyOrder = ["offer", "content", "template", "placement", "app", "decision", "stack", "policy", "campaign"];
    const sorted = [...items].sort((left, right) => applyOrder.indexOf(left.type) - applyOrder.indexOf(right.type));

    try {
      const beforeActiveSnapshot: Array<{ type: string; key: string; activeVersion: number | null }> = [];
      for (const item of sorted) {
        if (item.type === "decision") {
          const active = await (prisma as any).decisionVersion.findFirst({
            where: { decision: { environment: releaseRecord.targetEnv, key: item.key }, status: "ACTIVE" },
            orderBy: { version: "desc" }
          });
          beforeActiveSnapshot.push({ type: item.type, key: item.key, activeVersion: active?.version ?? null });
        } else if (item.type === "stack") {
          const active = await (prisma as any).decisionStack.findFirst({
            where: { environment: releaseRecord.targetEnv, key: item.key, status: "ACTIVE" },
            orderBy: { version: "desc" }
          });
          beforeActiveSnapshot.push({ type: item.type, key: item.key, activeVersion: active?.version ?? null });
        } else if (item.type === "offer") {
          const active = await (prisma as any).offer.findFirst({
            where: { environment: releaseRecord.targetEnv, key: item.key, status: "ACTIVE" },
            orderBy: { version: "desc" }
          });
          beforeActiveSnapshot.push({ type: item.type, key: item.key, activeVersion: active?.version ?? null });
        } else if (item.type === "content") {
          const active = await (prisma as any).contentBlock.findFirst({
            where: { environment: releaseRecord.targetEnv, key: item.key, status: "ACTIVE" },
            orderBy: { version: "desc" }
          });
          beforeActiveSnapshot.push({ type: item.type, key: item.key, activeVersion: active?.version ?? null });
        } else if (item.type === "policy") {
          const active = await (prisma as any).orchestrationPolicy.findFirst({
            where: { environment: releaseRecord.targetEnv, key: item.key, status: "ACTIVE" },
            orderBy: { version: "desc" }
          });
          beforeActiveSnapshot.push({ type: item.type, key: item.key, activeVersion: active?.version ?? null });
        }
      }

      for (const item of sorted) {
        if (item.action === "noop") {
          continue;
        }

        if (item.type === "decision") {
          const decision =
            (await (prisma as any).decision.findFirst({ where: { environment: releaseRecord.targetEnv, key: item.key } })) ??
            (await (prisma as any).decision.create({
              data: {
                environment: releaseRecord.targetEnv,
                key: item.key,
                name: item.key,
                description: "Promoted"
              }
            }));

          await (prisma as any).decisionVersion.create({
            data: {
              decisionId: decision.id,
              version: item.targetVersion,
              status: "DRAFT",
              definitionJson: toJson(normalizeDecisionDefinitionForTarget(item.sourceSnapshot, item.targetVersion, "DRAFT"))
            }
          });
        } else if (item.type === "stack") {
          await (prisma as any).decisionStack.create({
            data: {
              environment: releaseRecord.targetEnv,
              key: item.key,
              name: item.key,
              description: "Promoted",
              version: item.targetVersion,
              status: "DRAFT",
              definitionJson: toJson(normalizeStackDefinitionForTarget(item.sourceSnapshot, item.targetVersion, "DRAFT"))
            }
          });
        } else if (item.type === "offer") {
          const source = item.sourceSnapshot as any;
          await (prisma as any).offer.create({
            data: {
              environment: releaseRecord.targetEnv,
              key: item.key,
              name: source.name,
              description: source.description,
              status: "DRAFT",
              version: item.targetVersion,
              tags: source.tags,
              type: source.type,
              valueJson: source.valueJson,
              constraints: source.constraints,
              startAt: source.startAt,
              endAt: source.endAt
            }
          });
        } else if (item.type === "content") {
          const source = item.sourceSnapshot as any;
          await (prisma as any).contentBlock.create({
            data: {
              environment: releaseRecord.targetEnv,
              key: item.key,
              name: source.name,
              description: source.description,
              status: "DRAFT",
              version: item.targetVersion,
              tags: source.tags,
              templateId: source.templateId,
              schemaJson: source.schemaJson,
              localesJson: source.localesJson,
              tokenBindings: source.tokenBindings
            }
          });
        } else if (item.type === "policy") {
          const source = item.sourceSnapshot as any;
          await (prisma as any).orchestrationPolicy.create({
            data: {
              environment: releaseRecord.targetEnv,
              key: item.key,
              name: item.key,
              status: "DRAFT",
              version: item.targetVersion,
              policyJson: toJson(source)
            }
          });
        } else if (item.type === "app") {
          const source = item.sourceSnapshot as any;
          await (prisma as any).inAppApplication.upsert({
            where: {
              environment_key: {
                environment: releaseRecord.targetEnv,
                key: item.key
              }
            },
            update: {
              name: source.name,
              platforms: source.platforms
            },
            create: {
              environment: releaseRecord.targetEnv,
              key: item.key,
              name: source.name,
              platforms: source.platforms
            }
          });
        } else if (item.type === "placement") {
          const source = item.sourceSnapshot as any;
          await (prisma as any).inAppPlacement.upsert({
            where: {
              environment_key: {
                environment: releaseRecord.targetEnv,
                key: item.key
              }
            },
            update: {
              name: source.name,
              description: source.description,
              allowedTemplateKeys: source.allowedTemplateKeys,
              defaultTtlSeconds: source.defaultTtlSeconds
            },
            create: {
              environment: releaseRecord.targetEnv,
              key: item.key,
              name: source.name,
              description: source.description,
              allowedTemplateKeys: source.allowedTemplateKeys,
              defaultTtlSeconds: source.defaultTtlSeconds
            }
          });
        } else if (item.type === "template") {
          const source = item.sourceSnapshot as any;
          await (prisma as any).inAppTemplate.upsert({
            where: {
              environment_key: {
                environment: releaseRecord.targetEnv,
                key: item.key
              }
            },
            update: {
              name: source.name,
              schemaJson: source.schemaJson
            },
            create: {
              environment: releaseRecord.targetEnv,
              key: item.key,
              name: source.name,
              schemaJson: source.schemaJson
            }
          });
        } else if (item.type === "campaign") {
          const source = item.sourceSnapshot as any;
          const promoted = await (prisma as any).inAppCampaign.upsert({
            where: {
              environment_key: {
                environment: releaseRecord.targetEnv,
                key: item.key
              }
            },
            update: {
              name: source.name,
              description: source.description,
              status: "DRAFT",
              appKey: source.appKey,
              placementKey: source.placementKey,
              templateKey: source.templateKey,
              contentKey: source.contentKey,
              offerKey: source.offerKey,
              priority: source.priority,
              ttlSeconds: source.ttlSeconds,
              startAt: source.startAt,
              endAt: source.endAt,
              holdoutEnabled: source.holdoutEnabled,
              holdoutPercentage: source.holdoutPercentage,
              holdoutSalt: source.holdoutSalt,
              capsPerProfilePerDay: source.capsPerProfilePerDay,
              capsPerProfilePerWeek: source.capsPerProfilePerWeek,
              eligibilityAudiencesAny: source.eligibilityAudiencesAny,
              tokenBindingsJson: source.tokenBindingsJson
            },
            create: {
              environment: releaseRecord.targetEnv,
              key: item.key,
              name: source.name,
              description: source.description,
              status: "DRAFT",
              appKey: source.appKey,
              placementKey: source.placementKey,
              templateKey: source.templateKey,
              contentKey: source.contentKey,
              offerKey: source.offerKey,
              priority: source.priority,
              ttlSeconds: source.ttlSeconds,
              startAt: source.startAt,
              endAt: source.endAt,
              holdoutEnabled: source.holdoutEnabled,
              holdoutPercentage: source.holdoutPercentage,
              holdoutSalt: source.holdoutSalt,
              capsPerProfilePerDay: source.capsPerProfilePerDay,
              capsPerProfilePerWeek: source.capsPerProfilePerWeek,
              eligibilityAudiencesAny: source.eligibilityAudiencesAny,
              tokenBindingsJson: source.tokenBindingsJson
            }
          });

          await (prisma as any).inAppCampaignVariant.deleteMany({ where: { campaignId: promoted.id } });
          for (const variant of source.variants ?? []) {
            await (prisma as any).inAppCampaignVariant.create({
              data: {
                campaignId: promoted.id,
                variantKey: variant.variantKey,
                weight: variant.weight,
                contentJson: variant.contentJson
              }
            });
          }
        }

        await audit({
          env: releaseRecord.targetEnv,
          action: "release.apply.item",
          actor: auth,
          entityType: item.type,
          entityKey: item.key,
          entityVersion: item.targetVersion,
          metadata: { sourceVersion: item.version, releaseId: releaseRecord.id }
        });
      }

      if (mode === "copy_and_activate") {
        for (const item of sorted) {
          if (item.action === "noop") {
            continue;
          }
          if (item.type === "decision") {
            const draft = await (prisma as any).decisionVersion.findFirst({
              where: {
                decision: { environment: releaseRecord.targetEnv, key: item.key },
                version: item.targetVersion
              },
              include: { decision: true }
            });
            if (draft) {
              await (prisma as any).decisionVersion.updateMany({
                where: { decisionId: draft.decisionId, status: "ACTIVE" },
                data: { status: "ARCHIVED" }
              });
              await (prisma as any).decisionVersion.update({ where: { id: draft.id }, data: { status: "ACTIVE", activatedAt: new Date() } });
            }
          } else if (item.type === "stack") {
            await (prisma as any).decisionStack.updateMany({
              where: { environment: releaseRecord.targetEnv, key: item.key, status: "ACTIVE" },
              data: { status: "ARCHIVED" }
            });
            await (prisma as any).decisionStack.updateMany({
              where: { environment: releaseRecord.targetEnv, key: item.key, version: item.targetVersion },
              data: { status: "ACTIVE", activatedAt: new Date() }
            });
          } else if (item.type === "offer") {
            await (prisma as any).offer.updateMany({
              where: { environment: releaseRecord.targetEnv, key: item.key, status: "ACTIVE" },
              data: { status: "ARCHIVED" }
            });
            await (prisma as any).offer.updateMany({
              where: { environment: releaseRecord.targetEnv, key: item.key, version: item.targetVersion },
              data: { status: "ACTIVE", activatedAt: new Date() }
            });
          } else if (item.type === "content") {
            await (prisma as any).contentBlock.updateMany({
              where: { environment: releaseRecord.targetEnv, key: item.key, status: "ACTIVE" },
              data: { status: "ARCHIVED" }
            });
            await (prisma as any).contentBlock.updateMany({
              where: { environment: releaseRecord.targetEnv, key: item.key, version: item.targetVersion },
              data: { status: "ACTIVE", activatedAt: new Date() }
            });
          } else if (item.type === "policy") {
            await (prisma as any).orchestrationPolicy.updateMany({
              where: { environment: releaseRecord.targetEnv, key: item.key, status: "ACTIVE" },
              data: { status: "ARCHIVED" }
            });
            await (prisma as any).orchestrationPolicy.updateMany({
              where: { environment: releaseRecord.targetEnv, key: item.key, version: item.targetVersion },
              data: { status: "ACTIVE", activatedAt: new Date() }
            });
          } else if (item.type === "campaign") {
            await (prisma as any).inAppCampaign.updateMany({
              where: { environment: releaseRecord.targetEnv, key: item.key },
              data: { status: "ACTIVE", activatedAt: new Date() }
            });
          }
        }
      }

      const updatedPlan = {
        ...(isObject(releaseRecord.planJson) ? releaseRecord.planJson : {}),
        applyResult: {
          appliedAt: new Date().toISOString(),
          beforeActiveSnapshot
        }
      };

      const updatedRelease = await (prisma as any).release.update({
        where: { id: releaseRecord.id },
        data: {
          status: "APPLIED",
          appliedByUserId: auth.userId ?? null,
          planJson: toJson(updatedPlan)
        }
      });

      await audit({
        env: releaseRecord.targetEnv,
        action: "release.apply",
        actor: auth,
        entityType: "release",
        entityKey: releaseRecord.key,
        metadata: { mode, itemCount: items.length }
      });

      return reply.send({ item: updatedRelease });
    } catch (error) {
      await (prisma as any).release.update({
        where: { id: releaseRecord.id },
        data: { status: "FAILED" }
      });
      return buildResponseError(reply, 500, "Release apply failed", String(error));
    }
  });

  app.get("/v1/releases", { preHandler: requireAnyPermission(["promotion.create", "promotion.approve", "promotion.apply"]) }, async (request, reply) => {
    const items = await (prisma as any).release.findMany({
      orderBy: { createdAt: "desc" },
      take: 200
    });
    return reply.send({ items });
  });

  app.get("/v1/releases/:id", { preHandler: requireAnyPermission(["promotion.create", "promotion.approve", "promotion.apply"]) }, async (request, reply) => {
    const params = releaseIdParamsSchema.safeParse(request.params);
    if (!params.success) {
      return buildResponseError(reply, 400, "Invalid release id", params.error.flatten());
    }
    const item = await (prisma as any).release.findUnique({ where: { id: params.data.id } });
    if (!item) {
      return buildResponseError(reply, 404, "Release not found");
    }
    return reply.send({ item });
  });
};

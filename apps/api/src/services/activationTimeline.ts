import type { PrismaClient } from "@prisma/client";
import { activationEntityTypes, type ActivationEntityType } from "./activationGraph";

export { activationEntityTypes, type ActivationEntityType };

export type ActivationTimelineEventKind = "audit" | "release" | "runtime" | "catalog" | "review";

export interface ActivationTimelineEvent {
  id: string;
  ts: string;
  kind: ActivationTimelineEventKind;
  action: string;
  title: string;
  detail: string;
  actor: string | null;
  entityType: string;
  entityKey: string;
  entityVersion: number | null;
  environment: string;
  source: string;
  metadata?: unknown;
}

export interface ActivationTimelineResponse {
  environment: string;
  entity: {
    type: ActivationEntityType;
    key: string;
  };
  items: ActivationTimelineEvent[];
  summary: {
    total: number;
    auditCount: number;
    releaseCount: number;
    runtimeCount: number;
    lastEventAt: string | null;
  };
}

const iso = (value: unknown): string => {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return new Date(0).toISOString();
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const assetRefFields: Record<"offer" | "content" | "bundle", string[]> = {
  offer: ["offerKey"],
  content: ["contentKey"],
  bundle: ["bundleKey"]
};

export const valueContainsAssetRef = (value: unknown, assetType: "offer" | "content" | "bundle", key: string): boolean => {
  if (Array.isArray(value)) {
    return value.some((entry) => valueContainsAssetRef(entry, assetType, key));
  }
  if (!isObject(value)) {
    return false;
  }
  if (assetRefFields[assetType].some((field) => value[field] === key)) {
    return true;
  }
  return Object.values(value).some((entry) => valueContainsAssetRef(entry, assetType, key));
};

const releaseHasEntity = (release: any, type: ActivationEntityType, key: string) => {
  const plan = release?.planJson;
  if (!isObject(plan) || !Array.isArray(plan.items)) {
    return false;
  }
  return plan.items.some((item) => isObject(item) && item.type === type && item.key === key);
};

const runtimeTitle = (type: ActivationEntityType) => {
  if (type === "decision") return "Decision served";
  if (type === "stack") return "Stack served";
  if (type === "campaign") return "Campaign evaluated";
  if (type === "offer") return "Offer served";
  if (type === "content") return "Content served";
  if (type === "bundle") return "Bundle served";
  return "Runtime event";
};

const campaignReferencesAsset = (campaign: any, assetType: "offer" | "content" | "bundle", key: string) => {
  if (assetType === "offer" && campaign.offerKey === key) return true;
  if (assetType === "content" && campaign.contentKey === key) return true;
  return valueContainsAssetRef(campaign.variants, assetType, key) || valueContainsAssetRef(campaign.tokenBindingsJson, assetType, key);
};

export async function buildActivationTimeline(input: {
  prisma: PrismaClient;
  environment: string;
  type: ActivationEntityType;
  key: string;
  limit?: number;
}): Promise<ActivationTimelineResponse> {
  const limit = Math.min(Math.max(input.limit ?? 40, 1), 100);
  const events: ActivationTimelineEvent[] = [];
  const key = input.key.trim();
  const { prisma, environment, type } = input;

  const add = (event: ActivationTimelineEvent) => {
    events.push(event);
  };

  const auditRows = await (prisma as any).auditEvent?.findMany?.({
    where: {
      env: environment,
      entityType: type,
      entityKey: key
    },
    orderBy: { ts: "desc" },
    take: limit
  });
  for (const row of auditRows ?? []) {
    add({
      id: `audit:${row.id}`,
      ts: iso(row.ts),
      kind: "audit",
      action: row.action,
      title: row.action,
      detail: `${type}:${key}${row.entityVersion ? ` v${row.entityVersion}` : ""}`,
      actor: row.actorEmail ?? row.actorUserId ?? null,
      entityType: type,
      entityKey: key,
      entityVersion: row.entityVersion ?? null,
      environment,
      source: "audit_events",
      metadata: row.metadata
    });
  }

  if (type === "offer" || type === "content" || type === "bundle") {
    const catalogRows = await (prisma as any).catalogAuditLog?.findMany?.({
      where: {
        environment,
        entityType: type,
        entityKey: key
      },
      orderBy: { createdAt: "desc" },
      take: limit
    });
    for (const row of catalogRows ?? []) {
      add({
        id: `catalog:${row.id}`,
        ts: iso(row.createdAt),
        kind: "catalog",
        action: row.action,
        title: row.action,
        detail: `${type}:${key}${row.version ? ` v${row.version}` : ""}`,
        actor: row.actorId ?? null,
        entityType: type,
        entityKey: key,
        entityVersion: row.version ?? null,
        environment,
        source: "catalog_audit_logs",
        metadata: row.metaJson
      });
    }
  }

  if (type === "campaign") {
    const campaign = await (prisma as any).inAppCampaign.findFirst({
      where: { environment, key },
      select: { id: true }
    });
    if (campaign?.id) {
      const inAppAuditRows = await (prisma as any).inAppAuditLog.findMany({
        where: {
          environment,
          entityId: campaign.id
        },
        orderBy: { createdAt: "desc" },
        take: limit
      });
      for (const row of inAppAuditRows) {
        add({
          id: `inapp-audit:${row.id}`,
          ts: iso(row.createdAt),
          kind: "review",
          action: row.action,
          title: row.action,
          detail: `${row.entityType}:${key}`,
          actor: row.userId ?? null,
          entityType: type,
          entityKey: key,
          entityVersion: null,
          environment,
          source: "inapp_audit_logs",
          metadata: row.metaJson
        });
      }
    }
  }

  const releases = await (prisma as any).release?.findMany?.({
    where: {
      OR: [{ sourceEnv: environment }, { targetEnv: environment }]
    },
    orderBy: { createdAt: "desc" },
    take: 100
  });
  for (const release of releases ?? []) {
    if (!releaseHasEntity(release, type, key)) {
      continue;
    }
    add({
      id: `release:${release.id}`,
      ts: iso(release.updatedAt ?? release.createdAt),
      kind: "release",
      action: `release.${String(release.status).toLowerCase()}`,
      title: `Release ${release.status}`,
      detail: `${release.key}: ${release.sourceEnv} -> ${release.targetEnv}`,
      actor: release.createdByEmail ?? release.createdByUserId ?? null,
      entityType: type,
      entityKey: key,
      entityVersion: null,
      environment,
      source: "releases",
      metadata: {
        releaseId: release.id,
        sourceEnv: release.sourceEnv,
        targetEnv: release.targetEnv,
        status: release.status
      }
    });
  }

  if (type === "decision") {
    const decision = await (prisma as any).decision.findFirst({ where: { environment, key }, select: { id: true } });
    if (decision?.id) {
      const logs = await (prisma as any).decisionLog.findMany({
        where: { decisionId: decision.id },
        orderBy: { timestamp: "desc" },
        take: Math.min(limit, 10)
      });
      for (const row of logs) {
        add({
          id: `runtime:decision:${row.id}`,
          ts: iso(row.timestamp),
          kind: "runtime",
          action: "decision.serve",
          title: runtimeTitle(type),
          detail: `${row.outcome} / ${row.actionType} / ${row.latencyMs}ms`,
          actor: null,
          entityType: type,
          entityKey: key,
          entityVersion: row.version ?? null,
          environment,
          source: "decision_logs",
          metadata: { logId: row.id, requestId: row.requestId, profileId: row.profileId }
        });
      }
    }
  }

  if (type === "stack") {
    const logs = await (prisma as any).decisionStackLog.findMany({
      where: { environment, stackKey: key },
      orderBy: { timestamp: "desc" },
      take: Math.min(limit, 10)
    });
    for (const row of logs) {
      add({
        id: `runtime:stack:${row.id}`,
        ts: iso(row.timestamp),
        kind: "runtime",
        action: "stack.serve",
        title: runtimeTitle(type),
        detail: `${row.finalActionType} / ${row.totalMs}ms`,
        actor: null,
        entityType: type,
        entityKey: key,
        entityVersion: row.version ?? null,
        environment,
        source: "decision_stack_logs",
        metadata: { logId: row.id, requestId: row.requestId, profileId: row.profileId }
      });
    }
  }

  if (type === "campaign") {
    const logs = await (prisma as any).inAppDecisionLog.findMany({
      where: { environment, campaignKey: key },
      orderBy: { createdAt: "desc" },
      take: Math.min(limit, 10)
    });
    for (const row of logs) {
      add({
        id: `runtime:campaign:${row.id}`,
        ts: iso(row.createdAt),
        kind: "runtime",
        action: "campaign.evaluate",
        title: runtimeTitle(type),
        detail: `${row.shown ? "shown" : "not shown"} / ${row.placement}${row.totalMs ? ` / ${row.totalMs}ms` : ""}`,
        actor: null,
        entityType: type,
        entityKey: key,
        entityVersion: null,
        environment,
        source: "inapp_decision_logs",
        metadata: { logId: row.id, correlationId: row.correlationId, profileId: row.profileId }
      });
    }
  }

  if (type === "offer" || type === "content" || type === "bundle") {
    const decisionLogs = await (prisma as any).decisionLog?.findMany?.({
      where: {
        decision: {
          environment
        }
      },
      select: {
        id: true,
        requestId: true,
        profileId: true,
        timestamp: true,
        outcome: true,
        actionType: true,
        latencyMs: true,
        version: true,
        payloadJson: true,
        decision: {
          select: {
            key: true
          }
        }
      },
      orderBy: { timestamp: "desc" },
      take: 250
    });
    for (const row of (decisionLogs ?? []).filter((log: any) => valueContainsAssetRef(log.payloadJson, type, key)).slice(0, Math.min(limit, 10))) {
      add({
        id: `runtime:asset-decision:${row.id}`,
        ts: iso(row.timestamp),
        kind: "runtime",
        action: "asset.decision_serve",
        title: runtimeTitle(type),
        detail: `${row.decision?.key ?? "decision"} / ${row.outcome} / ${row.actionType} / ${row.latencyMs}ms`,
        actor: null,
        entityType: type,
        entityKey: key,
        entityVersion: row.version ?? null,
        environment,
        source: "decision_logs",
        metadata: { logId: row.id, requestId: row.requestId, profileId: row.profileId, decisionKey: row.decision?.key ?? null }
      });
    }

    const campaigns = await (prisma as any).inAppCampaign?.findMany?.({
      where: {
        environment
      },
      include: {
        variants: true
      },
      orderBy: { updatedAt: "desc" },
      take: 250
    });
    const campaignKeys = [...new Set((campaigns ?? []).filter((campaign: any) => campaignReferencesAsset(campaign, type, key)).map((campaign: any) => campaign.key))];
    if (campaignKeys.length > 0) {
      const [campaignLogs, inAppEvents] = await Promise.all([
        (prisma as any).inAppDecisionLog?.findMany?.({
          where: {
            environment,
            campaignKey: {
              in: campaignKeys
            }
          },
          orderBy: { createdAt: "desc" },
          take: Math.min(limit, 10)
        }) ?? Promise.resolve([]),
        (prisma as any).inAppEvent?.findMany?.({
          where: {
            environment,
            campaignKey: {
              in: campaignKeys
            }
          },
          orderBy: { ts: "desc" },
          take: Math.min(limit, 10)
        }) ?? Promise.resolve([])
      ]);

      for (const row of campaignLogs) {
        add({
          id: `runtime:asset-campaign:${row.id}`,
          ts: iso(row.createdAt),
          kind: "runtime",
          action: "asset.campaign_evaluate",
          title: runtimeTitle(type),
          detail: `${row.campaignKey ?? "campaign"} / ${row.shown ? "shown" : "not shown"} / ${row.placement}${row.totalMs ? ` / ${row.totalMs}ms` : ""}`,
          actor: null,
          entityType: type,
          entityKey: key,
          entityVersion: null,
          environment,
          source: "inapp_decision_logs",
          metadata: { logId: row.id, correlationId: row.correlationId, profileId: row.profileId, campaignKey: row.campaignKey }
        });
      }

      for (const row of inAppEvents) {
        add({
          id: `runtime:asset-inapp-event:${row.id}`,
          ts: iso(row.ts),
          kind: "runtime",
          action: "asset.inapp_event",
          title: `${String(row.eventType).toLowerCase()} event`,
          detail: `${row.campaignKey} / ${row.variantKey} / ${row.placement}`,
          actor: null,
          entityType: type,
          entityKey: key,
          entityVersion: null,
          environment,
          source: "inapp_events",
          metadata: { eventId: row.id, messageId: row.messageId, profileId: row.profileId, campaignKey: row.campaignKey, eventType: row.eventType }
        });
      }
    }
  }

  const items = events
    .sort((left, right) => new Date(right.ts).getTime() - new Date(left.ts).getTime())
    .slice(0, limit);

  return {
    environment,
    entity: { type, key },
    items,
    summary: {
      total: items.length,
      auditCount: items.filter((item) => item.kind === "audit" || item.kind === "catalog" || item.kind === "review").length,
      releaseCount: items.filter((item) => item.kind === "release").length,
      runtimeCount: items.filter((item) => item.kind === "runtime").length,
      lastEventAt: items[0]?.ts ?? null
    }
  };
}

import type { PrismaClient } from "@prisma/client";

export const activationEntityTypes = [
  "decision",
  "stack",
  "offer",
  "content",
  "bundle",
  "experiment",
  "campaign",
  "template",
  "placement",
  "app"
] as const;

export type ActivationEntityType = (typeof activationEntityTypes)[number];
export type ActivationGraphRelation =
  | "uses"
  | "contains"
  | "targets"
  | "renders_with"
  | "runs_experiment"
  | "serves"
  | "belongs_to";

export interface ActivationGraphEntityRef {
  type: ActivationEntityType;
  key: string;
}

export interface ActivationGraphNode extends ActivationGraphEntityRef {
  id: string;
  label: string;
  status: string | null;
  version: number | null;
  environment: string;
  updatedAt: string | null;
  lastServedAt: string | null;
  active: boolean;
  missing?: boolean;
  sourceMetadata?: {
    sourceSystem?: string;
    nativeMeiroCampaignId?: string;
    nativeMeiroAssetId?: string;
    nativeMeiroCatalogId?: string;
    activationCampaignId?: string;
    creativeAssetId?: string;
    offerCatalogId?: string;
    channel?: string;
    prismSourceId?: string;
    importedFrom?: string;
  };
}

export interface ActivationGraphEdge {
  from: string;
  to: string;
  relation: ActivationGraphRelation;
  label: string;
  source: string;
}

export interface ActivationGraphResponse {
  environment: string;
  root: ActivationGraphEntityRef;
  rootNode: ActivationGraphNode;
  nodes: ActivationGraphNode[];
  edges: ActivationGraphEdge[];
  dependencies: ActivationGraphNode[];
  dependents: ActivationGraphNode[];
  impact: {
    dependencyCount: number;
    dependentCount: number;
    activeDependentCount: number;
    lastServedAt: string | null;
    riskLevel: "low" | "medium" | "high" | "blocking";
    summary: string;
  };
  explanations: string[];
}

export const activationActionTypes = ["archive", "activate", "promote", "release"] as const;

export type ActivationActionType = (typeof activationActionTypes)[number];

export interface ActivationActionPreviewResponse {
  environment: string;
  action: ActivationActionType;
  entity: ActivationGraphEntityRef;
  title: string;
  summary: string;
  affectedEntities: ActivationGraphNode[];
  blockers: string[];
  risks: string[];
  requiredPermissions: string[];
  rollback: string | null;
  explanations: string[];
  canProceed: boolean;
}

type RawNode = Omit<ActivationGraphNode, "id">;
type RawEdge = Omit<ActivationGraphEdge, "from" | "to"> & {
  from: ActivationGraphEntityRef;
  to: ActivationGraphEntityRef;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const nodeId = (ref: ActivationGraphEntityRef) => `${ref.type}:${ref.key}`;

const normalizeKey = (key: string) => key.trim();

const addRef = (
  refs: Map<string, ActivationGraphEntityRef>,
  type: ActivationEntityType,
  key: unknown
) => {
  if (typeof key !== "string") return;
  const normalized = normalizeKey(key);
  if (!normalized) return;
  const ref = { type, key: normalized };
  refs.set(nodeId(ref), ref);
};

const stringList = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
};

const iso = (value: unknown): string | null => {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return null;
};

const firstString = (record: Record<string, unknown>, keys: string[]): string | undefined => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
  }
  return undefined;
};

const sourceMetadataFromRow = (row: any | null | undefined): ActivationGraphNode["sourceMetadata"] | undefined => {
  if (!row) return undefined;
  const candidates = [row.tokenBindingsJson, row.metadataJson, row.tokenBindings].filter(isObject);
  const merged = Object.assign({}, ...candidates) as Record<string, unknown>;
  const sourceSystem = firstString(merged, ["source_system", "sourceSystem"]);
  const nativeMeiroCampaignId = firstString(merged, ["native_meiro_campaign_id", "nativeMeiroCampaignId"]);
  const nativeMeiroAssetId = firstString(merged, ["native_meiro_asset_id", "nativeMeiroAssetId"]);
  const nativeMeiroCatalogId = firstString(merged, ["native_meiro_catalog_id", "nativeMeiroCatalogId"]);
  const activationCampaignId = firstString(merged, ["activation_campaign_id", "activationCampaignId"]);
  const creativeAssetId = firstString(merged, ["creative_asset_id", "creativeAssetId"]);
  const offerCatalogId = firstString(merged, ["offer_catalog_id", "offerCatalogId"]);
  const channel = firstString(merged, ["channel"]);
  const prismSourceId = firstString(merged, ["prism_source_id", "prismSourceId"]);
  const importedFrom = firstString(merged, ["imported_from", "importedFrom"]);
  const metadata = {
    sourceSystem,
    nativeMeiroCampaignId,
    nativeMeiroAssetId,
    nativeMeiroCatalogId,
    activationCampaignId,
    creativeAssetId,
    offerCatalogId,
    channel,
    prismSourceId,
    importedFrom
  };
  return Object.values(metadata).some(Boolean) ? metadata : undefined;
};

export const collectActivationRefs = (value: unknown): ActivationGraphEntityRef[] => {
  const refs = new Map<string, ActivationGraphEntityRef>();

  const walk = (entry: unknown) => {
    if (Array.isArray(entry)) {
      for (const item of entry) walk(item);
      return;
    }
    if (!isObject(entry)) return;

    if (isObject(entry.payloadRef)) {
      addRef(refs, "offer", entry.payloadRef.offerKey);
      addRef(refs, "content", entry.payloadRef.contentKey);
      addRef(refs, "bundle", entry.payloadRef.bundleKey);
    }

    addRef(refs, "decision", entry.decisionKey);
    addRef(refs, "offer", entry.offerKey);
    addRef(refs, "content", entry.contentKey);
    addRef(refs, "bundle", entry.bundleKey);
    addRef(refs, "experiment", entry.experimentKey);
    addRef(refs, "template", entry.templateKey ?? entry.templateId);
    addRef(refs, "placement", entry.placementKey ?? entry.placement);
    addRef(refs, "app", entry.appKey);

    for (const nested of Object.values(entry)) {
      walk(nested);
    }
  };

  walk(value);
  return [...refs.values()].sort((left, right) => nodeId(left).localeCompare(nodeId(right)));
};

const makeNode = (environment: string, ref: ActivationGraphEntityRef, row: any | null): RawNode => ({
  type: ref.type,
  key: ref.key,
  label: row?.name ?? row?.decision?.name ?? ref.key,
  status: row?.status ?? null,
  version: typeof row?.version === "number" ? row.version : null,
  environment,
  updatedAt: iso(row?.updatedAt ?? row?.createdAt),
  lastServedAt: null,
  active: row?.status === "ACTIVE" || ((ref.type === "template" || ref.type === "placement" || ref.type === "app") && Boolean(row)),
  ...(row ? {} : { missing: true }),
  ...(sourceMetadataFromRow(row) ? { sourceMetadata: sourceMetadataFromRow(row) } : {})
});

const latestByKey = <T extends { key: string }>(rows: T[]) => {
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (seen.has(row.key)) return false;
    seen.add(row.key);
    return true;
  });
};

export async function buildActivationGraph(input: {
  prisma: PrismaClient;
  environment: string;
  root: ActivationGraphEntityRef;
}): Promise<ActivationGraphResponse> {
  const { prisma, environment, root } = input;
  const normalizedRoot = { type: root.type, key: normalizeKey(root.key) };
  const nodes = new Map<string, RawNode>();
  const edges = new Map<string, RawEdge>();
  const dependencies = new Set<string>();
  const dependents = new Set<string>();

  const addNode = (node: RawNode) => {
    nodes.set(nodeId(node), node);
  };
  const addEdge = (edge: RawEdge) => {
    const id = `${nodeId(edge.from)}->${nodeId(edge.to)}:${edge.relation}:${edge.source}`;
    edges.set(id, edge);
    if (nodeId(edge.from) === nodeId(normalizedRoot)) dependencies.add(nodeId(edge.to));
    if (nodeId(edge.to) === nodeId(normalizedRoot)) dependents.add(nodeId(edge.from));
  };

  const loadNode = async (ref: ActivationGraphEntityRef) => {
    const versionOrder = [{ version: "desc" as const }];
    switch (ref.type) {
      case "decision": {
        const row =
          (await (prisma as any).decisionVersion.findFirst({
            where: { status: "ACTIVE", decision: { environment, key: ref.key } },
            include: { decision: true },
            orderBy: versionOrder
          })) ??
          (await (prisma as any).decisionVersion.findFirst({
            where: { decision: { environment, key: ref.key } },
            include: { decision: true },
            orderBy: versionOrder
          }));
        addNode(makeNode(environment, ref, row ? { ...row, name: row.decision?.name } : null));
        return row;
      }
      case "stack": {
        const row =
          (await (prisma as any).decisionStack.findFirst({
            where: { environment, key: ref.key, status: "ACTIVE" },
            orderBy: versionOrder
          })) ??
          (await (prisma as any).decisionStack.findFirst({
            where: { environment, key: ref.key },
            orderBy: versionOrder
          }));
        addNode(makeNode(environment, ref, row));
        return row;
      }
      case "offer": {
        const row = await (prisma as any).offer.findFirst({
          where: { environment, key: ref.key },
          include: { variants: true },
          orderBy: [{ status: "asc" }, ...versionOrder]
        });
        addNode(makeNode(environment, ref, row));
        return row;
      }
      case "content": {
        const row = await (prisma as any).contentBlock.findFirst({
          where: { environment, key: ref.key },
          include: { variants: true },
          orderBy: [{ status: "asc" }, ...versionOrder]
        });
        addNode(makeNode(environment, ref, row));
        return row;
      }
      case "bundle": {
        const row = await (prisma as any).assetBundle?.findFirst?.({
          where: { environment, key: ref.key },
          orderBy: [{ status: "asc" }, ...versionOrder]
        });
        addNode(makeNode(environment, ref, row ?? null));
        return row ?? null;
      }
      case "experiment": {
        const row =
          (await (prisma as any).experimentVersion.findFirst({
            where: { environment, key: ref.key, status: "ACTIVE" },
            orderBy: versionOrder
          })) ??
          (await (prisma as any).experimentVersion.findFirst({
            where: { environment, key: ref.key },
            orderBy: versionOrder
          }));
        addNode(makeNode(environment, ref, row));
        return row;
      }
      case "campaign": {
        const row = await (prisma as any).inAppCampaign.findFirst({ where: { environment, key: ref.key } });
        addNode(makeNode(environment, ref, row));
        return row;
      }
      case "template": {
        const row = await (prisma as any).inAppTemplate.findFirst({ where: { environment, key: ref.key } });
        addNode(makeNode(environment, ref, row ? { ...row, status: "ACTIVE" } : null));
        return row;
      }
      case "placement": {
        const row = await (prisma as any).inAppPlacement.findFirst({ where: { environment, key: ref.key } });
        addNode(makeNode(environment, ref, row ? { ...row, status: "ACTIVE" } : null));
        return row;
      }
      case "app": {
        const row = await (prisma as any).inAppApplication.findFirst({ where: { environment, key: ref.key } });
        addNode(makeNode(environment, ref, row ? { ...row, status: "ACTIVE" } : null));
        return row;
      }
    }
  };

  const rootRow = await loadNode(normalizedRoot);

  const addDependency = (to: ActivationGraphEntityRef, relation: ActivationGraphRelation, source: string, label: string) => {
    addNode(makeNode(environment, to, nodes.get(nodeId(to)) ?? null));
    addEdge({ from: normalizedRoot, to, relation, source, label });
  };

  if (rootRow) {
    if (normalizedRoot.type === "decision") {
      for (const ref of collectActivationRefs(rootRow.definitionJson)) {
        if (ref.type !== "decision") addDependency(ref, "uses", "decision.definition", `Decision uses ${ref.type}`);
      }
    }
    if (normalizedRoot.type === "stack") {
      for (const ref of collectActivationRefs(rootRow.definitionJson).filter((ref) => ref.type === "decision")) {
        addDependency(ref, "contains", "stack.definition", "Stack runs decision");
      }
    }
    if (normalizedRoot.type === "campaign") {
      addDependency({ type: "app", key: rootRow.appKey }, "belongs_to", "campaign.appKey", "Campaign belongs to app");
      addDependency({ type: "placement", key: rootRow.placementKey }, "targets", "campaign.placementKey", "Campaign targets placement");
      addDependency({ type: "template", key: rootRow.templateKey }, "renders_with", "campaign.templateKey", "Campaign renders template");
      if (rootRow.offerKey) addDependency({ type: "offer", key: rootRow.offerKey }, "uses", "campaign.offerKey", "Campaign uses offer");
      if (rootRow.contentKey) addDependency({ type: "content", key: rootRow.contentKey }, "uses", "campaign.contentKey", "Campaign uses content");
      if (rootRow.experimentKey) addDependency({ type: "experiment", key: rootRow.experimentKey }, "runs_experiment", "campaign.experimentKey", "Campaign runs experiment");
    }
    if (normalizedRoot.type === "bundle") {
      if (rootRow.offerKey) addDependency({ type: "offer", key: rootRow.offerKey }, "uses", "bundle.offerKey", "Bundle uses offer");
      if (rootRow.contentKey) addDependency({ type: "content", key: rootRow.contentKey }, "uses", "bundle.contentKey", "Bundle uses content");
      if (rootRow.templateKey) addDependency({ type: "template", key: rootRow.templateKey }, "renders_with", "bundle.templateKey", "Bundle compatible with template");
      for (const placementKey of stringList(rootRow.placementKeys)) {
        addDependency({ type: "placement", key: placementKey }, "targets", "bundle.placementKeys", "Bundle compatible with placement");
      }
    }
    if (normalizedRoot.type === "content") {
      addDependency({ type: "template", key: rootRow.templateId }, "renders_with", "content.templateId", "Content renders with template");
      for (const ref of collectActivationRefs(rootRow.tokenBindings)) {
        if (ref.type === "offer") addDependency(ref, "uses", "content.tokenBindings", "Content token binding uses offer");
      }
      for (const variant of rootRow.variants ?? []) {
        if (variant.placementKey) addDependency({ type: "placement", key: variant.placementKey }, "targets", "content.variants", "Content variant targets placement");
        if (variant.experimentKey) addDependency({ type: "experiment", key: variant.experimentKey }, "runs_experiment", "content.variants", "Content variant is experiment-linked");
      }
    }
    if (normalizedRoot.type === "offer") {
      for (const variant of rootRow.variants ?? []) {
        if (variant.placementKey) addDependency({ type: "placement", key: variant.placementKey }, "targets", "offer.variants", "Offer variant targets placement");
        if (variant.experimentKey) addDependency({ type: "experiment", key: variant.experimentKey }, "runs_experiment", "offer.variants", "Offer variant is experiment-linked");
      }
    }
    if (normalizedRoot.type === "experiment") {
      for (const ref of collectActivationRefs(rootRow.experimentJson)) {
        if (ref.type !== "experiment") addDependency(ref, "uses", "experiment.definition", `Experiment references ${ref.type}`);
      }
    }
  }

  const [decisionVersions, stacks, campaigns, experiments, bundles, contents, offers] = await Promise.all([
    (prisma as any).decisionVersion.findMany({
      where: { status: "ACTIVE", decision: { environment } },
      include: { decision: true },
      orderBy: [{ decisionId: "asc" }, { version: "desc" }]
    }),
    (prisma as any).decisionStack.findMany({ where: { environment, status: "ACTIVE" }, orderBy: [{ key: "asc" }, { version: "desc" }] }),
    (prisma as any).inAppCampaign.findMany({ where: { environment, status: "ACTIVE" } }),
    (prisma as any).experimentVersion.findMany({ where: { environment, status: "ACTIVE" }, orderBy: [{ key: "asc" }, { version: "desc" }] }),
    (prisma as any).assetBundle?.findMany?.({ where: { environment, status: "ACTIVE" }, orderBy: [{ key: "asc" }, { version: "desc" }] }) ?? Promise.resolve([]),
    (prisma as any).contentBlock.findMany({ where: { environment, status: "ACTIVE" }, include: { variants: true }, orderBy: [{ key: "asc" }, { version: "desc" }] }),
    (prisma as any).offer.findMany({ where: { environment, status: "ACTIVE" }, include: { variants: true }, orderBy: [{ key: "asc" }, { version: "desc" }] })
  ]);

  const maybeAddDependent = (from: ActivationGraphEntityRef, refs: ActivationGraphEntityRef[], source: string, label: string) => {
    if (!refs.some((ref) => ref.type === normalizedRoot.type && ref.key === normalizedRoot.key)) return;
    addNode(makeNode(environment, from, nodes.get(nodeId(from)) ?? null));
    addEdge({ from, to: normalizedRoot, relation: "uses", source, label });
  };

  for (const row of latestByKey<any>(decisionVersions.map((version: any) => ({ ...version, key: version.decision.key, name: version.decision.name })))) {
    const from = { type: "decision" as const, key: row.key };
    maybeAddDependent(from, collectActivationRefs(row.definitionJson), "decision.definition", "Decision references this entity");
    if (dependents.has(nodeId(from))) addNode(makeNode(environment, from, row));
  }
  for (const row of latestByKey<any>(stacks)) {
    const from = { type: "stack" as const, key: row.key };
    maybeAddDependent(from, collectActivationRefs(row.definitionJson), "stack.definition", "Stack references this entity");
    if (dependents.has(nodeId(from))) addNode(makeNode(environment, from, row));
  }
  for (const row of campaigns) {
    const from = { type: "campaign" as const, key: row.key };
    maybeAddDependent(from, collectActivationRefs(row), "campaign.fields", "Campaign references this entity");
    if (dependents.has(nodeId(from))) addNode(makeNode(environment, from, row));
  }
  for (const row of latestByKey<any>(experiments)) {
    const from = { type: "experiment" as const, key: row.key };
    maybeAddDependent(from, collectActivationRefs(row.experimentJson), "experiment.definition", "Experiment references this entity");
    if (dependents.has(nodeId(from))) addNode(makeNode(environment, from, row));
  }
  for (const row of latestByKey<any>(bundles)) {
    const from = { type: "bundle" as const, key: row.key };
    maybeAddDependent(from, collectActivationRefs(row), "bundle.fields", "Bundle references this entity");
    if (dependents.has(nodeId(from))) addNode(makeNode(environment, from, row));
  }
  for (const row of latestByKey<any>(contents)) {
    const from = { type: "content" as const, key: row.key };
    maybeAddDependent(from, collectActivationRefs({ ...row, templateKey: row.templateId }), "content.fields", "Content references this entity");
    if (dependents.has(nodeId(from))) addNode(makeNode(environment, from, row));
  }
  for (const row of latestByKey<any>(offers)) {
    const from = { type: "offer" as const, key: row.key };
    maybeAddDependent(from, collectActivationRefs(row), "offer.fields", "Offer references this entity");
    if (dependents.has(nodeId(from))) addNode(makeNode(environment, from, row));
  }

  for (const ref of [...dependencies, ...dependents].map((id) => {
    const [type, ...keyParts] = id.split(":");
    return { type: type as ActivationEntityType, key: keyParts.join(":") };
  })) {
    if (nodes.get(nodeId(ref))?.missing) {
      await loadNode(ref);
    }
  }

  const rootNode = nodes.get(nodeId(normalizedRoot)) ?? makeNode(environment, normalizedRoot, null);
  const lastServedAt = rootNode.lastServedAt;
  const dependencyNodes = [...dependencies].map((id) => nodes.get(id)).filter(Boolean) as ActivationGraphNode[];
  const dependentNodes = [...dependents].map((id) => nodes.get(id)).filter(Boolean) as ActivationGraphNode[];
  const activeDependentCount = dependentNodes.filter((node) => node.active).length;
  const missingDependencyCount = dependencyNodes.filter((node) => node.missing).length;
  const riskLevel = missingDependencyCount > 0 ? "blocking" : activeDependentCount >= 5 ? "high" : activeDependentCount > 0 ? "medium" : "low";
  const summary =
    missingDependencyCount > 0
      ? `${missingDependencyCount} dependency${missingDependencyCount === 1 ? " is" : "ies are"} missing.`
      : activeDependentCount > 0
        ? `${activeDependentCount} active dependent${activeDependentCount === 1 ? "" : "s"} may be affected by changes.`
        : "No active dependents were found.";

  const explanations = [
    `${normalizedRoot.type}:${normalizedRoot.key} has ${dependencyNodes.length} direct dependencies and ${dependentNodes.length} direct dependents in ${environment}.`,
    summary,
    dependencyNodes.length > 0
      ? `Dependencies: ${dependencyNodes.map((node) => `${node.type}:${node.key}${node.status ? ` (${node.status})` : ""}`).join(", ")}.`
      : "No direct dependencies were detected.",
    dependentNodes.length > 0
      ? `Dependents: ${dependentNodes.map((node) => `${node.type}:${node.key}${node.status ? ` (${node.status})` : ""}`).join(", ")}.`
      : "No direct dependents were detected."
  ];

  return {
    environment,
    root: normalizedRoot,
    rootNode: { ...rootNode, id: nodeId(rootNode) },
    nodes: [...nodes.values()].map((node) => ({ ...node, id: nodeId(node) })),
    edges: [...edges.values()].map((edge) => ({
      ...edge,
      from: nodeId(edge.from),
      to: nodeId(edge.to)
    })),
    dependencies: dependencyNodes.map((node) => ({ ...node, id: nodeId(node) })),
    dependents: dependentNodes.map((node) => ({ ...node, id: nodeId(node) })),
    impact: {
      dependencyCount: dependencyNodes.length,
      dependentCount: dependentNodes.length,
      activeDependentCount,
      lastServedAt,
      riskLevel,
      summary
    },
    explanations
  };
}

const permissionByAction: Record<ActivationActionType, string[]> = {
  archive: ["catalog.content.write", "engage.campaign.write", "decision.write"],
  activate: ["catalog.content.write", "engage.campaign.write", "decision.write"],
  promote: ["promotion.create"],
  release: ["promotion.create"]
};

export async function buildActivationActionPreview(input: {
  prisma: PrismaClient;
  environment: string;
  root: ActivationGraphEntityRef;
  action: ActivationActionType;
}): Promise<ActivationActionPreviewResponse> {
  const graph = await buildActivationGraph({
    prisma: input.prisma,
    environment: input.environment,
    root: input.root
  });
  const affected = [graph.rootNode, ...graph.dependencies, ...graph.dependents];
  const missingDependencies = graph.dependencies.filter((node) => node.missing);
  const activeDependents = graph.dependents.filter((node) => node.active);
  const inactiveDependencies = graph.dependencies.filter((node) => !node.missing && !node.active);
  const blockers: string[] = [];
  const risks: string[] = [];

  if (input.action === "archive" && activeDependents.length > 0) {
    blockers.push(
      `${activeDependents.length} active dependent${activeDependents.length === 1 ? "" : "s"} still reference this entity.`
    );
  }
  if ((input.action === "activate" || input.action === "promote" || input.action === "release") && missingDependencies.length > 0) {
    blockers.push(
      `${missingDependencies.length} dependency${missingDependencies.length === 1 ? " is" : "ies are"} missing and must be resolved first.`
    );
  }
  if (activeDependents.length > 0 && input.action !== "archive") {
    risks.push(`${activeDependents.length} active dependent${activeDependents.length === 1 ? "" : "s"} may change behavior.`);
  }
  if (inactiveDependencies.length > 0 && input.action !== "archive") {
    risks.push(`${inactiveDependencies.length} dependency${inactiveDependencies.length === 1 ? " is" : "ies are"} not active.`);
  }
  if (graph.impact.riskLevel === "low" && risks.length === 0 && blockers.length === 0) {
    risks.push("No direct downstream runtime risk was detected.");
  }

  const actionLabel =
    input.action === "archive"
      ? "Archive"
      : input.action === "activate"
        ? "Activate"
        : input.action === "promote"
          ? "Promote"
          : "Prepare release";
  const summary =
    blockers.length > 0
      ? `${actionLabel} is blocked for ${graph.root.type}:${graph.root.key}.`
      : `${actionLabel} can proceed for ${graph.root.type}:${graph.root.key} with ${activeDependents.length} active downstream reference${activeDependents.length === 1 ? "" : "s"}.`;
  const rollback =
    input.action === "archive"
      ? "Restore or recreate the archived entity, then reactivate dependent journeys."
      : input.action === "release" || input.action === "promote"
        ? "Use the release history to roll back the promoted package in the target environment."
        : "Deactivate or roll back to the previous active version if runtime behavior is not acceptable.";

  return {
    environment: graph.environment,
    action: input.action,
    entity: graph.root,
    title: `${actionLabel} ${graph.root.type}:${graph.root.key}`,
    summary,
    affectedEntities: affected,
    blockers,
    risks,
    requiredPermissions: permissionByAction[input.action],
    rollback,
    explanations: [
      ...graph.explanations,
      blockers.length > 0 ? `Blockers: ${blockers.join(" ")}` : "No blocking conditions were detected.",
      risks.length > 0 ? `Risks: ${risks.join(" ")}` : "No direct risks were detected."
    ],
    canProceed: blockers.length === 0
  };
}

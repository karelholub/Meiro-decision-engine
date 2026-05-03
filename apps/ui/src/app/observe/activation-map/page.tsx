"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { InlineError, LoadingState } from "../../../components/ui/app-state";
import { Badge, SignalChip } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { MetricCard, OperationalCard } from "../../../components/ui/card";
import { FieldLabel, FilterPanel, PageHeader, inputClassName } from "../../../components/ui/page";
import { apiClient, type ActivationEntityType, type ActivationGraphNode, type ActivationGraphResponse } from "../../../lib/api";
import { getEnvironment, onEnvironmentChange, type UiEnvironment } from "../../../lib/environment";

const entityTypes: ActivationEntityType[] = [
  "decision",
  "stack",
  "campaign",
  "experiment",
  "offer",
  "content",
  "bundle",
  "template",
  "placement",
  "app"
];

const exampleKeys: Partial<Record<ActivationEntityType, string>> = {
  decision: "next_best_action",
  stack: "homepage_stack",
  campaign: "welcome_banner",
  experiment: "homepage_ab_test",
  offer: "summer_offer",
  content: "hero_banner",
  bundle: "homepage_bundle",
  template: "banner",
  placement: "homepage_top",
  app: "web"
};

const riskTone: Record<ActivationGraphResponse["impact"]["riskLevel"], "success" | "warning" | "danger" | "neutral"> = {
  low: "success",
  medium: "warning",
  high: "warning",
  blocking: "danger"
};

const statusTone = (node: ActivationGraphNode): "success" | "warning" | "danger" | "neutral" => {
  if (node.missing) return "danger";
  if (node.status === "ACTIVE") return "success";
  if (node.status === "ARCHIVED") return "danger";
  if (node.status) return "warning";
  return "neutral";
};

const entityHref = (node: Pick<ActivationGraphNode, "type" | "key">) => {
  if (node.type === "decision") return `/decisions?key=${encodeURIComponent(node.key)}`;
  if (node.type === "stack") return `/stacks?key=${encodeURIComponent(node.key)}`;
  if (node.type === "campaign") return `/engage/campaigns?key=${encodeURIComponent(node.key)}`;
  if (node.type === "experiment") return `/engage/experiments/${encodeURIComponent(node.key)}`;
  if (node.type === "offer") return `/catalog/offers?key=${encodeURIComponent(node.key)}`;
  if (node.type === "content") return `/catalog/content?key=${encodeURIComponent(node.key)}`;
  if (node.type === "bundle") return `/catalog/bundles?key=${encodeURIComponent(node.key)}`;
  if (node.type === "template") return `/engage/templates?key=${encodeURIComponent(node.key)}`;
  if (node.type === "placement") return `/engage/placements?key=${encodeURIComponent(node.key)}`;
  return `/engage/apps?key=${encodeURIComponent(node.key)}`;
};

const NodeRow = ({ node, caption }: { node: ActivationGraphNode; caption?: string }) => (
  <li className="rounded-md border border-stone-200 bg-white px-3 py-2">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0">
        <Link className="font-medium text-ink underline" href={entityHref(node)}>
          {node.label}
        </Link>
        <p className="break-all text-xs text-stone-600">
          {node.type}:{node.key}
          {node.version ? ` · v${node.version}` : ""}
        </p>
        {caption ? <p className="mt-1 text-xs text-stone-600">{caption}</p> : null}
      </div>
      <Badge variant={statusTone(node)}>{node.missing ? "Missing" : node.status ?? "Known"}</Badge>
    </div>
  </li>
);

export default function ActivationMapPage() {
  const [environment, setEnvironment] = useState<UiEnvironment>("DEV");
  const [type, setType] = useState<ActivationEntityType>("campaign");
  const [key, setKey] = useState("");
  const [graph, setGraph] = useState<ActivationGraphResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setEnvironment(getEnvironment());
    return onEnvironmentChange(setEnvironment);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const queryType = params.get("type") as ActivationEntityType | null;
    const queryKey = params.get("key");
    if (queryType && entityTypes.includes(queryType)) setType(queryType);
    if (queryKey) setKey(queryKey);
  }, []);

  const load = async () => {
    const trimmedKey = key.trim();
    if (!trimmedKey) {
      setError("Choose an entity type and enter a key.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await apiClient.activationGraph.get({ type, key: trimmedKey });
      setGraph(response);
      const params = new URLSearchParams({ type, key: trimmedKey });
      window.history.replaceState(null, "", `/observe/activation-map?${params.toString()}`);
    } catch (loadError) {
      setGraph(null);
      setError(loadError instanceof Error ? loadError.message : "Failed to load activation map");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (key.trim()) void load();
  }, [environment]);

  const outgoingEdgesByTarget = useMemo(() => {
    const labels = new Map<string, string>();
    for (const edge of graph?.edges ?? []) {
      if (edge.from === graph?.rootNode.id) labels.set(edge.to, edge.label);
    }
    return labels;
  }, [graph]);

  const incomingEdgesBySource = useMemo(() => {
    const labels = new Map<string, string>();
    for (const edge of graph?.edges ?? []) {
      if (edge.to === graph?.rootNode.id) labels.set(edge.from, edge.label);
    }
    return labels;
  }, [graph]);

  return (
    <section className="space-y-4">
      <PageHeader
        density="compact"
        eyebrow="Observe"
        title="Activation Map"
        description={`Trace dependencies, dependents, and production impact for governed activation entities in ${environment}.`}
      />

      <FilterPanel density="compact" className="grid gap-2 md:grid-cols-[180px_minmax(260px,1fr)_auto]">
        <FieldLabel>
          Entity type
          <select className={inputClassName} value={type} onChange={(event) => setType(event.target.value as ActivationEntityType)}>
            {entityTypes.map((entityType) => (
              <option key={entityType} value={entityType}>
                {entityType}
              </option>
            ))}
          </select>
        </FieldLabel>
        <FieldLabel>
          Entity key
          <input
            className={inputClassName}
            value={key}
            onChange={(event) => setKey(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void load();
            }}
            placeholder={exampleKeys[type] ?? "key"}
          />
        </FieldLabel>
        <Button size="sm" className="self-end" onClick={() => void load()} disabled={loading}>
          Load map
        </Button>
      </FilterPanel>

      {error ? <InlineError title="Activation map unavailable" description={error} /> : null}
      {loading ? <LoadingState title="Loading activation map" /> : null}

      {graph ? (
        <>
          <section className="grid gap-3 md:grid-cols-4">
            <MetricCard label="Dependencies" value={graph.impact.dependencyCount} description="Direct upstream entities" />
            <MetricCard label="Dependents" value={graph.impact.dependentCount} description="Direct downstream entities" />
            <MetricCard label="Active impact" value={graph.impact.activeDependentCount} description="Active dependents" />
            <MetricCard label="Risk" value={graph.impact.riskLevel} description={graph.impact.summary} />
          </section>

          <section className="grid gap-4 xl:grid-cols-[1fr_1.1fr_1fr]">
            <OperationalCard className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-semibold">Dependencies</h3>
                <SignalChip tone="info">{graph.dependencies.length}</SignalChip>
              </div>
              {graph.dependencies.length === 0 ? <p className="text-sm text-stone-600">No direct dependencies detected.</p> : null}
              <ul className="space-y-2">
                {graph.dependencies.map((node) => (
                  <NodeRow key={node.id} node={node} caption={outgoingEdgesByTarget.get(node.id)} />
                ))}
              </ul>
            </OperationalCard>

            <OperationalCard className="space-y-3 border-ink">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-xs uppercase tracking-wide text-stone-500">Selected entity</p>
                  <h3 className="text-lg font-semibold">{graph.rootNode.label}</h3>
                  <p className="break-all text-xs text-stone-600">
                    {graph.rootNode.type}:{graph.rootNode.key}
                    {graph.rootNode.version ? ` · v${graph.rootNode.version}` : ""}
                  </p>
                </div>
                <Badge variant={riskTone[graph.impact.riskLevel]}>{graph.impact.riskLevel}</Badge>
              </div>
              <div className="space-y-2">
                {graph.explanations.map((explanation) => (
                  <p key={explanation} className="rounded-md border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-700">
                    {explanation}
                  </p>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                <Link className="rounded-md border border-stone-300 px-3 py-1.5 text-sm hover:bg-stone-100" href={entityHref(graph.rootNode)}>
                  Open entity
                </Link>
                <Link
                  className="rounded-md border border-stone-300 px-3 py-1.5 text-sm hover:bg-stone-100"
                  href={`/releases?type=${graph.root.type}&key=${encodeURIComponent(graph.root.key)}`}
                >
                  Prepare release
                </Link>
              </div>
            </OperationalCard>

            <OperationalCard className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-semibold">Dependents</h3>
                <SignalChip tone={graph.impact.activeDependentCount > 0 ? "warning" : "success"}>{graph.dependents.length}</SignalChip>
              </div>
              {graph.dependents.length === 0 ? <p className="text-sm text-stone-600">No direct dependents detected.</p> : null}
              <ul className="space-y-2">
                {graph.dependents.map((node) => (
                  <NodeRow key={node.id} node={node} caption={incomingEdgesBySource.get(node.id)} />
                ))}
              </ul>
            </OperationalCard>
          </section>

          <OperationalCard className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold">Graph Edges</h3>
              <SignalChip tone="neutral">{graph.edges.length}</SignalChip>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              {graph.edges.map((edge) => (
                <div key={`${edge.from}-${edge.to}-${edge.source}`} className="rounded-md border border-stone-200 bg-white px-3 py-2 text-sm">
                  <p className="font-medium">{edge.label}</p>
                  <p className="break-all text-xs text-stone-600">
                    {edge.from} -&gt; {edge.to}
                  </p>
                  <p className="text-xs text-stone-500">{edge.source}</p>
                </div>
              ))}
            </div>
          </OperationalCard>
        </>
      ) : null}
    </section>
  );
}


import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type {
  DecisionAuthoringRequirementsResponse,
  DecisionDependenciesResponse,
  DecisionReadinessResponse,
  DecisionValidationResponse
} from "@decisioning/shared";
import type { DecisionDefinition } from "@decisioning/dsl";
import type { ValidationByStep } from "./types";
import { deriveRequiredFieldsFromDraft, draftRiskFlags, getDecisionSummaryText } from "./wizard-utils";
import { apiClient } from "../../lib/api";
import { DEFAULT_APP_ENUM_SETTINGS } from "../../lib/app-enum-settings";

interface SummaryPanelProps {
  definition: DecisionDefinition;
  validation: DecisionValidationResponse | null;
  groupedErrors: ValidationByStep[];
  readOnlyReasons: string[];
  requirements?: DecisionAuthoringRequirementsResponse | null;
  dependencies?: DecisionDependenciesResponse | null;
  readiness?: DecisionReadinessResponse | null;
}

const pretty = (value: unknown) => JSON.stringify(value, null, 2);

const dependencyHref = (type: string, key: string) => {
  if (!key) return null;
  if (type === "content") return "/catalog/content";
  if (type === "offer") return "/catalog/offers";
  if (type === "bundle") return `/catalog/bundles?key=${encodeURIComponent(key)}`;
  if (type === "experiment") return `/engage/experiments/${encodeURIComponent(key)}`;
  if (type === "template") return "/engage/templates";
  if (type === "placement") return "/engage/placements";
  return null;
};

export function SummaryPanel({ definition, validation, groupedErrors, readOnlyReasons, requirements, dependencies, readiness }: SummaryPanelProps) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [catalogPreview, setCatalogPreview] = useState<unknown | null>(null);
  const [copyRequirementsStatus, setCopyRequirementsStatus] = useState<"idle" | "copied">("idle");

  const summaryText = useMemo(() => getDecisionSummaryText(definition), [definition]);
  const localRequirements = useMemo(() => deriveRequiredFieldsFromDraft(definition), [definition]);
  const displayedRequirements = requirements
    ? {
        requiredAttributes: requirements.required.attributes,
        requiredAudiences: requirements.required.audiences,
        requiredContextKeys: requirements.required.contextKeys,
        optionalAttributes: requirements.optional.attributes,
        optionalContextKeys: requirements.optional.contextKeys,
        notes: requirements.notes
      }
    : {
        ...localRequirements,
        optionalAttributes: [],
        optionalContextKeys: [],
        notes: []
      };
  const riskFlags = useMemo(() => draftRiskFlags(definition), [definition]);
  const jsonPreview = useMemo(() => (previewOpen ? pretty(definition) : ""), [definition, previewOpen]);
  const referencedContentKey = useMemo(() => {
    for (const rule of definition.flow.rules) {
      const thenRef = (rule.then.payload as Record<string, unknown> | undefined)?.payloadRef;
      if (thenRef && typeof thenRef === "object" && typeof (thenRef as { contentKey?: unknown }).contentKey === "string") {
        return (thenRef as { contentKey: string }).contentKey;
      }
      const elseRef = (rule.else?.payload as Record<string, unknown> | undefined)?.payloadRef;
      if (elseRef && typeof elseRef === "object" && typeof (elseRef as { contentKey?: unknown }).contentKey === "string") {
        return (elseRef as { contentKey: string }).contentKey;
      }
    }
    const defaultRef = (definition.outputs.default?.payload as Record<string, unknown> | undefined)?.payloadRef;
    if (defaultRef && typeof defaultRef === "object" && typeof (defaultRef as { contentKey?: unknown }).contentKey === "string") {
      return (defaultRef as { contentKey: string }).contentKey;
    }
    return null;
  }, [definition]);

  useEffect(() => {
    let cancelled = false;
    const loadPreview = async () => {
      if (!referencedContentKey) {
        setCatalogPreview(null);
        return;
      }
      try {
        const response = await apiClient.catalog.content.preview(referencedContentKey, {
          locale: DEFAULT_APP_ENUM_SETTINGS.locales[0] ?? "en",
          context: {}
        });
        if (!cancelled) {
          setCatalogPreview(response);
        }
      } catch {
        if (!cancelled) {
          setCatalogPreview(null);
        }
      }
    };

    void loadPreview();
    return () => {
      cancelled = true;
    };
  }, [referencedContentKey]);

  const copyJson = async () => {
    try {
      await navigator.clipboard.writeText(pretty(definition));
    } catch {
      // no-op
    }
  };

  const copyRequirements = async () => {
    try {
      await navigator.clipboard.writeText(pretty(displayedRequirements));
      setCopyRequirementsStatus("copied");
      window.setTimeout(() => setCopyRequirementsStatus("idle"), 1200);
    } catch {
      setCopyRequirementsStatus("idle");
    }
  };

  return (
    <aside className="sticky top-24 space-y-3">
      <section className="panel space-y-2 p-3 text-sm">
        <h3 className="font-semibold">Live summary</h3>
        {riskFlags.appliesToEveryone ? (
          <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">Applies to everyone: no audiences or conditions configured.</p>
        ) : null}
        {riskFlags.messagingWithoutCaps ? (
          <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
            No caps configured for messaging action (fatigue risk).
          </p>
        ) : null}
        <p className="text-stone-700">{summaryText}</p>
        <ul className="space-y-1 text-xs text-stone-700">
          <li>Eligibility conditions: {definition.eligibility.attributes?.length ?? 0}</li>
          <li>Rules: {definition.flow.rules.length}</li>
          <li>Holdout: {definition.holdout.enabled ? `${definition.holdout.percentage}%` : "disabled"}</li>
          <li>
            Caps: daily {definition.caps.perProfilePerDay ?? "none"}, weekly {definition.caps.perProfilePerWeek ?? "none"}
          </li>
          <li>
            Timeout: {definition.performance?.timeoutMs ?? 120}ms total, {definition.performance?.wbsTimeoutMs ?? 80}ms WBS
          </li>
          <li>Cache mode: {definition.cachePolicy?.mode ?? "normal"}</li>
          <li>Default action: {definition.outputs.default?.actionType ?? "noop"}</li>
        </ul>
        <div>
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-stone-600">Data requirements</p>
            <button type="button" onClick={copyRequirements} className="rounded-md border border-stone-300 px-2 py-1 text-xs">
              {copyRequirementsStatus === "copied" ? "Copied" : "Copy requirements for Pipes"}
            </button>
          </div>
          {displayedRequirements.requiredAttributes.length === 0 &&
          displayedRequirements.requiredAudiences.length === 0 &&
          displayedRequirements.requiredContextKeys.length === 0 ? (
            <p className="mt-1 text-xs text-stone-600">Data requirements (derived from rules): none yet.</p>
          ) : (
            <div className="mt-1 space-y-1 text-xs text-stone-700">
              <p>Attributes: {displayedRequirements.requiredAttributes.length ? displayedRequirements.requiredAttributes.join(", ") : "none"}</p>
              <p>Audiences: {displayedRequirements.requiredAudiences.length ? displayedRequirements.requiredAudiences.join(", ") : "none"}</p>
              <p>Context keys: {displayedRequirements.requiredContextKeys.length ? displayedRequirements.requiredContextKeys.join(", ") : "none"}</p>
              {displayedRequirements.optionalAttributes.length > 0 ? <p>Optional attributes: {displayedRequirements.optionalAttributes.join(", ")}</p> : null}
              {displayedRequirements.optionalContextKeys.length > 0 ? <p>Optional context: {displayedRequirements.optionalContextKeys.join(", ")}</p> : null}
            </div>
          )}
          {displayedRequirements.notes.length > 0 ? (
            <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-amber-800">
              {displayedRequirements.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          ) : null}
        </div>
        <p className="text-xs text-stone-600">
          Tip: resolve errors from top to bottom for the fastest validation pass.
        </p>
        <Link href="/docs/decision-builder" className="inline-flex text-xs underline">
          Read Decision Builder guide
        </Link>
        {catalogPreview ? (
          <details className="rounded-md border border-stone-200 bg-stone-50 p-2 text-xs">
            <summary className="cursor-pointer font-medium">Resolved catalog preview</summary>
            <pre className="mt-2 max-h-56 overflow-auto">{JSON.stringify(catalogPreview, null, 2)}</pre>
          </details>
        ) : null}
      </section>

      {readOnlyReasons.length > 0 ? (
        <section className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
          <p className="font-semibold">Advanced-only mode</p>
          <ul className="mt-1 list-disc pl-4">
            {readOnlyReasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {readiness ? (
        <section className="panel space-y-2 p-3 text-sm">
          <h3 className="font-semibold">Activation readiness</h3>
          <p className="text-xs text-stone-700">
            Status: <strong>{readiness.readiness.status.replace(/_/g, " ")}</strong> · Risk:{" "}
            <strong>{readiness.readiness.riskLevel}</strong>
          </p>
          {readiness.diagnostics.length === 0 ? <p className="text-xs text-emerald-700">No readiness issues.</p> : null}
          <ul className="space-y-1 text-xs">
            {readiness.diagnostics.slice(0, 8).map((diagnostic, index) => (
              <li
                key={`${diagnostic.code}-${diagnostic.path ?? index}`}
                className={diagnostic.severity === "blocking" ? "text-red-700" : diagnostic.severity === "warning" ? "text-amber-800" : "text-stone-600"}
              >
                <strong>{diagnostic.severity}</strong>: {diagnostic.message}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {dependencies ? (
        <section className="panel space-y-2 p-3 text-sm">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-semibold">Dependency cockpit</h3>
            <span className="rounded-md border border-stone-200 px-2 py-0.5 text-xs">
              {dependencies.summary.total} refs
            </span>
          </div>
          {dependencies.summary.missing || dependencies.summary.inactive ? (
            <p className="text-xs text-amber-800">
              {dependencies.summary.missing} missing · {dependencies.summary.inactive} inactive
            </p>
          ) : dependencies.items.length > 0 ? (
            <p className="text-xs text-emerald-700">All referenced assets resolve.</p>
          ) : (
            <p className="text-xs text-stone-600">No catalog or experiment dependencies detected.</p>
          )}
          <ul className="space-y-1 text-xs">
            {dependencies.items.slice(0, 10).map((item, index) => {
              const href = dependencyHref(item.ref.type, item.ref.key);
              const tone =
                item.status === "missing"
                  ? "border-red-200 bg-red-50 text-red-800"
                  : item.status === "resolved_inactive"
                    ? "border-amber-200 bg-amber-50 text-amber-900"
                    : "border-stone-200 text-stone-700";
              return (
                <li key={`${item.ref.type}:${item.ref.key}:${item.sourcePath ?? index}`} className={`rounded-md border px-2 py-1 ${tone}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      <strong>{item.label}</strong>: {item.ref.type}:{item.ref.key}
                      {item.ref.version ? ` v${item.ref.version}` : ""}
                    </span>
                    <span>{item.status.replace(/_/g, " ")}</span>
                  </div>
                  {item.detail ? <p className="mt-1">{item.detail}</p> : null}
                  {item.sourcePath ? <p className="mt-1 font-mono text-[11px] opacity-80">{item.sourcePath}</p> : null}
                  {href ? (
                    <Link href={href} className="mt-1 inline-flex underline">
                      Open
                    </Link>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <section className="panel space-y-2 p-3 text-sm">
        <h3 className="font-semibold">Validation issues</h3>
        {groupedErrors.length === 0 ? <p className="text-xs text-emerald-700">No mapped errors.</p> : null}
        {groupedErrors.map((group) => (
          <div key={group.step}>
            <p className="text-xs font-semibold uppercase tracking-wide text-stone-600">{group.step.replace("_", " ")}</p>
            <ul className="mt-1 space-y-1 text-xs text-red-700">
              {group.errors.map((error) => (
                <li key={`${group.step}-${error.path}-${error.raw}`}>{error.fieldLabel}</li>
              ))}
            </ul>
          </div>
        ))}

        {validation?.warnings && validation.warnings.length > 0 ? (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-stone-600">Warnings</p>
            <ul className="mt-1 space-y-1 text-xs text-amber-800">
              {validation.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section className="panel space-y-2 p-3 text-sm">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">JSON preview</h3>
          <button type="button" onClick={copyJson} className="rounded-md border border-stone-300 px-2 py-1 text-xs">
            Copy
          </button>
        </div>
        <details open={previewOpen} onToggle={(event) => setPreviewOpen(event.currentTarget.open)}>
          <summary className="cursor-pointer text-xs text-stone-700">{previewOpen ? "Hide JSON" : "Show JSON"}</summary>
          {previewOpen ? (
            <pre className="mt-2 max-h-72 overflow-auto rounded-md border border-stone-200 bg-stone-50 p-2 text-xs">{jsonPreview}</pre>
          ) : null}
        </details>
      </section>
    </aside>
  );
}

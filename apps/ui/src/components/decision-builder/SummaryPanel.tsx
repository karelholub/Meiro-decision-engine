import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { DecisionValidationResponse } from "@decisioning/shared";
import type { DecisionDefinition } from "@decisioning/dsl";
import type { ValidationByStep } from "./types";
import { getDecisionSummaryText } from "./wizard-utils";
import { apiClient } from "../../lib/api";

interface SummaryPanelProps {
  definition: DecisionDefinition;
  validation: DecisionValidationResponse | null;
  groupedErrors: ValidationByStep[];
  readOnlyReasons: string[];
}

const pretty = (value: unknown) => JSON.stringify(value, null, 2);

export function SummaryPanel({ definition, validation, groupedErrors, readOnlyReasons }: SummaryPanelProps) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [catalogPreview, setCatalogPreview] = useState<unknown | null>(null);

  const summaryText = useMemo(() => getDecisionSummaryText(definition), [definition]);
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
          locale: "en",
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

  return (
    <aside className="sticky top-24 space-y-3">
      <section className="panel space-y-2 p-3 text-sm">
        <h3 className="font-semibold">Live summary</h3>
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

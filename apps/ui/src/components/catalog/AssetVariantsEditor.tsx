"use client";

import type { CatalogAssetVariant } from "@decisioning/shared";
import { Button } from "../ui/button";
import { safeJsonParse, toPrettyJson } from "./utils";

export type AssetVariantEditorRow = {
  id?: string;
  authoringMode: "structured" | "json";
  locale: string;
  channel: string;
  placementKey: string;
  isDefault: boolean;
  structuredFields: Record<string, string>;
  payloadJsonText: string;
  tokenBindingsText: string;
  clonedFromVariantId?: string | null;
  experimentKey: string;
  experimentVariantId: string;
  experimentRole: "" | "control" | "challenger" | "candidate";
  startAt: string;
  endAt: string;
};

const structuredFieldKeys = [
  ["title", "Title"],
  ["subtitle", "Subtitle"],
  ["body", "Body"],
  ["ctaLabel", "CTA label"],
  ["ctaUrl", "CTA URL / deeplink"],
  ["imageRef", "Image ref"],
  ["disclaimer", "Disclaimer"],
  ["promoCode", "Promo code"],
  ["badge", "Badge / urgency"],
  ["trackingId", "Tracking ID"]
] as const;

const structuredFieldKeySet = new Set<string>(structuredFieldKeys.map(([key]) => key));

const emptyStructuredFields = () => Object.fromEntries(structuredFieldKeys.map(([key]) => [key, ""]));

const payloadToStructuredFields = (payload: unknown): Record<string, string> => {
  const fields = emptyStructuredFields();
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return fields;
  }
  const record = payload as Record<string, unknown>;
  for (const [key] of structuredFieldKeys) {
    const value = record[key];
    fields[key] = typeof value === "string" ? value : "";
  }
  return fields;
};

const structuredFieldsToPayload = (fields: Record<string, string>, basePayload?: unknown) => {
  const payload: Record<string, unknown> = {};
  if (basePayload && typeof basePayload === "object" && !Array.isArray(basePayload)) {
    for (const [key, value] of Object.entries(basePayload as Record<string, unknown>)) {
      if (!structuredFieldKeySet.has(key)) {
        payload[key] = value;
      }
    }
  }
  for (const [key] of structuredFieldKeys) {
    const value = fields[key]?.trim();
    if (value) {
      payload[key] = value;
    }
  }
  return payload;
};

const unsupportedStructuredKeys = (payload: unknown) => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return [];
  }
  return Object.keys(payload as Record<string, unknown>).filter((key) => !structuredFieldKeySet.has(key)).sort((a, b) => a.localeCompare(b));
};

const isCommonStructuredPayload = (payload: unknown) => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return false;
  }
  const keys = Object.keys(payload as Record<string, unknown>);
  return keys.length > 0 && keys.every((key) => structuredFieldKeys.some(([fieldKey]) => fieldKey === key));
};

export const makeVariantEditorRows = (variants: CatalogAssetVariant[] | undefined, fallbackPayload: Record<string, unknown>): AssetVariantEditorRow[] => {
  const rows =
    variants?.map((variant) => ({
      id: variant.id,
      authoringMode: isCommonStructuredPayload(variant.payloadJson) ? "structured" as const : "json" as const,
      locale: variant.locale ?? "",
      channel: variant.channel ?? "",
      placementKey: variant.placementKey ?? "",
      isDefault: variant.isDefault,
      structuredFields: payloadToStructuredFields(variant.payloadJson),
      payloadJsonText: toPrettyJson(variant.payloadJson ?? {}),
      tokenBindingsText: toPrettyJson(variant.tokenBindings ?? {}),
      clonedFromVariantId: variant.clonedFromVariantId ?? null,
      experimentKey: variant.experimentKey ?? "",
      experimentVariantId: variant.experimentVariantId ?? "",
      experimentRole: (variant.experimentRole as AssetVariantEditorRow["experimentRole"]) ?? "",
      startAt: variant.startAt ? variant.startAt.slice(0, 16) : "",
      endAt: variant.endAt ? variant.endAt.slice(0, 16) : ""
    })) ?? [];
  return rows.length > 0
    ? rows
    : [
        {
          authoringMode: isCommonStructuredPayload(fallbackPayload) ? "structured" : "json",
          locale: "",
          channel: "",
          placementKey: "",
          isDefault: true,
          structuredFields: payloadToStructuredFields(fallbackPayload),
          payloadJsonText: toPrettyJson(fallbackPayload),
          tokenBindingsText: "{}\n",
          clonedFromVariantId: null,
          experimentKey: "",
          experimentVariantId: "",
          experimentRole: "",
          startAt: "",
          endAt: ""
        }
      ];
};

const fromDatetimeLocal = (value: string) => {
  if (!value.trim()) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

export const serializeVariantRows = (rows: AssetVariantEditorRow[]) =>
  rows.map((row, index) => {
    const basePayloadParsed = safeJsonParse<unknown>(row.payloadJsonText || "{}");
    const payloadParsed = row.authoringMode === "structured"
      ? {
          value: structuredFieldsToPayload(row.structuredFields, basePayloadParsed.value ?? {}),
          error: basePayloadParsed.error
        }
      : basePayloadParsed;
    if (payloadParsed.value === null || payloadParsed.error) {
      throw new Error(`Variant ${index + 1} payload JSON is invalid: ${payloadParsed.error}`);
    }
    const tokenBindingsParsed = safeJsonParse<Record<string, unknown>>(row.tokenBindingsText || "{}");
    if (tokenBindingsParsed.value === null) {
      throw new Error(`Variant ${index + 1} token bindings JSON is invalid: ${tokenBindingsParsed.error}`);
    }
    return {
      locale: row.locale.trim() || null,
      channel: row.channel.trim() || null,
      placementKey: row.placementKey.trim() || null,
      isDefault: row.isDefault,
      payloadJson: payloadParsed.value,
      tokenBindings: tokenBindingsParsed.value,
      clonedFromVariantId: row.clonedFromVariantId ?? null,
      experimentKey: row.experimentKey.trim() || null,
      experimentVariantId: row.experimentVariantId.trim() || null,
      experimentRole: row.experimentRole || null,
      metadataJson: row.authoringMode === "structured"
        ? { authoringMode: "structured", preservedJsonFields: unsupportedStructuredKeys(basePayloadParsed.value ?? {}) }
        : { authoringMode: "json" },
      startAt: fromDatetimeLocal(row.startAt),
      endAt: fromDatetimeLocal(row.endAt)
    };
  });

type Props = {
  rows: AssetVariantEditorRow[];
  onChange: (rows: AssetVariantEditorRow[]) => void;
  readOnly?: boolean;
  fallbackPayload: Record<string, unknown>;
};

export function AssetVariantsEditor({ rows, onChange, readOnly, fallbackPayload }: Props) {
  const setRow = (index: number, patch: Partial<AssetVariantEditorRow>) => {
    onChange(rows.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));
  };
  const cloneRow = (index: number, patch: Partial<AssetVariantEditorRow>) => {
    const source = rows[index];
    if (!source) return;
    onChange([
      ...rows.slice(0, index + 1),
      {
        ...source,
        ...patch,
        id: undefined,
        clonedFromVariantId: source.id ?? source.clonedFromVariantId ?? null,
        isDefault: patch.isDefault ?? false
      },
      ...rows.slice(index + 1)
    ]);
  };
  const now = Date.now();

  return (
    <section className="panel space-y-3 p-3">
      <div>
        <h3 className="font-semibold">Runtime Variants</h3>
        <p className="text-sm text-stone-700">Variants are matched by locale, channel, and placement, then fall back to defaults.</p>
      </div>
      {rows.map((row, index) => {
        const payloadParse = safeJsonParse<unknown>(row.payloadJsonText);
        const bindingsParse = safeJsonParse<Record<string, unknown>>(row.tokenBindingsText || "{}");
        const mergedStructuredPayload = structuredFieldsToPayload(row.structuredFields, payloadParse.value ?? {});
        const unsupportedKeys = unsupportedStructuredKeys(payloadParse.value ?? {});
        const startsAt = row.startAt ? new Date(row.startAt).getTime() : null;
        const endsAt = row.endAt ? new Date(row.endAt).getTime() : null;
        const validityState = startsAt && startsAt > now ? "scheduled" : endsAt && endsAt < now ? "expired" : "eligible";
        const scopeLabel = [row.locale || "default locale", row.channel || "any channel", row.placementKey || "any placement"].join(" / ");
        const ctaUrl = row.structuredFields.ctaUrl?.trim();
        const ctaUrlWarning = row.authoringMode === "structured" && ctaUrl && !/^(https?:\/\/|[a-z][a-z0-9+.-]*:\/\/|\/)/i.test(ctaUrl);
        return (
          <div key={`${row.id ?? "new"}-${index}`} className="space-y-3 rounded-md border border-stone-200 p-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded border border-stone-200 px-2 py-1">{scopeLabel}</span>
              {row.isDefault ? <span className="rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-emerald-700">default</span> : null}
              <span className={`rounded border px-2 py-1 ${validityState === "expired" ? "border-red-200 bg-red-50 text-red-700" : validityState === "scheduled" ? "border-amber-200 bg-amber-50 text-amber-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>
                {validityState}
              </span>
              {row.clonedFromVariantId ? <span className="rounded border border-stone-200 px-2 py-1">cloned</span> : null}
              {row.experimentKey ? <span className="rounded border border-indigo-200 bg-indigo-50 px-2 py-1 text-indigo-700">experiment candidate</span> : null}
            </div>
            <div className="grid gap-2 md:grid-cols-4">
              <label className="flex flex-col gap-1 text-sm">
                Locale
                <input
                  value={row.locale}
                  onChange={(event) => setRow(index, { locale: event.target.value })}
                  placeholder="en-US"
                  className="rounded-md border border-stone-300 px-2 py-1"
                  disabled={readOnly}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Channel
                <input
                  value={row.channel}
                  onChange={(event) => setRow(index, { channel: event.target.value })}
                  placeholder="inapp"
                  className="rounded-md border border-stone-300 px-2 py-1"
                  disabled={readOnly}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Placement
                <input
                  value={row.placementKey}
                  onChange={(event) => setRow(index, { placementKey: event.target.value })}
                  placeholder="home_top"
                  className="rounded-md border border-stone-300 px-2 py-1"
                  disabled={readOnly}
                />
              </label>
              <label className="mt-6 inline-flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={row.isDefault}
                  onChange={(event) => setRow(index, { isDefault: event.target.checked })}
                  disabled={readOnly}
                />
                Default fallback
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant={row.authoringMode === "structured" ? "default" : "outline"}
                onClick={() => setRow(index, { authoringMode: "structured", structuredFields: payloadToStructuredFields(payloadParse.value ?? {}) })}
                disabled={readOnly}
              >
                Structured
              </Button>
              <Button
                variant={row.authoringMode === "json" ? "default" : "outline"}
                onClick={() => setRow(index, { authoringMode: "json", payloadJsonText: toPrettyJson(mergedStructuredPayload) })}
                disabled={readOnly}
              >
                JSON
              </Button>
              <Button variant="outline" onClick={() => cloneRow(index, { locale: "", placementKey: "" })} disabled={readOnly}>
                Clone
              </Button>
              <Button variant="outline" onClick={() => cloneRow(index, { experimentRole: "candidate", experimentVariantId: `candidate_${rows.length + 1}` })} disabled={readOnly}>
                Clone as experiment candidate
              </Button>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {row.authoringMode === "structured" ? (
                <div className="grid gap-2 md:grid-cols-2">
                  {structuredFieldKeys.map(([fieldKey, label]) => (
                    <label key={fieldKey} className="flex flex-col gap-1 text-sm">
                      {label}
                      <input
                        value={row.structuredFields[fieldKey] ?? ""}
                        onChange={(event) => setRow(index, { structuredFields: { ...row.structuredFields, [fieldKey]: event.target.value } })}
                        className="rounded-md border border-stone-300 px-2 py-1"
                        disabled={readOnly}
                      />
                    </label>
                  ))}
                  {ctaUrlWarning ? <p className="text-xs text-red-700 md:col-span-2">CTA URL should be http(s), an app deeplink, or a relative path.</p> : null}
                  {unsupportedKeys.length > 0 ? (
                    <p className="text-xs text-amber-700 md:col-span-2">
                      Preserving unsupported JSON fields on save: {unsupportedKeys.join(", ")}.
                    </p>
                  ) : null}
                  {payloadParse.error ? <p className="text-xs text-red-700 md:col-span-2">Preserved JSON payload is invalid: {payloadParse.error}</p> : null}
                </div>
              ) : (
                <label className="flex flex-col gap-1 text-sm">
                  Payload JSON
                  <textarea
                    value={row.payloadJsonText}
                    onChange={(event) => setRow(index, { payloadJsonText: event.target.value })}
                    className="min-h-44 rounded-md border border-stone-300 px-2 py-1 font-mono text-xs"
                    disabled={readOnly}
                  />
                  {payloadParse.error ? <span className="text-xs text-red-700">{payloadParse.error}</span> : null}
                </label>
              )}
              <label className="flex flex-col gap-1 text-sm">
                Token bindings JSON
                <textarea
                  value={row.tokenBindingsText}
                  onChange={(event) => setRow(index, { tokenBindingsText: event.target.value })}
                  className="min-h-44 rounded-md border border-stone-300 px-2 py-1 font-mono text-xs"
                  disabled={readOnly}
                />
                {bindingsParse.error ? <span className="text-xs text-red-700">{bindingsParse.error}</span> : null}
              </label>
            </div>
            <div className="grid gap-2 md:grid-cols-3">
              <label className="flex flex-col gap-1 text-sm">
                Experiment key
                <input value={row.experimentKey} onChange={(event) => setRow(index, { experimentKey: event.target.value })} className="rounded-md border border-stone-300 px-2 py-1" disabled={readOnly} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Experiment variant ID
                <input value={row.experimentVariantId} onChange={(event) => setRow(index, { experimentVariantId: event.target.value })} className="rounded-md border border-stone-300 px-2 py-1" disabled={readOnly} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Experiment role
                <select value={row.experimentRole} onChange={(event) => setRow(index, { experimentRole: event.target.value as AssetVariantEditorRow["experimentRole"] })} className="rounded-md border border-stone-300 px-2 py-1" disabled={readOnly}>
                  <option value="">None</option>
                  <option value="control">Control</option>
                  <option value="challenger">Challenger</option>
                  <option value="candidate">Candidate</option>
                </select>
              </label>
            </div>
            <div className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
              <label className="flex flex-col gap-1 text-sm">
                Variant start
                <input
                  type="datetime-local"
                  value={row.startAt}
                  onChange={(event) => setRow(index, { startAt: event.target.value })}
                  className="rounded-md border border-stone-300 px-2 py-1"
                  disabled={readOnly}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Variant end
                <input
                  type="datetime-local"
                  value={row.endAt}
                  onChange={(event) => setRow(index, { endAt: event.target.value })}
                  className="rounded-md border border-stone-300 px-2 py-1"
                  disabled={readOnly}
                />
              </label>
              <Button variant="ghost" onClick={() => onChange(rows.filter((_, rowIndex) => rowIndex !== index))} disabled={readOnly}>
                Remove
              </Button>
            </div>
          </div>
        );
      })}
      <Button
        variant="outline"
        onClick={() =>
          onChange([
            ...rows,
            {
              authoringMode: isCommonStructuredPayload(fallbackPayload) ? "structured" : "json",
              locale: "",
              channel: "",
              placementKey: "",
              isDefault: rows.length === 0,
              structuredFields: payloadToStructuredFields(fallbackPayload),
              payloadJsonText: toPrettyJson(fallbackPayload),
              tokenBindingsText: "{}\n",
              clonedFromVariantId: null,
              experimentKey: "",
              experimentVariantId: "",
              experimentRole: "",
              startAt: "",
              endAt: ""
            }
          ])
        }
        disabled={readOnly}
      >
        Add variant
      </Button>
    </section>
  );
}

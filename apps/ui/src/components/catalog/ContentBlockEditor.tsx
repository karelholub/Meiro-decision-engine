"use client";

import { useState, type KeyboardEvent } from "react";
import { parseLegacyKey } from "@decisioning/shared";
import type { CatalogContentBlock } from "@decisioning/shared";
import { RefSelect } from "../registry/RefSelect";
import type { SchemaField } from "./utils";
import { LocaleTabsEditor } from "./LocaleTabsEditor";
import { TokenBindingsTable, type TokenBindingRow } from "./TokenBindingsTable";

type ContentBlockEditorModel = {
  key: string;
  name: string;
  description: string;
  status: CatalogContentBlock["status"];
  templateId: string;
  tags: string[];
  startAt: string;
  endAt: string;
  schemaJsonText: string;
  localesJsonText: string;
  tokenBindingsText: string;
};

type ContentBlockEditorProps = {
  value: ContentBlockEditorModel;
  onChange: (patch: Partial<ContentBlockEditorModel>) => void;
  readOnlyKey: boolean;
  readOnly?: boolean;
  availableTags: string[];
  schemaFields: SchemaField[];
  schemaRequired: string[];
  schemaOptional: string[];
  schemaFallbackInUse: boolean;
  localeData: Record<string, unknown>;
  activeLocale: string;
  onActiveLocaleChange: (locale: string) => void;
  onLocaleDataChange: (next: Record<string, unknown>) => void;
  tokenBindingsRows: TokenBindingRow[];
  onTokenBindingsRowsChange: (rows: TokenBindingRow[]) => void;
  bindingWarnings: { missing: string[]; unused: string[] };
  previewContext: Record<string, unknown>;
  advancedOnly: boolean;
  advancedReasons: string[];
  showAdvanced: boolean;
  onToggleAdvanced: () => void;
  localeOptions?: string[];
};

export function ContentBlockEditor({
  value,
  onChange,
  readOnlyKey,
  readOnly,
  availableTags,
  schemaFields,
  schemaRequired,
  schemaOptional,
  schemaFallbackInUse,
  localeData,
  activeLocale,
  onActiveLocaleChange,
  onLocaleDataChange,
  tokenBindingsRows,
  onTokenBindingsRowsChange,
  bindingWarnings,
  previewContext,
  advancedOnly,
  advancedReasons,
  showAdvanced,
  onToggleAdvanced,
  localeOptions
}: ContentBlockEditorProps) {
  const [pendingTag, setPendingTag] = useState("");

  const addTag = (input: string) => {
    const tag = input.trim();
    if (!tag || value.tags.includes(tag)) {
      return;
    }
    onChange({ tags: [...value.tags, tag] });
  };

  const onTagKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter" && event.key !== ",") {
      return;
    }
    event.preventDefault();
    addTag(pendingTag);
    setPendingTag("");
  };

  return (
    <article className="space-y-4">
      <section className="panel grid gap-3 p-4 md:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          Key
          <input
            value={value.key}
            onChange={(event) => onChange({ key: event.target.value })}
            className="rounded-md border border-stone-300 px-2 py-1"
            disabled={readOnlyKey || readOnly}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Name
          <input
            value={value.name}
            onChange={(event) => onChange({ name: event.target.value })}
            className="rounded-md border border-stone-300 px-2 py-1"
            disabled={readOnly}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm md:col-span-2">
          Description
          <input
            value={value.description}
            onChange={(event) => onChange({ description: event.target.value })}
            className="rounded-md border border-stone-300 px-2 py-1"
            disabled={readOnly}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Status
          <select
            value={value.status}
            onChange={(event) => onChange({ status: event.target.value as CatalogContentBlock["status"] })}
            className="rounded-md border border-stone-300 px-2 py-1"
            disabled={readOnly}
          >
            <option value="DRAFT">DRAFT</option>
            <option value="PENDING_APPROVAL">PENDING_APPROVAL</option>
            <option value="ACTIVE">ACTIVE</option>
            <option value="PAUSED">PAUSED</option>
            <option value="ARCHIVED">ARCHIVED</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Template ID
          <RefSelect
            type="template"
            value={value.templateId ? parseLegacyKey("template", value.templateId) : null}
            onChange={(nextRef) => onChange({ templateId: nextRef?.key ?? "" })}
            filter={{ status: "ACTIVE" }}
            disabled={readOnly}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Start At
          <input
            type="datetime-local"
            value={value.startAt}
            onChange={(event) => onChange({ startAt: event.target.value })}
            className="rounded-md border border-stone-300 px-2 py-1"
            disabled={readOnly}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          End At
          <input
            type="datetime-local"
            value={value.endAt}
            onChange={(event) => onChange({ endAt: event.target.value })}
            className="rounded-md border border-stone-300 px-2 py-1"
            disabled={readOnly}
          />
        </label>

        <div className="md:col-span-2 space-y-2">
          <label className="text-sm">Tags</label>
          <div className="flex flex-wrap gap-2 rounded-md border border-stone-300 px-2 py-2">
            {value.tags.map((tag) => (
              <span key={tag} className="inline-flex items-center gap-1 rounded-full border border-stone-300 bg-stone-100 px-2 py-0.5 text-xs">
                {tag}
                <button
                  type="button"
                  className="text-stone-500 hover:text-red-700"
                  onClick={() => onChange({ tags: value.tags.filter((entry) => entry !== tag) })}
                  aria-label={`Remove tag ${tag}`}
                  disabled={readOnly}
                >
                  x
                </button>
              </span>
            ))}
            <input
              list="catalog-content-tags"
              value={pendingTag}
              placeholder="Add tag"
              onChange={(event) => setPendingTag(event.target.value)}
              onKeyDown={onTagKeyDown}
              onBlur={() => {
                if (!pendingTag.trim()) {
                  return;
                }
                addTag(pendingTag);
                setPendingTag("");
              }}
              className="min-w-36 flex-1 border-none p-0 text-sm outline-none"
              disabled={readOnly}
            />
            <datalist id="catalog-content-tags">
              {availableTags.map((tag) => (
                <option value={tag} key={tag} />
              ))}
            </datalist>
          </div>
        </div>
      </section>

      <section className="panel space-y-3 p-4">
        <h3 className="font-semibold">Schema summary</h3>
        {schemaFallbackInUse ? (
          <p className="text-xs text-amber-700">Schema was missing. Using default schema for template `{value.templateId}`.</p>
        ) : null}
        <p className="text-sm">Template ID: {value.templateId}</p>
        <p className="text-sm">Required fields: {schemaRequired.join(", ") || "-"}</p>
        <p className="text-sm">Optional fields: {schemaOptional.join(", ") || "-"}</p>
        {advancedOnly ? <p className="text-xs text-amber-700">Advanced-only mode. {advancedReasons.join(" | ")}</p> : null}

        <details>
          <summary className="cursor-pointer text-sm font-medium">Edit schema (Advanced)</summary>
          <textarea
            value={value.schemaJsonText}
            onChange={(event) => onChange({ schemaJsonText: event.target.value })}
            className="mt-2 min-h-32 w-full rounded-md border border-stone-300 px-2 py-1 font-mono text-xs"
            disabled={readOnly}
          />
        </details>
      </section>

      <LocaleTabsEditor
        schemaFields={schemaFields}
        localesJson={localeData}
        activeLocale={activeLocale}
        localeOptions={localeOptions}
        advancedOnly={advancedOnly || Boolean(readOnly)}
        onActiveLocaleChange={onActiveLocaleChange}
        onLocalesChange={onLocaleDataChange}
      />

      <TokenBindingsTable
        rows={tokenBindingsRows}
        testContext={previewContext}
        missing={bindingWarnings.missing}
        unused={bindingWarnings.unused}
        onChange={onTokenBindingsRowsChange}
        readOnly={advancedOnly || readOnly}
      />

      <section className="panel p-4">
        <button type="button" className="text-sm font-medium underline" onClick={onToggleAdvanced} disabled={readOnly}>
          {showAdvanced ? "Hide Advanced JSON" : "Advanced JSON"}
        </button>
        {showAdvanced ? (
          <div className="mt-2 grid gap-3 md:grid-cols-3">
            <label className="flex flex-col gap-1 text-sm">
              localesJson
              <textarea
                value={value.localesJsonText}
                onChange={(event) => onChange({ localesJsonText: event.target.value })}
                className="min-h-56 rounded-md border border-stone-300 px-2 py-1 font-mono text-xs"
                disabled={readOnly}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              tokenBindings
              <textarea
                value={value.tokenBindingsText}
                onChange={(event) => onChange({ tokenBindingsText: event.target.value })}
                className="min-h-56 rounded-md border border-stone-300 px-2 py-1 font-mono text-xs"
                disabled={readOnly}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              schemaJson
              <textarea
                value={value.schemaJsonText}
                onChange={(event) => onChange({ schemaJsonText: event.target.value })}
                className="min-h-56 rounded-md border border-stone-300 px-2 py-1 font-mono text-xs"
                disabled={readOnly}
              />
            </label>
          </div>
        ) : null}
      </section>
    </article>
  );
}

"use client";

import React, { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { parseLegacyKey } from "@decisioning/shared";
import type { CatalogContentBlock } from "@decisioning/shared";
import { apiClient, type ActivationAssetType, type ActivationLibraryItem } from "../../lib/api";
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

type TypedContentAssetType = Exclude<ActivationAssetType, "offer" | "bundle">;

type TypedField = {
  key: string;
  label: string;
  help: string;
  multiline?: boolean;
};

const typedAssetLabels: Record<TypedContentAssetType, string> = {
  image: "Image",
  copy_snippet: "Copy Snippet",
  cta: "CTA",
  website_banner: "Website Banner",
  popup_banner: "Popup Banner",
  email_block: "Email Block",
  push_message: "Push Message",
  whatsapp_message: "WhatsApp Message",
  journey_asset: "Journey Asset"
};

const typedAssetUse: Record<TypedContentAssetType, string> = {
  image: "Reusable image reference for channel assets. This is not a binary upload workflow.",
  copy_snippet: "Reusable token-aware copy that can be referenced from channel assets.",
  cta: "Reusable action label and URL or deeplink target.",
  website_banner: "Website personalization content with banner placement and template defaults.",
  popup_banner: "Popup or modal content with short copy and action fields.",
  email_block: "Reusable email content block with headline, body, CTA, image, and footer fields.",
  push_message: "Mobile push notification content with short title, body, and deeplink.",
  whatsapp_message: "WhatsApp message content with body, variables, and button/action fields.",
  journey_asset: "Journey-compatible content block for message, decision, and fallback nodes."
};

const typedFields: Record<TypedContentAssetType, TypedField[]> = {
  image: [
    { key: "imageUrl", label: "Image URL", help: "Browser-reachable source used for the library thumbnail." },
    { key: "imageRef", label: "Image reference", help: "URL or external reference key. Keep this aligned with the source if no media service is connected." },
    { key: "description", label: "Description", help: "Alt text, source, rights, or intended use.", multiline: true },
    { key: "tags", label: "Image tags", help: "Comma-separated helper tags for search." }
  ],
  copy_snippet: [
    { key: "title", label: "Snippet name", help: "Short internal label." },
    { key: "text", label: "Copy", help: "Reusable text. Tokens such as {{profile.first_name}} are allowed.", multiline: true },
    { key: "tokenGuide", label: "Token guidance", help: "Notes for marketers about supported variables.", multiline: true }
  ],
  cta: [
    { key: "ctaLabel", label: "CTA label", help: "Button or link text." },
    { key: "ctaUrl", label: "Target URL or deeplink", help: "HTTP(S), app deeplink, relative URL, or token." },
    { key: "actionType", label: "Action type", help: "Example: open_url, open_app, open_product." }
  ],
  website_banner: [
    { key: "title", label: "Title", help: "Primary banner headline." },
    { key: "subtitle", label: "Subtitle", help: "Supporting copy.", multiline: true },
    { key: "cta", label: "CTA", help: "Button label." },
    { key: "deeplink", label: "URL or deeplink", help: "Destination for the banner action." },
    { key: "image", label: "Image URL or reference", help: "URL or image asset key." }
  ],
  popup_banner: [
    { key: "title", label: "Title", help: "Popup title." },
    { key: "body", label: "Body", help: "Short popup copy.", multiline: true },
    { key: "ctaLabel", label: "CTA label", help: "Button label." },
    { key: "ctaUrl", label: "URL or deeplink", help: "Destination for the popup action." },
    { key: "imageRef", label: "Image URL or reference", help: "Optional image URL or image asset key." }
  ],
  email_block: [
    { key: "headline", label: "Headline", help: "Email block headline." },
    { key: "body", label: "Body", help: "Email body copy.", multiline: true },
    { key: "ctaLabel", label: "CTA label", help: "Button or link text." },
    { key: "ctaUrl", label: "URL", help: "Destination URL." },
    { key: "imageRef", label: "Image URL or reference", help: "Optional image URL or image asset key." },
    { key: "footer", label: "Footer", help: "Footer or compliance copy.", multiline: true }
  ],
  push_message: [
    { key: "title", label: "Push title", help: "Short notification title." },
    { key: "body", label: "Push body", help: "Short mobile notification body.", multiline: true },
    { key: "deeplink", label: "Deeplink", help: "App or web destination." },
    { key: "action", label: "Action", help: "Example: open_app, open_product, open_url." }
  ],
  whatsapp_message: [
    { key: "body", label: "Message body", help: "Approved WhatsApp template body or draft copy.", multiline: true },
    { key: "buttonLabel", label: "Button label", help: "Button text when supported." },
    { key: "buttonAction", label: "Button action", help: "URL or deeplink target." },
    { key: "variableGuide", label: "Variable guidance", help: "Notes about template variables.", multiline: true }
  ],
  journey_asset: [
    { key: "title", label: "Step title", help: "Journey step title." },
    { key: "body", label: "Step copy", help: "Journey message or fallback copy.", multiline: true },
    { key: "nextStep", label: "Next step", help: "Human-readable next step hint." },
    { key: "ctaLabel", label: "CTA label", help: "Optional action label." },
    { key: "ctaUrl", label: "URL or deeplink", help: "Optional destination." }
  ]
};

const primitiveSelectors: Array<{ kind: "image" | "copy_snippet" | "cta"; field: string; label: string }> = [
  { kind: "image", field: "imageAssetKey", label: "Reusable image" },
  { kind: "copy_snippet", field: "copySnippetKey", label: "Reusable copy" },
  { kind: "cta", field: "ctaAssetKey", label: "Reusable CTA" }
];

const normalizeAssetType = (value: unknown): TypedContentAssetType | null => {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized === "copy") return "copy_snippet";
  if (normalized === "button") return "cta";
  if (normalized === "web_banner") return "website_banner";
  if (normalized === "popup") return "popup_banner";
  if (normalized === "email") return "email_block";
  if (normalized === "mobile_push") return "push_message";
  if (normalized === "whatsapp") return "whatsapp_message";
  if (normalized === "journey") return "journey_asset";
  return Object.prototype.hasOwnProperty.call(typedAssetLabels, normalized) ? normalized as TypedContentAssetType : null;
};

const readObject = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {});

const parseSchemaObject = (text: string): Record<string, unknown> => {
  try {
    return readObject(JSON.parse(text));
  } catch {
    return {};
  }
};

const typedAssetTypeFromEditor = (value: ContentBlockEditorModel): TypedContentAssetType | null => {
  const schema = parseSchemaObject(value.schemaJsonText);
  const activationAsset = readObject(schema.activationAsset);
  const library = readObject(schema.library);
  const explicit = normalizeAssetType(activationAsset.assetType) ?? normalizeAssetType(library.assetType);
  if (explicit) return explicit;

  for (const tag of value.tags) {
    const [prefix, ...rest] = tag.split(":");
    if (prefix === "asset" || prefix === "asset_type") {
      const tagged = normalizeAssetType(rest.join(":"));
      if (tagged) return tagged;
    }
  }

  return normalizeAssetType(value.templateId);
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
  const [primitiveAssets, setPrimitiveAssets] = useState<ActivationLibraryItem[]>([]);
  const [primitiveError, setPrimitiveError] = useState<string | null>(null);
  const typedAssetType = useMemo(() => typedAssetTypeFromEditor(value), [value.schemaJsonText, value.tags, value.templateId]);
  const locales = useMemo(() => Object.keys(localeData), [localeData]);
  const effectiveLocale = locales.includes(activeLocale) ? activeLocale : locales[0] ?? localeOptions?.[0] ?? "en";
  const localeValue = readObject(localeData[effectiveLocale]);
  const isChannelTypedAsset =
    typedAssetType !== null && !["image", "copy_snippet", "cta"].includes(typedAssetType);

  useEffect(() => {
    let cancelled = false;
    const loadPrimitives = async () => {
      if (!isChannelTypedAsset) {
        setPrimitiveAssets([]);
        setPrimitiveError(null);
        return;
      }
      try {
        const response = await apiClient.catalog.library.list({ category: "primitive", includeUnready: true });
        if (!cancelled) {
          setPrimitiveAssets(response.items.filter((item) => ["image", "copy_snippet", "cta"].includes(item.assetType)));
          setPrimitiveError(null);
        }
      } catch (loadError) {
        if (!cancelled) {
          setPrimitiveError(loadError instanceof Error ? loadError.message : "Failed to load reusable parts");
        }
      }
    };
    void loadPrimitives();
    return () => {
      cancelled = true;
    };
  }, [isChannelTypedAsset]);

  const addTag = (input: string) => {
    const tag = input.trim();
    if (!tag || value.tags.includes(tag)) {
      return;
    }
    onChange({ tags: [...value.tags, tag] });
  };

  const updateLocaleField = (field: string, nextValue: string) => {
    updateLocaleFields({ [field]: nextValue });
  };

  const updateLocaleFields = (patch: Record<string, unknown>) => {
    onLocaleDataChange({
      ...localeData,
      [effectiveLocale]: {
        ...localeValue,
        ...patch
      }
    });
  };

  const primitiveOptionsFor = (assetType: ActivationAssetType) =>
    primitiveAssets
      .filter((item) => item.assetType === assetType)
      .sort((a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key));

  const applyPrimitive = (field: string, item: ActivationLibraryItem | null) => {
    if (!item) {
      updateLocaleField(field, "");
      return;
    }
    const patch: Record<string, unknown> = { [field]: item.key };
    if (field === "imageAssetKey") {
      const currentImage = typeof localeValue.image === "string" ? localeValue.image : "";
      const currentImageRef = typeof localeValue.imageRef === "string" ? localeValue.imageRef : "";
      if (!currentImage && Object.prototype.hasOwnProperty.call(localeValue, "image")) {
        patch.image = item.key;
      } else if (!currentImageRef && Object.prototype.hasOwnProperty.call(localeValue, "imageRef")) {
        patch.imageRef = item.key;
      }
    }
    updateLocaleFields(patch);
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

      {typedAssetType ? (
        <section className="panel space-y-4 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-stone-500">Typed authoring</p>
              <h3 className="font-semibold">{typedAssetLabels[typedAssetType]}</h3>
              <p className="max-w-3xl text-sm text-stone-700">{typedAssetUse[typedAssetType]}</p>
            </div>
            <span className="rounded-md border border-stone-200 bg-stone-50 px-2 py-1 text-xs text-stone-700">
              Locale {effectiveLocale}
            </span>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            {typedFields[typedAssetType].map((field) => (
              <label key={field.key} className={`flex flex-col gap-1 text-sm ${field.multiline ? "md:col-span-2" : ""}`}>
                {field.label}
                {field.multiline ? (
                  <textarea
                    value={typeof localeValue[field.key] === "string" ? String(localeValue[field.key]) : ""}
                    onChange={(event) => updateLocaleField(field.key, event.target.value)}
                    className="min-h-24 rounded-md border border-stone-300 px-2 py-1"
                    disabled={readOnly}
                  />
                ) : (
                  <input
                    value={typeof localeValue[field.key] === "string" ? String(localeValue[field.key]) : ""}
                    onChange={(event) => updateLocaleField(field.key, event.target.value)}
                    className="rounded-md border border-stone-300 px-2 py-1"
                    disabled={readOnly}
                  />
                )}
                <span className="text-xs text-stone-500">{field.help}</span>
              </label>
            ))}
          </div>

          {isChannelTypedAsset ? (
            <div className="space-y-3 rounded-md border border-stone-200 bg-stone-50 p-3">
              <div>
                <p className="text-sm font-medium">Reusable parts</p>
                <p className="text-xs text-stone-600">
                  Link primitive assets into this channel payload. These write `imageAssetKey`, `copySnippetKey`, or `ctaAssetKey` so readiness can validate the reference.
                </p>
              </div>
              {primitiveError ? <p className="text-xs text-red-700">{primitiveError}</p> : null}
              <div className="grid gap-3 md:grid-cols-3">
                {primitiveSelectors.map((selector) => {
                  const options = primitiveOptionsFor(selector.kind);
                  const selected = typeof localeValue[selector.field] === "string" ? String(localeValue[selector.field]) : "";
                  return (
                    <label key={selector.field} className="flex flex-col gap-1 text-sm">
                      {selector.label}
                      <select
                        value={selected}
                        onChange={(event) => {
                          const item = options.find((option) => option.key === event.target.value) ?? null;
                          applyPrimitive(selector.field, item);
                        }}
                        className="rounded-md border border-stone-300 bg-white px-2 py-1"
                        disabled={readOnly}
                      >
                        <option value="">No reusable {selector.kind.replace("_", " ")}</option>
                        {options.map((item) => (
                          <option key={item.id} value={item.key}>
                            {item.name} ({item.key})
                          </option>
                        ))}
                      </select>
                      <span className="text-xs text-stone-500">
                        {selected ? `Writes ${selector.field}: ${selected}` : `Optional ${selector.field} reference`}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

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

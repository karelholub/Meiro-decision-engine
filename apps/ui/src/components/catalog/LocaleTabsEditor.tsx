"use client";

import { useMemo, useState } from "react";
import type { SchemaField } from "./utils";
import { Button } from "../ui/button";
import { readObject, toPrettyJson } from "./utils";

type LocaleTabsEditorProps = {
  schemaFields: SchemaField[];
  localesJson: Record<string, unknown>;
  activeLocale: string;
  localeOptions?: string[];
  advancedOnly: boolean;
  onActiveLocaleChange: (locale: string) => void;
  onLocalesChange: (next: Record<string, unknown>) => void;
};

export function LocaleTabsEditor({
  schemaFields,
  localesJson,
  activeLocale,
  localeOptions,
  advancedOnly,
  onActiveLocaleChange,
  onLocalesChange
}: LocaleTabsEditorProps) {
  const [pendingLocale, setPendingLocale] = useState("");
  const [copySource, setCopySource] = useState("");
  const [rawByLocale, setRawByLocale] = useState<Record<string, boolean>>({});
  const [rawDraftByLocale, setRawDraftByLocale] = useState<Record<string, string>>({});

  const locales = useMemo(() => Object.keys(localesJson), [localesJson]);
  const defaultLocale = localeOptions?.[0] ?? "en";
  const effectiveLocale = locales.includes(activeLocale) ? activeLocale : locales[0] ?? defaultLocale;
  const localeValue = readObject(localesJson[effectiveLocale]);

  const updateLocaleField = (field: string, value: string) => {
    const next = {
      ...localesJson,
      [effectiveLocale]: {
        ...localeValue,
        [field]: value
      }
    };
    onLocalesChange(next);
  };

  return (
    <section className="panel space-y-3 p-3">
      <div className="flex flex-wrap items-center gap-2">
        {locales.map((locale) => (
          <button
            key={locale}
            className={`rounded-md border px-2 py-1 text-sm ${locale === effectiveLocale ? "border-ink bg-stone-100" : "border-stone-300"}`}
            onClick={() => onActiveLocaleChange(locale)}
          >
            {locale}
          </button>
        ))}
        {locales.length === 0 ? <span className="text-sm text-stone-600">No locales yet.</span> : null}
      </div>

      <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto_auto]">
        <label className="sr-only" htmlFor="locale-add-input">
          Add locale (de, fr)
        </label>
        <input
          id="locale-add-input"
          aria-label="Add locale (de, fr)"
          list="catalog-content-locale-options"
          value={pendingLocale}
          onChange={(event) => setPendingLocale(event.target.value)}
          className="rounded-md border border-stone-300 px-2 py-1 text-sm"
          placeholder="Add locale (de, fr)"
          disabled={advancedOnly}
        />
        {localeOptions && localeOptions.length > 0 ? (
          <datalist id="catalog-content-locale-options">
            {localeOptions.map((locale) => (
              <option key={locale} value={locale} />
            ))}
          </datalist>
        ) : null}
        <Button
          variant="outline"
          type="button"
          onClick={() => {
            const locale = pendingLocale.trim();
            if (!locale || localesJson[locale]) {
              return;
            }
            const next = { ...localesJson, [locale]: {} };
            onLocalesChange(next);
            onActiveLocaleChange(locale);
            setPendingLocale("");
          }}
          disabled={advancedOnly}
        >
          Add locale
        </Button>
        <Button
          variant="outline"
          type="button"
          onClick={() => {
            const source = copySource.trim();
            if (!source || !localesJson[source]) {
              return;
            }
            const next = { ...localesJson, [effectiveLocale]: readObject(localesJson[source]) };
            onLocalesChange(next);
          }}
          disabled={advancedOnly}
        >
          Copy locale from
        </Button>
      </div>

      <select
        aria-label="Copy locale source"
        value={copySource}
        onChange={(event) => setCopySource(event.target.value)}
        className="rounded-md border border-stone-300 px-2 py-1 text-sm"
      >
        <option value="">Select source locale</option>
        {locales
          .filter((locale) => locale !== effectiveLocale)
          .map((locale) => (
            <option key={locale} value={locale}>
              {locale}
            </option>
          ))}
      </select>

      <label className="inline-flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={Boolean(rawByLocale[effectiveLocale])}
          onChange={(event) => setRawByLocale((current) => ({ ...current, [effectiveLocale]: event.target.checked }))}
        />
        Raw JSON for this locale
      </label>

      {rawByLocale[effectiveLocale] ? (
        <textarea
          value={rawDraftByLocale[effectiveLocale] ?? toPrettyJson(localeValue)}
          onChange={(event) => {
            setRawDraftByLocale((current) => ({ ...current, [effectiveLocale]: event.target.value }));
            try {
              const parsed = JSON.parse(event.target.value) as Record<string, unknown>;
              onLocalesChange({
                ...localesJson,
                [effectiveLocale]: parsed
              });
            } catch {
              // Keep editing flow permissive; advanced JSON panel captures parse errors on save/validate.
            }
          }}
          className="min-h-40 rounded-md border border-stone-300 px-2 py-1 font-mono text-xs"
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {schemaFields.map((field) => (
            <label key={field.key} className="flex flex-col gap-1 text-sm">
              {field.key}
              <input
                value={typeof localeValue[field.key] === "string" ? String(localeValue[field.key]) : ""}
                onChange={(event) => updateLocaleField(field.key, event.target.value)}
                className="rounded-md border border-stone-300 px-2 py-1"
                disabled={advancedOnly}
              />
              <span className="text-xs text-stone-500">{field.required ? "Required" : "Optional"}</span>
            </label>
          ))}
        </div>
      )}
    </section>
  );
}

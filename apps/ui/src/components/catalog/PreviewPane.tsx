"use client";

import { Button } from "../ui/button";
import { PagePanel, inputClassName } from "../ui/page";

type PreviewPaneProps = {
  localeOptions: string[];
  previewLocale: string;
  testProfileId: string;
  contextJsonText: string;
  onPreviewLocaleChange: (value: string) => void;
  onTestProfileIdChange: (value: string) => void;
  onContextJsonChange: (value: string) => void;
  onRunPreview: () => void;
  visualPayload: Record<string, unknown> | null;
  renderedJson: unknown;
  missingTokens: string[];
};

export function PreviewPane({
  localeOptions,
  previewLocale,
  testProfileId,
  contextJsonText,
  onPreviewLocaleChange,
  onTestProfileIdChange,
  onContextJsonChange,
  onRunPreview,
  visualPayload,
  renderedJson,
  missingTokens
}: PreviewPaneProps) {
  return (
    <PagePanel density="compact" className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
      <div className="space-y-3">
        <h3 className="font-semibold">Preview inputs</h3>
        <label className="flex flex-col gap-1 text-sm">
          Locale
          <select value={previewLocale} onChange={(event) => onPreviewLocaleChange(event.target.value)} className={inputClassName}>
            {localeOptions.map((locale) => (
              <option key={locale} value={locale}>
                {locale}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Test profile selector
          <input
            value={testProfileId}
            onChange={(event) => onTestProfileIdChange(event.target.value)}
            className={inputClassName}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Context JSON
          <textarea
            value={contextJsonText}
            onChange={(event) => onContextJsonChange(event.target.value)}
            className={`${inputClassName} min-h-32 font-mono text-xs`}
          />
        </label>
        <Button variant="outline" onClick={onRunPreview}>
          Run preview
        </Button>
      </div>

      <div className="space-y-3">
        <h3 className="font-semibold">Visual preview</h3>
        <article className="rounded-md border border-stone-200 bg-gradient-to-r from-sky-50 via-white to-emerald-50 p-3">
          <p className="text-sm text-stone-600">banner_v1</p>
          <h4 className="mt-1.5 text-lg font-semibold">{String(visualPayload?.title ?? "Title")}</h4>
          <p className="mt-1 text-sm text-stone-700">{String(visualPayload?.subtitle ?? "Subtitle")}</p>
          <div className="mt-3 flex items-center justify-between gap-3">
            <button className="rounded-md bg-ink px-3 py-2 text-sm text-white">{String(visualPayload?.cta ?? "Open")}</button>
            <code className="text-xs text-stone-500">{String(visualPayload?.deeplink ?? "app://")}</code>
          </div>
          <p className="mt-2 text-xs text-stone-600">Image: {String(visualPayload?.image ?? "-")}</p>
        </article>

        {missingTokens.length > 0 ? <p className="text-xs text-amber-700">Missing tokens: {missingTokens.join(", ")}</p> : null}

        <details>
          <summary className="cursor-pointer text-sm font-medium">Rendered JSON</summary>
          <pre className="mt-2 overflow-auto rounded-md border border-stone-200 bg-stone-50 p-2 text-xs">
            {JSON.stringify(renderedJson, null, 2)}
          </pre>
        </details>
      </div>
    </PagePanel>
  );
}

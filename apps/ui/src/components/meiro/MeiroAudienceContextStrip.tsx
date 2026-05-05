"use client";

import { normalizeMeiroAudienceRef } from "../../lib/meiro-audience-context";

type MeiroAudienceContextStripProps = {
  audience: string;
  onClear?: () => void;
  className?: string;
};

export function MeiroAudienceContextStrip({ audience, onClear, className = "" }: MeiroAudienceContextStripProps) {
  const normalized = normalizeMeiroAudienceRef(audience);
  if (!normalized) {
    return null;
  }

  return (
    <div className={`flex flex-wrap items-center justify-between gap-2 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900 ${className}`}>
      <div className="min-w-0">
        <span className="font-medium">Using Pipes audience</span>
        <span className="ml-2 truncate font-mono text-xs">{normalized}</span>
      </div>
      {onClear ? (
        <button type="button" className="text-xs font-medium text-sky-800 underline decoration-current/40 underline-offset-2" onClick={onClear}>
          Reset
        </button>
      ) : null}
    </div>
  );
}

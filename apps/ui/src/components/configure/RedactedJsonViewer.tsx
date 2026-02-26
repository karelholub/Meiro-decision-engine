"use client";

import { useMemo } from "react";
import { Button } from "../ui/button";
import { toDisplayJson } from "./utils";

export function RedactedJsonViewer({
  title,
  value,
  maxChars = 2048,
  redactionKeys = [],
  defaultOpen = false
}: {
  title: string;
  value: unknown;
  maxChars?: number;
  redactionKeys?: string[];
  defaultOpen?: boolean;
}) {
  const display = useMemo(() => toDisplayJson(value, { maxChars, redactionKeys }), [maxChars, redactionKeys, value]);

  return (
    <details className="rounded-md border border-stone-200 bg-stone-50 p-2" open={defaultOpen}>
      <summary className="cursor-pointer text-sm font-medium">{title}{display.truncated ? " (truncated)" : ""}</summary>
      <div className="mt-2 space-y-2">
        <Button
          variant="outline"
          size="sm"
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(display.text);
          }}
        >
          Copy JSON
        </Button>
        <pre className="max-h-80 overflow-auto text-xs">{display.text}</pre>
      </div>
    </details>
  );
}

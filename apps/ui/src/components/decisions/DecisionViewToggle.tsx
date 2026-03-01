import React from "react";
import type { DecisionListView } from "./utils";

type DecisionViewToggleProps = {
  value: DecisionListView;
  onChange: (next: DecisionListView) => void;
};

export function DecisionViewToggle({ value, onChange }: DecisionViewToggleProps) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-stone-700">View:</span>
      <button
        type="button"
        className={`rounded-md border px-2 py-1 ${value === "compact" ? "border-ink bg-ink text-white" : "border-stone-300"}`}
        onClick={() => onChange("compact")}
      >
        Compact
      </button>
      <button
        type="button"
        className={`rounded-md border px-2 py-1 ${value === "expanded" ? "border-ink bg-ink text-white" : "border-stone-300"}`}
        onClick={() => onChange("expanded")}
      >
        Expanded
      </button>
    </div>
  );
}

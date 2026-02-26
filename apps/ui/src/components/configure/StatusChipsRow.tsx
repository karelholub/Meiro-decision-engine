"use client";

import { Badge } from "../ui/badge";
import type { StatusChipState } from "./utils";

type StatusChip = {
  label: string;
  status: StatusChipState;
  detail?: string;
};

const variantByStatus: Record<StatusChipState, "neutral" | "success" | "warning" | "danger"> = {
  ok: "success",
  warn: "warning",
  error: "danger",
  unknown: "neutral"
};

export function StatusChipsRow({ chips }: { chips: StatusChip[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {chips.map((chip) => (
        <span key={chip.label} className="inline-flex items-center gap-2">
          <Badge variant={variantByStatus[chip.status]}>{chip.label}</Badge>
          {chip.detail ? <span className="text-xs text-stone-600">{chip.detail}</span> : null}
        </span>
      ))}
    </div>
  );
}

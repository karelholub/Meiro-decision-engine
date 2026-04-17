import type { ReactNode } from "react";
import { Badge } from "./badge";

export type EntityStatus = "DRAFT" | "ACTIVE" | "PAUSED" | "ARCHIVED" | "PENDING_APPROVAL";
export type SignalStatus = EntityStatus | "ready" | "ready_with_warnings" | "blocked" | "healthy" | "warning" | "critical";

export const statusVariant = (status: EntityStatus): "neutral" | "success" | "warning" | "danger" => {
  if (status === "ACTIVE") return "success";
  if (status === "PAUSED" || status === "PENDING_APPROVAL") return "warning";
  if (status === "ARCHIVED") return "danger";
  return "neutral";
};

export const signalLabel = (status: SignalStatus | string) => {
  const labels: Record<string, string> = {
    ACTIVE: "Active",
    DRAFT: "Draft",
    PAUSED: "Paused",
    ARCHIVED: "Archived",
    PENDING_APPROVAL: "Pending approval",
    ready: "Ready",
    ready_with_warnings: "Ready with warnings",
    blocked: "Needs fix",
    healthy: "Healthy",
    warning: "Warning",
    critical: "Needs attention"
  };
  return labels[status] ?? status;
};

export const signalVariant = (status: SignalStatus | string): "neutral" | "success" | "warning" | "danger" => {
  if (status === "ACTIVE" || status === "ready" || status === "healthy") return "success";
  if (status === "PAUSED" || status === "PENDING_APPROVAL" || status === "ready_with_warnings" || status === "warning") return "warning";
  if (status === "ARCHIVED" || status === "blocked" || status === "critical") return "danger";
  return "neutral";
};

export function StatusBadge({ status }: { status: EntityStatus }) {
  return <Badge variant={statusVariant(status)}>{signalLabel(status)}</Badge>;
}

export function SignalBadge({ status, children }: { status: SignalStatus | string; children?: ReactNode }) {
  return <Badge variant={signalVariant(status)}>{children ?? signalLabel(status)}</Badge>;
}

export function HasDraftBadge() {
  return <Badge className="border-indigo-200 bg-indigo-50 text-indigo-700">Has draft</Badge>;
}

export function EndsSoonBadge() {
  return <Badge variant="warning">Ends soon</Badge>;
}

export function NoTrafficBadge() {
  return <Badge className="border-stone-300 bg-white text-stone-700">No traffic</Badge>;
}

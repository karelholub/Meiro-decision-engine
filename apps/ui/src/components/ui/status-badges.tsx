import { Badge } from "./badge";

export type EntityStatus = "DRAFT" | "ACTIVE" | "PAUSED" | "ARCHIVED" | "PENDING_APPROVAL";

export const statusVariant = (status: EntityStatus): "neutral" | "success" | "warning" => {
  if (status === "ACTIVE") return "success";
  if (status === "PAUSED" || status === "PENDING_APPROVAL") return "warning";
  return "neutral";
};

export function StatusBadge({ status }: { status: EntityStatus }) {
  return <Badge variant={statusVariant(status)}>{status}</Badge>;
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

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { DecisionApprovalQueueItem } from "@decisioning/shared";
import PermissionDenied from "../../../components/permission-denied";
import { apiClient } from "../../../lib/api";
import { usePermissions } from "../../../lib/permissions";
import { EmptyState } from "../../../components/ui/app-state";
import { SignalChip } from "../../../components/ui/badge";
import { Button, ButtonLink } from "../../../components/ui/button";
import { FieldLabel, FilterPanel, PageHeader, inputClassName } from "../../../components/ui/page";

type ApprovalStatusFilter = "pending" | "approved" | "rejected";

export default function DecisionApprovalsPage() {
  const { hasPermission } = usePermissions();
  const [items, setItems] = useState<DecisionApprovalQueueItem[]>([]);
  const [status, setStatus] = useState<ApprovalStatusFilter>("pending");
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const canReview = hasPermission("decision.activate");

  const load = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const response = await apiClient.decisions.approvals({ status, limit: 100 });
      setItems(response.items);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to load approvals");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [status]);

  const review = async (item: DecisionApprovalQueueItem, action: "approve" | "reject") => {
    setReviewingId(`${item.id}:${action}`);
    try {
      await apiClient.decisions.reviewApproval(item.decisionId, item.id, {
        action,
        note: reviewNotes[item.id]?.trim() ?? ""
      });
      setReviewNotes((current) => {
        const next = { ...current };
        delete next[item.id];
        return next;
      });
      setMessage(action === "approve" ? "Approval request approved." : "Approval request rejected.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to review approval");
    } finally {
      setReviewingId(null);
    }
  };

  if (!hasPermission("decision.read")) {
    return <PermissionDenied title="You don't have permission to view decision approvals" />;
  }

  return (
    <section className="space-y-4">
      <PageHeader
        density="compact"
        title="Decision approvals"
        description="Review draft activation requests across decisions."
        actions={<ButtonLink href="/decisions" size="sm" variant="outline">Decisions</ButtonLink>}
      />

      <FilterPanel density="compact" className="!space-y-0 flex flex-wrap items-end gap-2">
        <FieldLabel className="min-w-36">
          Status
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as ApprovalStatusFilter)}
            className={inputClassName}
          >
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
        </FieldLabel>
        <Button type="button" size="sm" variant="outline" onClick={() => void load()}>
          Refresh
        </Button>
        {loading ? <span className="text-xs text-stone-600">Loading...</span> : null}
      </FilterPanel>

      {message ? <p className="text-sm text-stone-700">{message}</p> : null}

      <div className="grid gap-3">
        {items.map((item) => (
          <article key={item.id} className="panel p-3 text-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-base font-semibold">{item.decisionName || item.decisionKey}</p>
                <p className="text-xs text-stone-600">
                  {item.decisionKey} · v{item.version ?? "-"} · requested {new Date(item.createdAt).toLocaleString()}
                </p>
                {item.summary ? <p className="mt-2 text-stone-700">{item.summary}</p> : null}
                {item.createdByEmail ? <p className="mt-1 text-xs text-stone-500">Requested by {item.createdByEmail}</p> : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <SignalChip tone={item.status === "approved" ? "success" : item.status === "rejected" ? "danger" : "warning"}>{item.status}</SignalChip>
                <Link href={`/decisions/${item.decisionId}/edit?tab=basic`} className="rounded-md border border-stone-300 px-2 py-0.5 text-xs">
                  Open draft
                </Link>
              </div>
            </div>

            {item.status === "pending" && canReview ? (
              <div className="mt-3 grid gap-2 md:grid-cols-[1fr_auto]">
                <textarea
                  value={reviewNotes[item.id] ?? ""}
                  onChange={(event) => setReviewNotes((current) => ({ ...current, [item.id]: event.target.value }))}
                  className={`${inputClassName} min-h-20 text-sm`}
                  placeholder="Review note, risk, or ticket"
                />
                <div className="flex flex-wrap items-start gap-2 md:flex-col">
                  <Button
                    type="button"
                    size="sm"
                    disabled={Boolean(reviewingId)}
                    onClick={() => void review(item, "approve")}
                    className="bg-emerald-700 hover:bg-emerald-800"
                  >
                    {reviewingId === `${item.id}:approve` ? "Approving..." : "Approve"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={Boolean(reviewingId)}
                    onClick={() => void review(item, "reject")}
                    className="border-red-300 text-red-700"
                  >
                    {reviewingId === `${item.id}:reject` ? "Rejecting..." : "Reject"}
                  </Button>
                </div>
              </div>
            ) : null}
          </article>
        ))}
      </div>

      {items.length === 0 && !loading ? (
        <EmptyState title={`No ${status} decision approvals`} />
      ) : null}
    </section>
  );
}

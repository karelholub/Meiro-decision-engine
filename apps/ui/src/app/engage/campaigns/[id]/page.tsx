"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { InAppAuditLog, InAppCampaign, InAppCampaignActivationPreview, InAppCampaignVersion } from "@decisioning/shared";
import { DependenciesPanel } from "../../../../components/registry/DependenciesPanel";
import { ResolvedRefValue } from "../../../../components/registry/ResolvedRefValue";
import { EndsSoonBadge, StatusBadge } from "../../../../components/ui/status-badges";
import { apiClient } from "../../../../lib/api";
import { validateCampaignDependencies } from "../../../../lib/dependencies";
import { usePermissions } from "../../../../lib/permissions";
import { useRegistry } from "../../../../lib/registry";

export default function CampaignDetailsPage() {
  const params = useParams<{ id: string }>();
  const id = String(params.id ?? "");
  const { hasPermission } = usePermissions();
  const registry = useRegistry();

  const canWrite = hasPermission("engage.campaign.write");
  const canActivate = hasPermission("engage.campaign.activate");
  const canArchive = hasPermission("engage.campaign.archive");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [campaign, setCampaign] = useState<InAppCampaign | null>(null);
  const [preview, setPreview] = useState<InAppCampaignActivationPreview | null>(null);
  const [versions, setVersions] = useState<InAppCampaignVersion[]>([]);
  const [auditLogs, setAuditLogs] = useState<InAppAuditLog[]>([]);

  const load = async () => {
    if (!id) {
      return;
    }
    setLoading(true);
    try {
      const [campaignResponse, previewResponse, versionsResponse, auditResponse] = await Promise.all([
        apiClient.inapp.campaigns.get(id),
        apiClient.inapp.campaigns.activationPreview(id),
        apiClient.inapp.campaigns.versions(id),
        apiClient.inapp.campaigns.audit(id, 25)
      ]);
      setCampaign(campaignResponse.item);
      setPreview(previewResponse.item);
      setVersions(versionsResponse.items);
      setAuditLogs(auditResponse.items);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load campaign details");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [id]);

  const runAction = async (action: "activate" | "archive" | "submit" | "reject") => {
    if (!campaign) return;
    try {
      if (action === "activate") await apiClient.inapp.campaigns.approveAndActivate(campaign.id);
      if (action === "archive") await apiClient.inapp.campaigns.archive(campaign.id);
      if (action === "submit") await apiClient.inapp.campaigns.submitForApproval(campaign.id);
      if (action === "reject") await apiClient.inapp.campaigns.rejectToDraft(campaign.id);
      setMessage(`${action} completed.`);
      await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : `${action} failed`);
    }
  };

  const copyText = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setMessage(`${label} copied.`);
    } catch {
      setError(`Failed to copy ${label.toLowerCase()}.`);
    }
  };

  const latestAudit = useMemo(() => auditLogs.slice(0, 10), [auditLogs]);
  const dependencyItems = useMemo(() => {
    if (!campaign) {
      return [];
    }
    return validateCampaignDependencies(registry, campaign);
  }, [campaign, registry]);

  return (
    <div className="space-y-4">
      <header className="rounded-lg border border-stone-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-xl font-semibold">{campaign?.name ?? "Campaign"}</h2>
            <p className="text-sm text-stone-600">Key: <span className="font-mono">{campaign?.key ?? "-"}</span></p>
            <div className="mt-1 flex gap-1 text-xs">
              {campaign?.status ? <StatusBadge status={campaign.status as "DRAFT" | "ACTIVE" | "PENDING_APPROVAL" | "ARCHIVED"} /> : null}
              {campaign?.endAt && new Date(campaign.endAt).getTime() - Date.now() < 7 * 24 * 60 * 60 * 1000 ? <EndsSoonBadge /> : null}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {campaign?.key ? <button className="rounded border border-stone-300 px-3 py-2 text-sm" onClick={() => void copyText(campaign.key, "Key")}>Copy key</button> : null}
            <button className="rounded border border-stone-300 px-3 py-2 text-sm" onClick={() => void copyText(`/v1/inapp/campaigns/${id}`, "API ref")}>Copy API ref</button>
            <Link className="rounded border border-stone-300 px-3 py-2 text-sm" href="/engage/campaigns">Back to inventory</Link>
            {canWrite ? <Link className="rounded border border-stone-300 px-3 py-2 text-sm" href={`/engage/campaigns/${id}/edit`}>Edit draft</Link> : null}
          </div>
        </div>
      </header>

      {error ? <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}
      {message ? <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</div> : null}

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-3">
          <article className="rounded-lg border border-stone-200 bg-white p-4">
            <h3 className="font-semibold">Summary</h3>
            <div className="mt-2 grid gap-3 text-sm md:grid-cols-2">
              <div>
                <p><strong>App:</strong> <ResolvedRefValue type="app" value={campaign?.appKey ?? null} /></p>
                <p><strong>Placement:</strong> <ResolvedRefValue type="placement" value={campaign?.placementKey ?? null} /></p>
                <p><strong>Template:</strong> <ResolvedRefValue type="template" value={campaign?.templateKey ?? null} /></p>
                <p><strong>Experiment:</strong> <ResolvedRefValue type="experiment" value={campaign?.experimentKey ?? null} /></p>
              </div>
              <div>
                <p><strong>Variants:</strong> {campaign?.variants.map((variant) => `${variant.variantKey} ${variant.weight}%`).join(" / ") || "-"}</p>
                <p><strong>Holdout:</strong> {campaign?.holdoutEnabled ? `${campaign.holdoutPercentage}%` : "Off"}</p>
                <p><strong>TTL:</strong> {campaign?.ttlSeconds ?? 0}s</p>
                <p><strong>Schedule:</strong> {campaign?.startAt ? new Date(campaign.startAt).toLocaleString() : "-"} {" -> "} {campaign?.endAt ? new Date(campaign.endAt).toLocaleString() : "-"}</p>
              </div>
            </div>
          </article>

          <article className="rounded-lg border border-stone-200 bg-white p-4">
            <h3 className="font-semibold">Activation Preview</h3>
            <p className="mt-1 text-sm">Can activate: <strong>{preview?.canActivate ? "Yes" : "No"}</strong></p>
            <div className="mt-2 space-y-1 text-sm">
              {preview?.warnings.length ? preview.warnings.map((warning) => (
                <p key={warning} className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-amber-800">{warning}</p>
              )) : <p className="text-stone-600">No warnings.</p>}
            </div>
            <div className="mt-2 space-y-1 text-sm">
              {preview?.conflicts.length ? preview.conflicts.map((conflict) => (
                <p key={conflict.id} className="rounded border border-rose-200 bg-rose-50 px-2 py-1 text-rose-800">Conflict: {conflict.key} (priority {conflict.priority})</p>
              )) : null}
            </div>
          </article>

          <article className="rounded-lg border border-stone-200 bg-white p-4">
            <h3 className="font-semibold">Versions</h3>
            <div className="mt-2 max-h-64 overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-stone-600">
                    <th className="border-b border-stone-200 px-2 py-2">Version</th>
                    <th className="border-b border-stone-200 px-2 py-2">Reason</th>
                    <th className="border-b border-stone-200 px-2 py-2">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {versions.map((version) => (
                    <tr key={version.id}>
                      <td className="border-b border-stone-100 px-2 py-2">v{version.version}</td>
                      <td className="border-b border-stone-100 px-2 py-2">{version.reason ?? "-"}</td>
                      <td className="border-b border-stone-100 px-2 py-2">{new Date(version.createdAt).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>

          <article className="rounded-lg border border-stone-200 bg-white p-4">
            <h3 className="font-semibold">Recent Activity</h3>
            <ul className="mt-2 space-y-1 text-sm">
              {latestAudit.map((entry) => (
                <li key={entry.id} className="rounded border border-stone-200 px-2 py-1">{new Date(entry.createdAt).toLocaleString()} - {entry.action} ({entry.userRole})</li>
              ))}
              {!latestAudit.length ? <li className="text-stone-600">No recent activity.</li> : null}
            </ul>
          </article>
        </div>

        <aside className="space-y-3">
          <DependenciesPanel items={dependencyItems} />
          <article className="rounded-lg border border-stone-200 bg-white p-4">
            <h3 className="font-semibold">Actions</h3>
            <div className="mt-2 grid gap-2">
              {canWrite ? <button className="rounded border border-stone-300 px-3 py-2 text-sm text-left" onClick={() => void runAction("submit")} disabled={loading}>Submit for approval</button> : null}
              {canActivate ? <button className="rounded border border-indigo-400 px-3 py-2 text-left text-sm text-indigo-700" onClick={() => void runAction("activate")} disabled={loading}>Approve & activate</button> : null}
              {canWrite ? <button className="rounded border border-stone-300 px-3 py-2 text-left text-sm" onClick={() => void runAction("reject")} disabled={loading}>Reject to draft</button> : null}
              {canArchive ? <button className="rounded border border-rose-300 px-3 py-2 text-left text-sm text-rose-700" onClick={() => void runAction("archive")} disabled={loading}>Archive</button> : null}
            </div>
          </article>
        </aside>
      </section>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { ExperimentDetails, ExperimentSummaryDetails } from "@decisioning/shared";
import { apiClient } from "../../../../lib/api";
import { usePermissions } from "../../../../lib/permissions";

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

export default function ExperimentDetailsPage() {
  const params = useParams<{ key: string }>();
  const key = decodeURIComponent(params.key ?? "");
  const { hasPermission } = usePermissions();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [summary, setSummary] = useState<ExperimentSummaryDetails | null>(null);
  const [details, setDetails] = useState<ExperimentDetails | null>(null);
  const [previewIdentityType, setPreviewIdentityType] = useState<"profileId" | "anonymousId" | "lookup">("profileId");
  const [previewIdentityValue, setPreviewIdentityValue] = useState("preview_profile");
  const [previewLookupAttribute, setPreviewLookupAttribute] = useState("email");
  const [previewContextText, setPreviewContextText] = useState('{"locale":"en-US"}');
  const [previewResult, setPreviewResult] = useState<Record<string, unknown> | null>(null);

  const canWrite = hasPermission("experiment.write");
  const canActivate = hasPermission("experiment.activate");
  const canArchive = hasPermission("experiment.archive");
  const canPromote = hasPermission("promotion.create");

  const load = async () => {
    setLoading(true);
    try {
      const [summaryResponse, detailsResponse] = await Promise.all([
        apiClient.experiments.summary(key),
        apiClient.experiments.getByKey(key)
      ]);
      setSummary(summaryResponse.item);
      setDetails(detailsResponse.item);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load experiment details");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!key) {
      return;
    }
    void load();
  }, [key]);

  const parsedSpec = useMemo(() => {
    const json = details?.experimentJson;
    if (!isRecord(json)) {
      return null;
    }
    const scope: Record<string, unknown> = isRecord(json.scope) ? json.scope : {};
    const population: Record<string, unknown> = isRecord(json.population) ? json.population : {};
    const eligibility: Record<string, unknown> = isRecord(population.eligibility) ? population.eligibility : {};
    const assignment: Record<string, unknown> = isRecord(json.assignment) ? json.assignment : {};
    const stickiness: Record<string, unknown> = isRecord(assignment.stickiness) ? assignment.stickiness : {};
    const holdout: Record<string, unknown> = isRecord(json.holdout) ? json.holdout : {};
    const activation: Record<string, unknown> = isRecord(json.activation) ? json.activation : {};

    const variants = Array.isArray(json.variants) ? json.variants : [];

    return {
      scope,
      eligibility,
      assignment,
      stickiness,
      holdout,
      activation,
      variants
    };
  }, [details?.experimentJson]);

  const createDraft = async () => {
    try {
      await apiClient.experiments.createDraft(key);
      setMessage("Draft created.");
      await load();
    } catch (draftError) {
      setError(draftError instanceof Error ? draftError.message : "Failed to create draft");
    }
  };

  const validate = async () => {
    if (!details?.id) {
      return;
    }
    try {
      const response = await apiClient.experiments.validate(details.id);
      setMessage(response.valid ? `Validation passed${response.warnings.length ? `: ${response.warnings.join(" | ")}` : "."}` : `Validation failed: ${response.errors.join(" | ")}`);
      await load();
    } catch (validationError) {
      setError(validationError instanceof Error ? validationError.message : "Validation failed");
    }
  };

  const activate = async () => {
    if (!summary) {
      return;
    }
    try {
      await apiClient.experiments.activate(summary.key, summary.draftVersion ?? undefined);
      setMessage("Activated.");
      await load();
    } catch (activateError) {
      setError(activateError instanceof Error ? activateError.message : "Activate failed");
    }
  };

  const pause = async () => {
    try {
      await apiClient.experiments.pause(key);
      setMessage("Paused.");
      await load();
    } catch (pauseError) {
      setError(pauseError instanceof Error ? pauseError.message : "Pause failed");
    }
  };

  const archive = async () => {
    const confirmed = window.confirm("Archive this experiment?");
    if (!confirmed) {
      return;
    }
    try {
      await apiClient.experiments.archive(key);
      setMessage("Archived.");
      await load();
    } catch (archiveError) {
      setError(archiveError instanceof Error ? archiveError.message : "Archive failed");
    }
  };

  const runPreview = async () => {
    try {
      const context = JSON.parse(previewContextText) as Record<string, unknown>;
      const response = await apiClient.experiments.preview(key, {
        ...(previewIdentityType === "profileId" ? { profileId: previewIdentityValue } : {}),
        ...(previewIdentityType === "anonymousId" ? { anonymousId: previewIdentityValue } : {}),
        ...(previewIdentityType === "lookup" ? { lookup: { attribute: previewLookupAttribute, value: previewIdentityValue } } : {}),
        context,
        version: details?.version
      });
      setPreviewResult(response.preview as unknown as Record<string, unknown>);
      setMessage(`Preview variant=${String(response.preview.assignment.variantId)} holdout=${String(response.preview.assignment.isHoldout)}`);
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : "Preview failed");
    }
  };

  return (
    <div className="space-y-4">
      <header className="rounded-lg border border-stone-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-xl font-semibold">{summary?.name ?? key}</h2>
            <p className="text-sm text-stone-600">Key: <span className="font-mono">{key}</span></p>
            <div className="mt-1 flex flex-wrap gap-1 text-xs">
              <span className="rounded border border-stone-300 px-1">{summary?.status ?? "-"}</span>
              {summary?.draftVersion ? <span className="rounded border border-indigo-200 bg-indigo-50 px-1 text-indigo-700">Has draft</span> : null}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link className="rounded border border-stone-300 px-3 py-2 text-sm" href="/engage/experiments">Back to inventory</Link>
            {canWrite ? <Link className="rounded border border-stone-300 px-3 py-2 text-sm" href={`/engage/experiments/${encodeURIComponent(key)}/edit`}>Edit draft</Link> : null}
          </div>
        </div>
      </header>

      {error ? <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}
      {message ? <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</div> : null}

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-3">
          <article className="rounded-lg border border-stone-200 bg-white p-4">
            <h3 className="font-semibold">Summary</h3>
            <div className="mt-2 grid gap-3 md:grid-cols-2 text-sm">
              <div>
                <p><strong>Scope:</strong> app {summary?.appKey ?? "-"}</p>
                <p><strong>Placements:</strong> {summary?.placements.join(", ") || "-"}</p>
                <p><strong>Channels:</strong> {summary?.channels.join(", ") || "-"}</p>
              </div>
              <div>
                <p><strong>Population:</strong> audiences {Array.isArray(parsedSpec?.eligibility.audiencesAny) ? parsedSpec?.eligibility.audiencesAny.length : 0}</p>
                <p><strong>Conditions:</strong> {Array.isArray(parsedSpec?.eligibility.attributes) ? parsedSpec?.eligibility.attributes.length : 0}</p>
                <p><strong>Assignment:</strong> {typeof parsedSpec?.assignment.unit === "string" ? parsedSpec.assignment.unit : "-"}</p>
                <p><strong>Stickiness:</strong> {typeof parsedSpec?.stickiness.mode === "string" ? parsedSpec.stickiness.mode : "ttl"}</p>
              </div>
              <div>
                <p><strong>Variants:</strong> {summary?.variantsSummary ?? "-"}</p>
                <p><strong>Holdout:</strong> {summary?.holdoutPct ?? 0}%</p>
              </div>
              <div>
                <p><strong>Schedule:</strong> {summary?.startAt ? new Date(summary.startAt).toLocaleString() : "-"} → {summary?.endAt ? new Date(summary.endAt).toLocaleString() : "-"}</p>
                <p><strong>Updated:</strong> {summary?.updatedAt ? new Date(summary.updatedAt).toLocaleString() : "-"}</p>
              </div>
            </div>
          </article>

          <article className="rounded-lg border border-stone-200 bg-white p-4">
            <h3 className="font-semibold">Versions</h3>
            <div className="mt-2 max-h-64 overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-stone-600">
                    <th className="border-b border-stone-200 px-2 py-2">Version</th>
                    <th className="border-b border-stone-200 px-2 py-2">Status</th>
                    <th className="border-b border-stone-200 px-2 py-2">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {summary?.versions.map((version) => (
                    <tr key={version.id}>
                      <td className="border-b border-stone-100 px-2 py-2">v{version.version}</td>
                      <td className="border-b border-stone-100 px-2 py-2">{version.status}</td>
                      <td className="border-b border-stone-100 px-2 py-2">{new Date(version.updatedAt).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>

          <article className="rounded-lg border border-stone-200 bg-white p-4">
            <h3 className="font-semibold">Preview</h3>
            <div className="mt-2 grid gap-3 md:grid-cols-3">
              <label className="text-sm">
                Identity type
                <select className="mt-1 w-full rounded border border-stone-300 px-2 py-1" value={previewIdentityType} onChange={(event) => setPreviewIdentityType(event.target.value as typeof previewIdentityType)}>
                  <option value="profileId">profileId</option>
                  <option value="anonymousId">anonymousId</option>
                  <option value="lookup">lookup</option>
                </select>
              </label>
              {previewIdentityType === "lookup" ? (
                <label className="text-sm">
                  Lookup attribute
                  <input className="mt-1 w-full rounded border border-stone-300 px-2 py-1" value={previewLookupAttribute} onChange={(event) => setPreviewLookupAttribute(event.target.value)} />
                </label>
              ) : null}
              <label className="text-sm">
                Identity value
                <input className="mt-1 w-full rounded border border-stone-300 px-2 py-1" value={previewIdentityValue} onChange={(event) => setPreviewIdentityValue(event.target.value)} />
              </label>
            </div>
            <label className="mt-2 block text-sm">
              Context JSON
              <textarea className="mt-1 h-24 w-full rounded border border-stone-300 px-2 py-1 font-mono text-xs" value={previewContextText} onChange={(event) => setPreviewContextText(event.target.value)} />
            </label>
            <button className="mt-2 rounded border border-indigo-400 px-3 py-2 text-sm text-indigo-700" onClick={() => void runPreview()} disabled={loading}>Run preview</button>
            {previewResult ? <pre className="mt-2 overflow-auto rounded bg-stone-900 p-3 text-xs text-stone-100">{JSON.stringify(previewResult, null, 2)}</pre> : null}
          </article>
        </div>

        <aside className="space-y-3">
          <article className="rounded-lg border border-stone-200 bg-white p-4">
            <h3 className="font-semibold">Actions</h3>
            <div className="mt-2 flex flex-col gap-2">
              {canWrite ? (
                <>
                  <Link className="rounded border border-stone-300 px-3 py-2 text-sm" href={`/engage/experiments/${encodeURIComponent(key)}/edit`}>Edit draft</Link>
                  <button className="rounded border border-stone-300 px-3 py-2 text-sm" onClick={() => void createDraft()} disabled={Boolean(summary?.draftVersion)}>Create draft</button>
                  <button className="rounded border border-stone-300 px-3 py-2 text-sm" onClick={() => void validate()} disabled={!details?.id}>Validate</button>
                </>
              ) : null}
              {canActivate ? <button className="rounded border border-emerald-400 px-3 py-2 text-sm text-emerald-700" onClick={() => void activate()}>Activate</button> : null}
              {canWrite ? <button className="rounded border border-amber-400 px-3 py-2 text-sm text-amber-700" onClick={() => void pause()}>Pause</button> : null}
              {canArchive ? <button className="rounded border border-rose-400 px-3 py-2 text-sm text-rose-700" onClick={() => void archive()}>Archive</button> : null}
              {canPromote ? <Link className="rounded border border-stone-300 px-3 py-2 text-sm" href={`/releases?type=experiment&key=${encodeURIComponent(key)}`}>Promote</Link> : null}
            </div>
          </article>

          <article className="rounded-lg border border-stone-200 bg-white p-4 text-sm">
            <h3 className="font-semibold">Activity</h3>
            <p className="mt-2 text-xs text-stone-600">No traffic metrics available in this MVP snapshot.</p>
          </article>
        </aside>
      </section>
    </div>
  );
}

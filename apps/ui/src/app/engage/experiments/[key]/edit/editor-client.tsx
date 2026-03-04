"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { ExperimentDetails } from "@decisioning/shared";
import { ConditionBuilder } from "../../../../../components/decision-builder/ConditionBuilder";
import { EditorActionBar } from "../../../../../components/ui/editor-action-bar";
import { DependenciesPanel } from "../../../../../components/registry/DependenciesPanel";
import { RefSelect } from "../../../../../components/registry/RefSelect";
import { StatusBadge } from "../../../../../components/ui/status-badges";
import { fieldRegistry } from "../../../../../components/decision-builder/field-registry";
import { apiClient } from "../../../../../lib/api";
import { useAppEnumSettings } from "../../../../../lib/app-enum-settings";
import { validateExperimentDependencies } from "../../../../../lib/dependencies";
import { usePermissions } from "../../../../../lib/permissions";
import { useRegistry } from "../../../../../lib/registry";
import {
  applyWeightPreset,
  createEmptyExperimentForm,
  experimentJsonToForm,
  formToExperimentJson,
  fromDateTimeLocalInput,
  getWeightsSum,
  hasAdvancedOnlyFields,
  normalizeWeights,
  toDateTimeLocalInput,
  type ExperimentDraftForm
} from "../../../../engagement/inapp/experiments/builder-utils";

type TabId = "builder" | "advanced" | "preview";
type StepId = "basics" | "scope" | "population" | "variants" | "holdout" | "schedule" | "review";

const STEPS: Array<{ id: StepId; title: string }> = [
  { id: "basics", title: "1) Basics" },
  { id: "scope", title: "2) Scope" },
  { id: "population", title: "3) Population" },
  { id: "variants", title: "4) Variants" },
  { id: "holdout", title: "5) Holdout & Stickiness" },
  { id: "schedule", title: "6) Schedule" },
  { id: "review", title: "7) Review & Activate" }
];

const pretty = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const variantLabel = (index: number) => String.fromCharCode(65 + index) || `V${index + 1}`;

export default function ExperimentEditorClient({ experimentKey }: { experimentKey: string }) {
  const { hasPermission } = usePermissions();
  const isCreateMode = experimentKey === "new";

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [details, setDetails] = useState<ExperimentDetails | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("builder");
  const [activeStep, setActiveStep] = useState<StepId>("basics");
  const [form, setForm] = useState<ExperimentDraftForm>(createEmptyExperimentForm());
  const [advancedJsonText, setAdvancedJsonText] = useState("{}\n");
  const [advancedWarning, setAdvancedWarning] = useState<string | null>(null);
  const [validation, setValidation] = useState<{ valid: boolean; errors: string[]; warnings: string[] } | null>(null);
  const [lastStepErrors, setLastStepErrors] = useState<Record<string, string>>({});

  const [previewIdentityType, setPreviewIdentityType] = useState<"profileId" | "anonymousId" | "lookup">("profileId");
  const [previewIdentityValue, setPreviewIdentityValue] = useState("preview_profile");
  const [previewLookupAttribute, setPreviewLookupAttribute] = useState("email");
  const [previewContextText, setPreviewContextText] = useState('{"locale":"en-US"}');
  const [previewResult, setPreviewResult] = useState<Record<string, unknown> | null>(null);
  const [previewRan, setPreviewRan] = useState(false);

  const weightSum = useMemo(() => getWeightsSum(form.variants), [form.variants]);
  const canWrite = hasPermission("experiment.write");
  const canActivatePermission = hasPermission("experiment.activate");
  const canArchive = hasPermission("experiment.archive");
  const registry = useRegistry();
  const { settings: enumSettings } = useAppEnumSettings(form.scope.appKey || undefined);

  const load = async () => {
    setLoading(true);
    try {
      if (!isCreateMode) {
        const response = await apiClient.experiments.getByKey(experimentKey);
        setDetails(response.item);
        const mapped = experimentJsonToForm(response.item.experimentJson);
        setForm({
          ...mapped,
          name: response.item.name,
          description: response.item.description ?? "",
          status: response.item.status,
          schedule: {
            startAt: mapped.schedule.startAt ?? response.item.startAt ?? undefined,
            endAt: mapped.schedule.endAt ?? response.item.endAt ?? undefined
          }
        });
        setAdvancedJsonText(pretty(response.item.experimentJson));
      } else {
        const empty = createEmptyExperimentForm();
        setForm(empty);
        setAdvancedJsonText(pretty(formToExperimentJson(empty)));
      }
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load editor");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [experimentKey]);

  const validateStepLight = (step: StepId): Record<string, string> => {
    const errors: Record<string, string> = {};
    if (step === "basics") {
      if (!form.key.trim()) errors.key = "Key is required";
      if (!form.name.trim()) errors.name = "Name is required";
    }
    if (step === "scope" && form.scope.channels.includes("inapp") && form.scope.placements.length === 0) {
      errors.placements = "At least one placement is required";
    }
    if (step === "variants") {
      if (form.variants.length < 2) {
        errors.variants = "At least 2 variants are required";
      }
      if (weightSum !== 100) {
        errors.weights = "Weights must sum to 100";
      }
      form.variants.forEach((variant, index) => {
        if (!variant.treatment.contentRef.key.trim()) {
          errors[`variant.${index}.content`] = "Content block required";
        }
      });
    }
    return errors;
  };

  const nextStep = () => {
    const errors = validateStepLight(activeStep);
    setLastStepErrors(errors);
    if (Object.keys(errors).length > 0) {
      return;
    }
    const index = STEPS.findIndex((step) => step.id === activeStep);
    const next = STEPS[index + 1];
    if (next) setActiveStep(next.id);
  };

  const prevStep = () => {
    const index = STEPS.findIndex((step) => step.id === activeStep);
    const previous = STEPS[index - 1];
    if (previous) setActiveStep(previous.id);
  };

  const syncFormToAdvanced = () => {
    setAdvancedJsonText(pretty(formToExperimentJson(form)));
  };

  const syncAdvancedToForm = (): boolean => {
    try {
      const parsed = JSON.parse(advancedJsonText);
      const mapped = experimentJsonToForm(parsed);
      setForm((current) => ({
        ...mapped,
        name: current.name,
        description: current.description,
        status: current.status
      }));
      if (hasAdvancedOnlyFields(mapped.advancedExtras)) {
        setAdvancedWarning("This experiment contains advanced-only fields; they will be preserved but not editable in Builder.");
      } else {
        setAdvancedWarning(null);
      }
      return true;
    } catch (parseError) {
      setAdvancedWarning(parseError instanceof Error ? parseError.message : "Invalid JSON");
      return false;
    }
  };

  const changeTab = (tab: TabId) => {
    if (tab === activeTab) return;
    if (tab === "advanced") {
      const ok = window.confirm("Generate JSON from current Builder state?");
      if (!ok) return;
      syncFormToAdvanced();
    }
    if (activeTab === "advanced" && tab !== "advanced") {
      const ok = window.confirm("Apply Advanced JSON back into Builder?");
      if (!ok) return;
      if (!syncAdvancedToForm()) return;
    }
    setActiveTab(tab);
  };

  const persist = async (): Promise<ExperimentDetails | null> => {
    const experimentJson = activeTab === "advanced" ? JSON.parse(advancedJsonText) : formToExperimentJson(form);
    if (isCreateMode) {
      const response = await apiClient.experiments.create({
        key: form.key.trim(),
        name: form.name.trim(),
        description: form.description?.trim() || undefined,
        experimentJson,
        startAt: form.schedule.startAt ?? null,
        endAt: form.schedule.endAt ?? null
      });
      setDetails(response.item);
      setValidation(response.validation ?? null);
      return response.item;
    }
    if (!details?.id) {
      return null;
    }
    const response = await apiClient.experiments.update(details.id, {
      name: form.name.trim(),
      description: form.description?.trim() || null,
      experimentJson,
      startAt: form.schedule.startAt ?? null,
      endAt: form.schedule.endAt ?? null
    });
    setDetails(response.item);
    setValidation(response.validation ?? null);
    return response.item;
  };

  const save = async () => {
    setSaving(true);
    try {
      const item = await persist();
      setMessage(item ? "Saved." : "Nothing to save.");
      setError(null);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const validate = async () => {
    setSaving(true);
    try {
      const item = await persist();
      if (!item?.id) return;
      const result = await apiClient.experiments.validate(item.id);
      setValidation(result);
      setMessage(result.valid ? "Validation passed." : `Validation failed: ${result.errors.join(" | ")}`);
    } catch (validationError) {
      setError(validationError instanceof Error ? validationError.message : "Validation failed");
    } finally {
      setSaving(false);
    }
  };

  const canActivate = Boolean(canActivatePermission && details?.key && validation?.valid && weightSum === 100 && previewRan);
  const activateDisabledReason = !canActivatePermission
    ? "Insufficient permission."
    : !validation
      ? "Run Validate before activating."
      : !validation.valid
        ? "Validation must pass before activation."
        : weightSum !== 100
          ? "Weights must sum to 100."
          : !previewRan
            ? "Run at least one preview first."
            : undefined;

  const activate = async () => {
    if (!details?.key) return;
    try {
      await apiClient.experiments.activate(details.key, details.version);
      setMessage("Activated.");
      await load();
    } catch (activateError) {
      setError(activateError instanceof Error ? activateError.message : "Activate failed");
    }
  };

  const pause = async () => {
    if (!details?.key) return;
    try {
      await apiClient.experiments.pause(details.key);
      setMessage("Paused.");
      await load();
    } catch (pauseError) {
      setError(pauseError instanceof Error ? pauseError.message : "Pause failed");
    }
  };

  const archive = async () => {
    if (!details?.key) return;
    const confirmed = window.confirm("Archive this experiment?");
    if (!confirmed) return;
    try {
      await apiClient.experiments.archive(details.key);
      setMessage("Archived.");
      await load();
    } catch (archiveError) {
      setError(archiveError instanceof Error ? archiveError.message : "Archive failed");
    }
  };

  const runPreview = async () => {
    const key = details?.key || form.key.trim();
    if (!key) {
      setError("Save experiment before preview");
      return;
    }
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
      setPreviewRan(true);
      setMessage(`Preview variant=${String(response.preview.assignment.variantId)} holdout=${String(response.preview.assignment.isHoldout)}`);
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : "Preview failed");
    }
  };

  const containsAdvancedOnlyFields = hasAdvancedOnlyFields(form.advancedExtras);
  const dependencyItems = useMemo(() => validateExperimentDependencies(registry, formToExperimentJson(form)), [registry, form]);

  return (
    <div className="space-y-4">
      <header className="rounded-lg border border-stone-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-xl font-semibold">Experiment Editor</h2>
            <p className="text-sm text-stone-600">Focused builder for {isCreateMode ? "new experiment" : details?.key ?? experimentKey}.</p>
          </div>
          <div className="flex gap-2">
            <StatusBadge status={(details?.status ?? "DRAFT") as "DRAFT" | "ACTIVE" | "PAUSED" | "ARCHIVED"} />
            <Link className="rounded border border-stone-300 px-3 py-2 text-sm" href={isCreateMode ? "/engage/experiments" : `/engage/experiments/${encodeURIComponent(details?.key ?? experimentKey)}`}>
              Back to details
            </Link>
          </div>
        </div>
      </header>

      {error ? <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}
      {message ? <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</div> : null}
      {advancedWarning ? <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">{advancedWarning}</div> : null}
      {containsAdvancedOnlyFields ? <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">This experiment contains advanced-only fields; they will be preserved but not editable in Builder.</div> : null}

      <section className="rounded-lg border border-stone-200 bg-white p-3">
        <div className="flex items-center justify-between">
          <div className="flex gap-2">
            {(["builder", "advanced", "preview"] as const).map((tab) => (
              <button key={tab} className={`rounded border px-3 py-1 text-sm ${activeTab === tab ? "border-stone-700 bg-stone-100" : "border-stone-300"}`} onClick={() => changeTab(tab)}>{tab === "advanced" ? "Advanced JSON" : tab.charAt(0).toUpperCase() + tab.slice(1)}</button>
            ))}
          </div>

          <EditorActionBar
            statusLabel={details?.status ?? form.status ?? "DRAFT"}
            canSave={canWrite}
            canValidate={canWrite}
            showActivate={canActivatePermission}
            canActivate={canActivate}
            activateDisabledReason={activateDisabledReason}
            isSaving={saving}
            onSave={() => void save()}
            onValidate={() => void validate()}
            onActivate={() => void activate()}
            moreActions={[
              { key: "pause", label: "Pause", onClick: () => void pause(), hidden: !canWrite },
              { key: "archive", label: "Archive", onClick: () => void archive(), hidden: !canArchive, danger: true },
              { key: "export", label: "Export JSON", onClick: () => void navigator.clipboard.writeText(advancedJsonText) }
            ]}
          />
        </div>
      </section>

      {activeTab === "builder" ? (
        <section className="grid gap-4 xl:grid-cols-[220px_minmax(0,1fr)]">
          <aside className="rounded-lg border border-stone-200 bg-white p-3">
            <nav className="space-y-1">
              {STEPS.map((step) => (
                <button key={step.id} className={`w-full rounded px-2 py-2 text-left text-sm ${activeStep === step.id ? "bg-stone-200" : "hover:bg-stone-100"}`} onClick={() => setActiveStep(step.id)}>{step.title}</button>
              ))}
            </nav>
          </aside>

          <main className="space-y-3 rounded-lg border border-stone-200 bg-white p-4">
            {activeStep === "basics" ? (
              <div className="grid gap-3 md:grid-cols-2">
                <label className="text-sm">Key<input className="mt-1 w-full rounded border border-stone-300 px-2 py-1" value={form.key} onChange={(event) => setForm((current) => ({ ...current, key: event.target.value }))} /></label>
                <label className="text-sm">Name<input className="mt-1 w-full rounded border border-stone-300 px-2 py-1" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} /></label>
                <label className="text-sm md:col-span-2">Description<textarea className="mt-1 min-h-20 w-full rounded border border-stone-300 px-2 py-1" value={form.description ?? ""} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} /></label>
                <label className="text-sm md:col-span-2">Status<input className="mt-1 w-full rounded border border-stone-200 bg-stone-50 px-2 py-1" readOnly value={form.status ?? "DRAFT"} /></label>
                {lastStepErrors.key ? <p className="text-xs text-rose-700">{lastStepErrors.key}</p> : null}
                {lastStepErrors.name ? <p className="text-xs text-rose-700">{lastStepErrors.name}</p> : null}
              </div>
            ) : null}

            {activeStep === "scope" ? (
              <div className="space-y-3">
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="text-sm">App Key
                    <select className="mt-1 w-full rounded border border-stone-300 px-2 py-1" value={form.scope.appKey} onChange={(event) => setForm((current) => ({ ...current, scope: { ...current.scope, appKey: event.target.value } }))}>
                      <option value="">Select app</option>
                      {registry.list("app").map((app) => <option key={app.key} value={app.key}>{app.name} ({app.key})</option>)}
                    </select>
                  </label>
                  <div className="text-sm">Channels
                    <div className="mt-1 flex gap-3">
                      {enumSettings.channels.map((channel) => (
                        <label key={channel} className="flex items-center gap-1"><input type="checkbox" checked={form.scope.channels.includes(channel)} onChange={(event) => setForm((current) => ({ ...current, scope: { ...current.scope, channels: event.target.checked ? [...new Set([...current.scope.channels, channel])] : current.scope.channels.filter((entry) => entry !== channel) } }))} />{channel}</label>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="max-h-48 overflow-auto rounded border border-stone-200 p-2">
                  {registry.list("placement").map((placement) => (
                    <label key={placement.key} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.scope.placements.includes(placement.key)} onChange={(event) => setForm((current) => ({ ...current, scope: { ...current.scope, placements: event.target.checked ? [...new Set([...current.scope.placements, placement.key])] : current.scope.placements.filter((entry) => entry !== placement.key) } }))} />{placement.name} ({placement.key})</label>
                  ))}
                </div>
                {lastStepErrors.placements ? <p className="text-xs text-rose-700">{lastStepErrors.placements}</p> : null}
              </div>
            ) : null}

            {activeStep === "population" ? (
              <div className="space-y-3">
                <label className="block text-sm">Audiences (comma separated)
                  <input className="mt-1 w-full rounded border border-stone-300 px-2 py-1" value={form.population.audiencesAny.join(", ")} onChange={(event) => setForm((current) => ({ ...current, population: { ...current.population, audiencesAny: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) } }))} />
                </label>
                <ConditionBuilder title="Eligibility conditions" rows={form.population.attributes} onChange={(rows) => setForm((current) => ({ ...current, population: { ...current.population, attributes: rows } }))} registry={fieldRegistry} pathPrefix="population.attributes" />
              </div>
            ) : null}

            {activeStep === "variants" ? (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  <button className="rounded border border-stone-300 px-2 py-1 text-xs" onClick={() => setForm((current) => ({ ...current, variants: applyWeightPreset("ab_50_50") }))}>A/B 50/50</button>
                  <button className="rounded border border-stone-300 px-2 py-1 text-xs" onClick={() => setForm((current) => ({ ...current, variants: applyWeightPreset("abc_33") }))}>A/B/C 33/33/33</button>
                  <button className="rounded border border-stone-300 px-2 py-1 text-xs" onClick={() => setForm((current) => ({ ...current, variants: applyWeightPreset("80_20") }))}>80/20</button>
                  <button className="rounded border border-stone-300 px-2 py-1 text-xs" onClick={() => setForm((current) => ({ ...current, variants: normalizeWeights(current.variants) }))}>Normalize</button>
                </div>
                <p className={`text-sm ${weightSum === 100 ? "text-emerald-700" : "text-rose-700"}`}>Weights sum: {weightSum}%</p>
                {form.variants.map((variant, index) => (
                  <article key={`${variant.id}-${index}`} className="space-y-2 rounded border border-stone-200 p-3">
                    <div className="grid gap-3 md:grid-cols-2">
                      <label className="text-sm">ID<input className="mt-1 w-full rounded border border-stone-300 px-2 py-1" value={variant.id} onChange={(event) => setForm((current) => ({ ...current, variants: current.variants.map((entry, entryIndex) => entryIndex === index ? { ...entry, id: event.target.value } : entry) }))} /></label>
                      <label className="text-sm">Weight<input type="number" className="mt-1 w-full rounded border border-stone-300 px-2 py-1" value={variant.weight} onChange={(event) => setForm((current) => ({ ...current, variants: current.variants.map((entry, entryIndex) => entryIndex === index ? { ...entry, weight: Number(event.target.value) || 0 } : entry) }))} /></label>
                    </div>
                    <label className="block text-sm">Content block
                      <RefSelect
                        type="content"
                        value={variant.treatment.contentRef}
                        onChange={(nextRef) =>
                          setForm((current) => ({
                            ...current,
                            variants: current.variants.map((entry, entryIndex) =>
                              entryIndex === index
                                ? { ...entry, treatment: { ...entry.treatment, contentRef: nextRef ?? { type: "content", key: "" } } }
                                : entry
                            )
                          }))
                        }
                        filter={{ status: "ACTIVE" }}
                        allowVersionPin
                      />
                    </label>
                    <label className="block text-sm">Offer (optional)
                      <RefSelect
                        type="offer"
                        value={variant.treatment.offerRef ?? null}
                        onChange={(nextRef) =>
                          setForm((current) => ({
                            ...current,
                            variants: current.variants.map((entry, entryIndex) =>
                              entryIndex === index ? { ...entry, treatment: { ...entry.treatment, offerRef: nextRef ?? undefined } } : entry
                            )
                          }))
                        }
                        filter={{ status: "ACTIVE" }}
                        allowVersionPin
                      />
                    </label>
                    <label className="block text-sm">Tags<input className="mt-1 w-full rounded border border-stone-300 px-2 py-1" value={variant.treatment.tags.join(", ")} onChange={(event) => setForm((current) => ({ ...current, variants: current.variants.map((entry, entryIndex) => entryIndex === index ? { ...entry, treatment: { ...entry.treatment, tags: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) } } : entry) }))} /></label>
                    <div className="flex gap-2">
                      <button className="rounded border border-stone-300 px-2 py-1 text-xs" disabled={form.variants.length <= 2} onClick={() => setForm((current) => ({ ...current, variants: current.variants.filter((_entry, entryIndex) => entryIndex !== index) }))}>Remove variant</button>
                    </div>
                  </article>
                ))}
                <button className="rounded border border-stone-300 px-3 py-1 text-sm" onClick={() => setForm((current) => ({ ...current, variants: [...current.variants, { id: variantLabel(current.variants.length), weight: 0, treatment: { type: "inapp_message", contentRef: { type: "content", key: "" }, tags: [] } }] }))}>Add variant</button>
                {lastStepErrors.weights ? <p className="text-xs text-rose-700">{lastStepErrors.weights}</p> : null}
              </div>
            ) : null}

            {activeStep === "holdout" ? (
              <div className="space-y-3">
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="text-sm">Assignment unit
                    <select className="mt-1 w-full rounded border border-stone-300 px-2 py-1" value={form.assignment.unit} onChange={(event) => setForm((current) => ({ ...current, assignment: { ...current.assignment, unit: event.target.value as ExperimentDraftForm["assignment"]["unit"] } }))}>
                      <option value="profileId">profileId</option>
                      <option value="anonymousId">anonymousId</option>
                      <option value="stitching_id">stitching_id</option>
                    </select>
                  </label>
                  <label className="text-sm">Salt
                    <input className="mt-1 w-full rounded border border-stone-300 px-2 py-1" value={form.assignment.salt} onChange={(event) => setForm((current) => ({ ...current, assignment: { ...current.assignment, salt: event.target.value } }))} />
                  </label>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="text-sm">Stickiness
                    <div className="mt-1 flex gap-3">
                      <label className="flex items-center gap-1"><input type="radio" checked={form.assignment.stickinessMode === "static"} onChange={() => setForm((current) => ({ ...current, assignment: { ...current.assignment, stickinessMode: "static" } }))} />static</label>
                      <label className="flex items-center gap-1"><input type="radio" checked={form.assignment.stickinessMode === "ttl"} onChange={() => setForm((current) => ({ ...current, assignment: { ...current.assignment, stickinessMode: "ttl" } }))} />ttl</label>
                    </div>
                  </div>
                  {form.assignment.stickinessMode === "ttl" ? <label className="text-sm">TTL seconds<input type="number" min={1} className="mt-1 w-full rounded border border-stone-300 px-2 py-1" value={form.assignment.ttlSeconds ?? ""} onChange={(event) => setForm((current) => ({ ...current, assignment: { ...current.assignment, ttlSeconds: Number(event.target.value) || undefined } }))} /></label> : null}
                </div>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.holdout.enabled} onChange={(event) => setForm((current) => ({ ...current, holdout: { ...current.holdout, enabled: event.target.checked } }))} />Enable holdout</label>
                <label className="block text-sm">Holdout %
                  <input type="range" min={0} max={100} className="mt-1 w-full" value={form.holdout.percentage} disabled={!form.holdout.enabled} onChange={(event) => setForm((current) => ({ ...current, holdout: { ...current.holdout, percentage: Number(event.target.value) } }))} />
                  <input type="number" min={0} max={100} className="mt-1 w-24 rounded border border-stone-300 px-2 py-1" value={form.holdout.percentage} disabled={!form.holdout.enabled} onChange={(event) => setForm((current) => ({ ...current, holdout: { ...current.holdout, percentage: Number(event.target.value) } }))} />
                </label>
              </div>
            ) : null}

            {activeStep === "schedule" ? (
              <div className="grid gap-3 md:grid-cols-2">
                <label className="text-sm">Start At
                  <input type="datetime-local" className="mt-1 w-full rounded border border-stone-300 px-2 py-1" value={toDateTimeLocalInput(form.schedule.startAt)} onChange={(event) => setForm((current) => ({ ...current, schedule: { ...current.schedule, startAt: fromDateTimeLocalInput(event.target.value) } }))} />
                </label>
                <label className="text-sm">End At
                  <input type="datetime-local" className="mt-1 w-full rounded border border-stone-300 px-2 py-1" value={toDateTimeLocalInput(form.schedule.endAt)} onChange={(event) => setForm((current) => ({ ...current, schedule: { ...current.schedule, endAt: fromDateTimeLocalInput(event.target.value) } }))} />
                </label>
              </div>
            ) : null}

            {activeStep === "review" ? (
              <div className="space-y-2 text-sm">
                <p><strong>Scope:</strong> app {form.scope.appKey || "-"}, placements {form.scope.placements.join(", ") || "-"}, channels {form.scope.channels.join(", ") || "-"}</p>
                <p><strong>Population:</strong> audiences {form.population.audiencesAny.length}, conditions {form.population.attributes.length}</p>
                <p><strong>Variants:</strong> {form.variants.map((variant) => `${variant.id} ${variant.weight}%`).join(" / ")}</p>
                <p><strong>Holdout:</strong> {form.holdout.enabled ? `${form.holdout.percentage}%` : "disabled"}</p>
                <p><strong>Schedule:</strong> {form.schedule.startAt ?? "-"} → {form.schedule.endAt ?? "-"}</p>
                <ul className="list-disc pl-5 text-xs">
                  {form.population.audiencesAny.length === 0 && form.population.attributes.length === 0 ? <li className="text-amber-700">No audiences or conditions: applies to everyone.</li> : null}
                  {weightSum !== 100 ? <li className="text-rose-700">Weights do not sum to 100.</li> : null}
                </ul>
              </div>
            ) : null}

            <div className="flex items-center justify-between">
              <button className="rounded border border-stone-300 px-3 py-2 text-sm" onClick={prevStep} disabled={activeStep === "basics"}>Back</button>
              <button className="rounded border border-stone-300 px-3 py-2 text-sm" onClick={nextStep} disabled={activeStep === "review"}>Next</button>
            </div>
          </main>
          <DependenciesPanel items={dependencyItems} />
        </section>
      ) : null}

      {activeTab === "advanced" ? (
        <section className="rounded-lg border border-stone-200 bg-white p-4 space-y-3">
          <p className="text-xs text-stone-600">Sync occurs on tab switch, Save, and Validate.</p>
          <textarea className="h-[560px] w-full rounded border border-stone-300 px-2 py-1 font-mono text-xs" value={advancedJsonText} onChange={(event) => setAdvancedJsonText(event.target.value)} />
          <div className="flex gap-2">
            <button className="rounded border border-stone-300 px-3 py-2 text-sm" onClick={() => {
              try {
                setAdvancedJsonText(pretty(JSON.parse(advancedJsonText)));
                setAdvancedWarning(null);
              } catch (parseError) {
                setAdvancedWarning(parseError instanceof Error ? parseError.message : "Invalid JSON");
              }
            }}>Format</button>
            <button className="rounded border border-stone-300 px-3 py-2 text-sm" onClick={() => void validate()} disabled={!canWrite || saving}>Validate</button>
            <button className="rounded border border-stone-300 px-3 py-2 text-sm" onClick={() => void save()} disabled={!canWrite || saving}>Save</button>
          </div>
        </section>
      ) : null}

      {activeTab === "preview" ? (
        <section className="rounded-lg border border-stone-200 bg-white p-4 space-y-3">
          <div className="grid gap-3 md:grid-cols-3">
            <label className="text-sm">Identity type
              <select className="mt-1 w-full rounded border border-stone-300 px-2 py-1" value={previewIdentityType} onChange={(event) => setPreviewIdentityType(event.target.value as typeof previewIdentityType)}>
                <option value="profileId">profileId</option>
                <option value="anonymousId">anonymousId</option>
                <option value="lookup">lookup</option>
              </select>
            </label>
            {previewIdentityType === "lookup" ? (
              <label className="text-sm">Lookup attribute
                <select className="mt-1 w-full rounded border border-stone-300 px-2 py-1" value={previewLookupAttribute} onChange={(event) => setPreviewLookupAttribute(event.target.value)}>
                  {enumSettings.lookupAttributes.map((attribute) => (
                    <option key={attribute} value={attribute}>{attribute}</option>
                  ))}
                </select>
              </label>
            ) : null}
            <label className="text-sm">Identity value<input className="mt-1 w-full rounded border border-stone-300 px-2 py-1" value={previewIdentityValue} onChange={(event) => setPreviewIdentityValue(event.target.value)} /></label>
          </div>
          <label className="block text-sm">Context JSON<textarea className="mt-1 h-28 w-full rounded border border-stone-300 px-2 py-1 font-mono text-xs" value={previewContextText} onChange={(event) => setPreviewContextText(event.target.value)} /></label>
          <button className="rounded border border-indigo-400 px-3 py-2 text-sm text-indigo-700" onClick={() => void runPreview()}>Run preview</button>
          {previewResult ? <pre className="overflow-auto rounded bg-stone-900 p-3 text-xs text-stone-100">{JSON.stringify(previewResult, null, 2)}</pre> : null}
        </section>
      ) : null}
    </div>
  );
}

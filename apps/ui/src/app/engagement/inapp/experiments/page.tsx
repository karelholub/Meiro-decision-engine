"use client";

import { useEffect, useMemo, useState } from "react";
import type { CatalogContentBlock, CatalogOffer, ExperimentDetails, ExperimentVersionSummary, InAppApplication, InAppPlacement } from "@decisioning/shared";
import { ConditionBuilder } from "../../../../components/decision-builder/ConditionBuilder";
import { fieldRegistry } from "../../../../components/decision-builder/field-registry";
import { apiClient } from "../../../../lib/api";
import { getEnvironment, onEnvironmentChange, type UiEnvironment } from "../../../../lib/environment";
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
} from "./builder-utils";

const pretty = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

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

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

const intersects = (left: string[], right: string[]) => left.some((item) => right.includes(item));

const tagsFromSelection = (content: CatalogContentBlock | null, offer: CatalogOffer | null) => [...new Set([...(content?.tags ?? []), ...(offer?.tags ?? [])])];

const variantLabel = (index: number) => String.fromCharCode(65 + index) || `V${index + 1}`;

export default function InAppExperimentsPage() {
  const [environment, setEnvironment] = useState<UiEnvironment>("DEV");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [items, setItems] = useState<ExperimentVersionSummary[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [details, setDetails] = useState<ExperimentDetails | null>(null);

  const [statusFilter, setStatusFilter] = useState<"" | "DRAFT" | "ACTIVE" | "PAUSED" | "ARCHIVED">("");
  const [appKeyFilter, setAppKeyFilter] = useState("");
  const [placementFilter, setPlacementFilter] = useState("");
  const [search, setSearch] = useState("");

  const [activeTab, setActiveTab] = useState<TabId>("builder");
  const [activeStep, setActiveStep] = useState<StepId>("basics");
  const [form, setForm] = useState<ExperimentDraftForm>(createEmptyExperimentForm());
  const [advancedJsonText, setAdvancedJsonText] = useState("{}");
  const [advancedWarning, setAdvancedWarning] = useState<string | null>(null);
  const [validation, setValidation] = useState<{ valid: boolean; errors: string[]; warnings: string[] } | null>(null);
  const [lastStepErrors, setLastStepErrors] = useState<Record<string, string>>({});
  const [previewOverride, setPreviewOverride] = useState(false);

  const [contentBlocks, setContentBlocks] = useState<CatalogContentBlock[]>([]);
  const [offers, setOffers] = useState<CatalogOffer[]>([]);
  const [allContentVersions, setAllContentVersions] = useState<CatalogContentBlock[]>([]);
  const [allOfferVersions, setAllOfferVersions] = useState<CatalogOffer[]>([]);
  const [placements, setPlacements] = useState<InAppPlacement[]>([]);
  const [apps, setApps] = useState<InAppApplication[]>([]);
  const [knownAudiences, setKnownAudiences] = useState<string[]>([]);

  const [audienceInput, setAudienceInput] = useState("");
  const [placementSearch, setPlacementSearch] = useState("");
  const [contentSearchByVariant, setContentSearchByVariant] = useState<Record<number, string>>({});
  const [offerSearchByVariant, setOfferSearchByVariant] = useState<Record<number, string>>({});

  const [previewIdentityType, setPreviewIdentityType] = useState<"profileId" | "anonymousId" | "lookup">("profileId");
  const [previewIdentityValue, setPreviewIdentityValue] = useState("preview_profile");
  const [previewLookupAttribute, setPreviewLookupAttribute] = useState("email");
  const [previewContextText, setPreviewContextText] = useState('{"appKey":"","placement":"","locale":"en-US"}');
  const [previewResult, setPreviewResult] = useState<{
    assignment: { variantId: string | null; isHoldout: boolean; allocationId: string };
    payload: Record<string, unknown> | null;
    treatment: Record<string, unknown> | null;
    tracking: Record<string, unknown>;
  } | null>(null);
  const [previewDebug, setPreviewDebug] = useState<Record<string, unknown> | null>(null);
  const [previewRan, setPreviewRan] = useState(false);

  const contentByKey = useMemo(() => new Map(contentBlocks.map((item) => [item.key, item])), [contentBlocks]);
  const offerByKey = useMemo(() => new Map(offers.map((item) => [item.key, item])), [offers]);

  const contentVersionsByKey = useMemo(() => {
    const grouped = new Map<string, number[]>();
    for (const item of allContentVersions) {
      const list = grouped.get(item.key) ?? [];
      if (!list.includes(item.version)) {
        list.push(item.version);
      }
      grouped.set(item.key, list);
    }
    for (const list of grouped.values()) {
      list.sort((a, b) => b - a);
    }
    return grouped;
  }, [allContentVersions]);

  const offerVersionsByKey = useMemo(() => {
    const grouped = new Map<string, number[]>();
    for (const item of allOfferVersions) {
      const list = grouped.get(item.key) ?? [];
      if (!list.includes(item.version)) {
        list.push(item.version);
      }
      grouped.set(item.key, list);
    }
    for (const list of grouped.values()) {
      list.sort((a, b) => b - a);
    }
    return grouped;
  }, [allOfferVersions]);

  const selectedKey = details?.key ?? form.key;

  const containsAdvancedOnlyFields = useMemo(() => hasAdvancedOnlyFields(form.advancedExtras), [form.advancedExtras]);
  const weightSum = useMemo(() => getWeightsSum(form.variants), [form.variants]);

  const missingCatalogRefs = useMemo(() => {
    const missing: string[] = [];
    for (const variant of form.variants) {
      if (!variant.treatment.contentBlock.key) {
        missing.push(`Variant ${variant.id}: missing content block`);
      } else if (!contentByKey.has(variant.treatment.contentBlock.key)) {
        missing.push(`Variant ${variant.id}: content '${variant.treatment.contentBlock.key}' is not active`);
      }
      const offerKey = variant.treatment.offer?.key;
      if (offerKey && !offerByKey.has(offerKey)) {
        missing.push(`Variant ${variant.id}: offer '${offerKey}' is not active`);
      }
    }
    return missing;
  }, [contentByKey, form.variants, offerByKey]);

  const overlappingWarnings = useMemo(() => {
    const currentPlacements = form.scope.placements;
    if (currentPlacements.length === 0) {
      return [] as string[];
    }
    return items
      .filter((item) => item.status === "ACTIVE" && item.key !== selectedKey)
      .filter((item) => intersects(item.placements, currentPlacements))
      .map((item) => `Overlaps with active experiment '${item.key}' on ${item.placements.filter((placement) => currentPlacements.includes(placement)).join(", ")}`);
  }, [form.scope.placements, items, selectedKey]);

  const loadCatalogData = async () => {
    const [appsResponse, placementsResponse, activeContentResponse, activeOffersResponse, allContentResponse, allOffersResponse, wbsResponse] =
      await Promise.all([
        apiClient.inapp.apps.list(),
        apiClient.inapp.placements.list(),
        apiClient.catalog.content.list({ status: "ACTIVE" }),
        apiClient.catalog.offers.list({ status: "ACTIVE" }),
        apiClient.catalog.content.list(),
        apiClient.catalog.offers.list(),
        apiClient.settings.getWbsMapping()
      ]);

    setApps(appsResponse.items);
    setPlacements(placementsResponse.items);
    setContentBlocks(activeContentResponse.items);
    setOffers(activeOffersResponse.items);
    setAllContentVersions(allContentResponse.items);
    setAllOfferVersions(allOffersResponse.items);
    const audiences = wbsResponse.item?.mappingJson.audienceRules?.map((rule) => rule.audienceKey).filter(Boolean) ?? [];
    setKnownAudiences([...new Set(audiences)]);
  };

  const loadList = async () => {
    const response = await apiClient.experiments.list({
      ...(statusFilter ? { status: statusFilter } : {}),
      ...(appKeyFilter.trim() ? { appKey: appKeyFilter.trim() } : {}),
      ...(placementFilter.trim() ? { placement: placementFilter.trim() } : {}),
      ...(search.trim() ? { q: search.trim() } : {})
    });
    setItems(response.items);
    if (!selectedId && response.items[0]) {
      setSelectedId(response.items[0].id);
    }
  };

  const loadDetails = async (id: string) => {
    if (!id) {
      return;
    }
    const response = await apiClient.experiments.get(id);
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
    setValidation(null);
    setLastStepErrors({});
  };

  useEffect(() => {
    setEnvironment(getEnvironment());
    return onEnvironmentChange(setEnvironment);
  }, []);

  useEffect(() => {
    const run = async () => {
      setLoading(true);
      try {
        await Promise.all([loadList(), loadCatalogData()]);
        setError(null);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Failed to load data");
      } finally {
        setLoading(false);
      }
    };
    void run();
  }, [environment, statusFilter, appKeyFilter, placementFilter, search]);

  useEffect(() => {
    if (!selectedId) {
      return;
    }
    const run = async () => {
      setLoading(true);
      try {
        await loadDetails(selectedId);
        setError(null);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Failed to load experiment");
      } finally {
        setLoading(false);
      }
    };
    void run();
  }, [selectedId, environment]);

  const validateStepLight = (step: StepId): Record<string, string> => {
    const next: Record<string, string> = {};
    if (step === "basics") {
      if (!form.key.trim()) next.key = "Key is required";
      if (!form.name.trim()) next.name = "Name is required";
    }
    if (step === "scope") {
      if (form.scope.channels.includes("inapp") && form.scope.placements.length === 0) {
        next.placements = "At least one placement is required for in-app experiments";
      }
    }
    if (step === "variants") {
      if (form.variants.length < 2) {
        next.variants = "At least 2 variants are required";
      }
      form.variants.forEach((variant, index) => {
        if (!variant.treatment.contentBlock.key.trim()) {
          next[`variants.${index}.content`] = "Content block is required";
        }
      });
      if (weightSum !== 100) {
        next.weightSum = "Weights must sum to 100";
      }
    }
    if (step === "holdout") {
      if (form.holdout.percentage < 0 || form.holdout.percentage > 100) {
        next.holdout = "Holdout must be between 0 and 100";
      }
      if (form.assignment.stickinessMode === "ttl" && (!form.assignment.ttlSeconds || form.assignment.ttlSeconds <= 0)) {
        next.ttl = "TTL must be a positive number";
      }
    }
    if (step === "schedule" && form.schedule.startAt && form.schedule.endAt && new Date(form.schedule.startAt) >= new Date(form.schedule.endAt)) {
      next.schedule = "Start time must be before end time";
    }
    return next;
  };

  const goNextStep = () => {
    const nextErrors = validateStepLight(activeStep);
    setLastStepErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }
    const currentIndex = STEPS.findIndex((step) => step.id === activeStep);
    const nextStep = STEPS[currentIndex + 1];
    if (nextStep) {
      setActiveStep(nextStep.id);
    }
  };

  const goBackStep = () => {
    const currentIndex = STEPS.findIndex((step) => step.id === activeStep);
    const previousStep = STEPS[currentIndex - 1];
    if (previousStep) {
      setActiveStep(previousStep.id);
    }
  };

  const syncFormToAdvancedJson = () => {
    const nextJson = formToExperimentJson(form);
    setAdvancedJsonText(pretty(nextJson));
    setAdvancedWarning(null);
  };

  const syncAdvancedJsonToForm = (): boolean => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(advancedJsonText);
      setAdvancedWarning(null);
    } catch (parseError) {
      setAdvancedWarning(parseError instanceof Error ? parseError.message : "Invalid JSON");
      return false;
    }

    const mapped = experimentJsonToForm(parsed);
    setForm((current) => ({
      ...mapped,
      name: current.name,
      description: current.description,
      status: current.status
    }));

    if (hasAdvancedOnlyFields(mapped.advancedExtras)) {
      setAdvancedWarning("This experiment contains advanced-only fields; they will be preserved but not editable in Builder.");
    }

    return true;
  };

  const changeTab = (tab: TabId) => {
    if (tab === activeTab) {
      return;
    }

    if (tab === "advanced" && activeTab !== "advanced") {
      const confirmed = window.confirm("Generate JSON from Builder and open Advanced JSON?");
      if (!confirmed) {
        return;
      }
      syncFormToAdvancedJson();
    }

    if (activeTab === "advanced" && tab !== "advanced") {
      const confirmed = window.confirm("Apply Advanced JSON changes back into Builder state?");
      if (!confirmed) {
        return;
      }
      if (!syncAdvancedJsonToForm()) {
        return;
      }
    }

    setActiveTab(tab);
  };

  const persistDraft = async (): Promise<ExperimentDetails | null> => {
    const payloadJson = activeTab === "advanced" ? (() => {
      try {
        return JSON.parse(advancedJsonText) as Record<string, unknown>;
      } catch (parseError) {
        throw new Error(parseError instanceof Error ? parseError.message : "Invalid JSON");
      }
    })() : formToExperimentJson(form);

    if (!form.key.trim() || !form.name.trim()) {
      throw new Error("key and name are required");
    }

    const basePayload = {
      key: form.key.trim(),
      name: form.name.trim(),
      description: form.description?.trim() || undefined,
      experimentJson: payloadJson,
      startAt: form.schedule.startAt ?? null,
      endAt: form.schedule.endAt ?? null
    };

    if (!selectedId) {
      const response = await apiClient.experiments.create(basePayload);
      setValidation(response.validation ?? null);
      setSelectedId(response.item.id);
      setDetails(response.item);
      return response.item;
    }

    const response = await apiClient.experiments.update(selectedId, {
      name: form.name.trim(),
      description: form.description?.trim() || null,
      experimentJson: payloadJson,
      startAt: form.schedule.startAt ?? null,
      endAt: form.schedule.endAt ?? null
    });
    setValidation(response.validation ?? null);
    setDetails(response.item);
    return response.item;
  };

  const save = async () => {
    setSaving(true);
    try {
      const saved = await persistDraft();
      await loadList();
      if (saved) {
        await loadDetails(saved.id);
      }
      setMessage("Saved draft.");
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
      const saved = await persistDraft();
      if (!saved) {
        return;
      }
      const response = await apiClient.experiments.validate(saved.id);
      setValidation(response);
      if (response.valid) {
        setMessage(response.warnings.length > 0 ? `Validation passed with warnings: ${response.warnings.join(" | ")}` : "Validation passed.");
      } else {
        setMessage(`Validation failed: ${response.errors.join(" | ")}`);
      }
      await loadList();
      await loadDetails(saved.id);
      setError(null);
    } catch (validationError) {
      setError(validationError instanceof Error ? validationError.message : "Validation failed");
    } finally {
      setSaving(false);
    }
  };

  const canActivate = Boolean(
    details?.key &&
      validation?.valid &&
      weightSum === 100 &&
      missingCatalogRefs.length === 0 &&
      (previewRan || previewOverride)
  );

  const activate = async () => {
    if (!details?.key) {
      return;
    }
    try {
      await apiClient.experiments.activate(details.key, details.version);
      setMessage("Activated.");
      await loadList();
      await loadDetails(details.id);
      setError(null);
    } catch (activateError) {
      setError(activateError instanceof Error ? activateError.message : "Activate failed");
    }
  };

  const pause = async () => {
    if (!selectedKey) {
      return;
    }
    try {
      await apiClient.experiments.pause(selectedKey);
      setMessage("Paused.");
      await loadList();
      if (selectedId) {
        await loadDetails(selectedId);
      }
      setError(null);
    } catch (pauseError) {
      setError(pauseError instanceof Error ? pauseError.message : "Pause failed");
    }
  };

  const archive = async () => {
    if (!selectedKey) {
      return;
    }
    try {
      await apiClient.experiments.archive(selectedKey);
      setMessage("Archived.");
      await loadList();
      if (selectedId) {
        await loadDetails(selectedId);
      }
      setError(null);
    } catch (archiveError) {
      setError(archiveError instanceof Error ? archiveError.message : "Archive failed");
    }
  };

  const runPreview = async () => {
    if (!selectedKey) {
      setError("Save the experiment first to run preview.");
      return;
    }

    let context: Record<string, unknown>;
    try {
      const parsed = JSON.parse(previewContextText);
      context = isRecord(parsed) ? parsed : {};
    } catch (parseError) {
      setError(parseError instanceof Error ? parseError.message : "Invalid context JSON");
      return;
    }

    try {
      const response = await apiClient.experiments.preview(selectedKey, {
        ...(previewIdentityType === "profileId" ? { profileId: previewIdentityValue.trim() || "preview_profile" } : {}),
        ...(previewIdentityType === "anonymousId" ? { anonymousId: previewIdentityValue.trim() || "preview_anonymous" } : {}),
        ...(previewIdentityType === "lookup"
          ? {
              lookup: {
                attribute: previewLookupAttribute.trim() || "email",
                value: previewIdentityValue.trim() || "preview@example.com"
              }
            }
          : {}),
        context,
        version: details?.version
      });
      setPreviewResult(response.preview);
      setPreviewDebug(response.debug);
      setPreviewRan(true);
      setError(null);
      setMessage(
        `Preview variant=${String(response.preview.assignment.variantId)} holdout=${String(response.preview.assignment.isHoldout)} allocation=${response.preview.assignment.allocationId}`
      );
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : "Preview failed");
    }
  };

  const startNew = () => {
    setSelectedId("");
    setDetails(null);
    setForm(createEmptyExperimentForm());
    setAdvancedJsonText("{}\n");
    setValidation(null);
    setPreviewResult(null);
    setPreviewDebug(null);
    setPreviewRan(false);
    setActiveTab("builder");
    setActiveStep("basics");
    setError(null);
    setMessage(null);
    setLastStepErrors({});
  };

  const unknownAudienceWarning = audienceInput.trim().length > 0 && !knownAudiences.includes(audienceInput.trim());
  const placementCandidates = placements.filter((placement) => placement.key.toLowerCase().includes(placementSearch.toLowerCase()) || placement.name.toLowerCase().includes(placementSearch.toLowerCase()));

  return (
    <div className="space-y-4">
      <header className="rounded-lg border border-stone-200 bg-white p-4">
        <h2 className="text-xl font-semibold">Engagement / In-App / Experiments</h2>
        <p className="text-sm text-stone-600">Form-first experiment builder with synced advanced JSON and preview.</p>
      </header>

      {error ? <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}
      {message ? <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</div> : null}
      {advancedWarning ? <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">{advancedWarning}</div> : null}
      {containsAdvancedOnlyFields ? (
        <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
          This experiment contains advanced-only fields; they will be preserved but not editable in Builder.
        </div>
      ) : null}

      <section className="grid gap-3 rounded-lg border border-stone-200 bg-white p-4 md:grid-cols-5">
        <label className="text-sm">
          Status
          <select className="mt-1 w-full rounded border border-stone-300 px-2 py-1" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}>
            <option value="">All</option>
            <option value="DRAFT">DRAFT</option>
            <option value="ACTIVE">ACTIVE</option>
            <option value="PAUSED">PAUSED</option>
            <option value="ARCHIVED">ARCHIVED</option>
          </select>
        </label>
        <label className="text-sm">
          App Key
          <input className="mt-1 w-full rounded border border-stone-300 px-2 py-1" value={appKeyFilter} onChange={(event) => setAppKeyFilter(event.target.value)} />
        </label>
        <label className="text-sm">
          Placement
          <input className="mt-1 w-full rounded border border-stone-300 px-2 py-1" value={placementFilter} onChange={(event) => setPlacementFilter(event.target.value)} />
        </label>
        <label className="text-sm md:col-span-2">
          Search
          <input className="mt-1 w-full rounded border border-stone-300 px-2 py-1" value={search} onChange={(event) => setSearch(event.target.value)} />
        </label>
      </section>

      <section className="grid gap-4 xl:grid-cols-[420px_minmax(0,1fr)]">
        <div className="rounded-lg border border-stone-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-semibold">Experiments</h3>
            <button className="rounded-md border border-stone-300 px-3 py-1 text-sm" onClick={startNew}>Create Experiment</button>
          </div>
          <div className="max-h-[680px] overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-stone-600">
                  <th className="border-b border-stone-200 px-2 py-2">Key</th>
                  <th className="border-b border-stone-200 px-2 py-2">Status</th>
                  <th className="border-b border-stone-200 px-2 py-2">Placements</th>
                  <th className="border-b border-stone-200 px-2 py-2">Active v</th>
                  <th className="border-b border-stone-200 px-2 py-2">Updated</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr
                    key={item.id}
                    className={`cursor-pointer ${item.id === selectedId ? "bg-stone-100" : "hover:bg-stone-50"}`}
                    onClick={() => setSelectedId(item.id)}
                  >
                    <td className="border-b border-stone-100 px-2 py-2">{item.key}</td>
                    <td className="border-b border-stone-100 px-2 py-2">{item.status}</td>
                    <td className="border-b border-stone-100 px-2 py-2">{item.placements.join(", ") || "-"}</td>
                    <td className="border-b border-stone-100 px-2 py-2">v{item.version}</td>
                    <td className="border-b border-stone-100 px-2 py-2">{new Date(item.updatedAt).toLocaleString()}</td>
                  </tr>
                ))}
                {items.length === 0 && !loading ? (
                  <tr>
                    <td colSpan={5} className="px-2 py-4 text-center text-stone-500">No experiments.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-3 rounded-lg border border-stone-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Experiment Editor</h3>
            <div className="flex flex-wrap gap-2">
              <button
                className={`rounded-md border px-3 py-1 text-sm ${activeTab === "builder" ? "border-stone-700 bg-stone-100" : "border-stone-300"}`}
                onClick={() => changeTab("builder")}
              >
                Builder
              </button>
              <button
                className={`rounded-md border px-3 py-1 text-sm ${activeTab === "advanced" ? "border-stone-700 bg-stone-100" : "border-stone-300"}`}
                onClick={() => changeTab("advanced")}
              >
                Advanced JSON
              </button>
              <button
                className={`rounded-md border px-3 py-1 text-sm ${activeTab === "preview" ? "border-stone-700 bg-stone-100" : "border-stone-300"}`}
                onClick={() => changeTab("preview")}
              >
                Preview
              </button>
            </div>
          </div>

          {activeTab === "builder" ? (
            <div className="grid gap-4 xl:grid-cols-[220px_minmax(0,1fr)]">
              <aside className="h-fit rounded-lg border border-stone-200 p-3">
                <h4 className="mb-2 text-sm font-semibold">Steps</h4>
                <nav className="space-y-1">
                  {STEPS.map((step) => (
                    <button
                      key={step.id}
                      type="button"
                      onClick={() => setActiveStep(step.id)}
                      className={`flex w-full items-center justify-between rounded px-2 py-2 text-left text-sm ${activeStep === step.id ? "bg-stone-200" : "hover:bg-stone-100"}`}
                    >
                      <span>{step.title}</span>
                      {Object.keys(validateStepLight(step.id)).length > 0 ? <span className="text-xs text-rose-700">!</span> : null}
                    </button>
                  ))}
                </nav>
              </aside>

              <main className="space-y-3">
                {activeStep === "basics" ? (
                  <section className="space-y-3 rounded-lg border border-stone-200 p-3">
                    <h4 className="font-semibold">Basics</h4>
                    <div className="grid gap-3 md:grid-cols-2">
                      <label className="text-sm">
                        Key
                        <input
                          className="mt-1 w-full rounded border border-stone-300 px-2 py-1"
                          value={form.key}
                          onChange={(event) => setForm((current) => ({ ...current, key: event.target.value }))}
                        />
                        {lastStepErrors.key ? <span className="text-xs text-rose-700">{lastStepErrors.key}</span> : null}
                      </label>
                      <label className="text-sm">
                        Name
                        <input
                          className="mt-1 w-full rounded border border-stone-300 px-2 py-1"
                          value={form.name}
                          onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                        />
                        {lastStepErrors.name ? <span className="text-xs text-rose-700">{lastStepErrors.name}</span> : null}
                      </label>
                      <label className="text-sm md:col-span-2">
                        Description
                        <textarea
                          className="mt-1 min-h-20 w-full rounded border border-stone-300 px-2 py-1"
                          value={form.description ?? ""}
                          onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                        />
                      </label>
                      <label className="text-sm md:col-span-2">
                        Status (read-only)
                        <input className="mt-1 w-full rounded border border-stone-200 bg-stone-50 px-2 py-1" value={form.status ?? "DRAFT"} readOnly />
                      </label>
                    </div>
                  </section>
                ) : null}

                {activeStep === "scope" ? (
                  <section className="space-y-3 rounded-lg border border-stone-200 p-3">
                    <h4 className="font-semibold">Scope</h4>
                    <div className="grid gap-3 md:grid-cols-2">
                      <label className="text-sm">
                        App Key
                        <select
                          className="mt-1 w-full rounded border border-stone-300 px-2 py-1"
                          value={form.scope.appKey}
                          onChange={(event) => setForm((current) => ({ ...current, scope: { ...current.scope, appKey: event.target.value } }))}
                        >
                          <option value="">Select app</option>
                          {apps.map((app) => (
                            <option key={app.id} value={app.key}>{app.name} ({app.key})</option>
                          ))}
                        </select>
                      </label>
                      <div className="text-sm">
                        Channels
                        <div className="mt-2 flex flex-wrap gap-3">
                          {(["inapp", "web", "app"] as const).map((channel) => (
                            <label key={channel} className="flex items-center gap-1 text-sm">
                              <input
                                type="checkbox"
                                checked={form.scope.channels.includes(channel)}
                                onChange={(event) =>
                                  setForm((current) => ({
                                    ...current,
                                    scope: {
                                      ...current.scope,
                                      channels: event.target.checked
                                        ? [...new Set([...current.scope.channels, channel])]
                                        : current.scope.channels.filter((entry) => entry !== channel)
                                    }
                                  }))
                                }
                              />
                              {channel}
                            </label>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="space-y-2 rounded border border-stone-200 p-3">
                      <label className="block text-sm">
                        Placements
                        <input
                          className="mt-1 w-full rounded border border-stone-300 px-2 py-1"
                          value={placementSearch}
                          onChange={(event) => setPlacementSearch(event.target.value)}
                          placeholder="Search placements"
                        />
                      </label>
                      {placements.length === 0 ? <p className="text-xs text-amber-700">No placements found. Configure placements first.</p> : null}
                      <div className="max-h-44 space-y-1 overflow-auto rounded border border-stone-200 p-2">
                        {placementCandidates.map((placement) => (
                          <label key={placement.id} className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={form.scope.placements.includes(placement.key)}
                              onChange={(event) =>
                                setForm((current) => ({
                                  ...current,
                                  scope: {
                                    ...current.scope,
                                    placements: event.target.checked
                                      ? [...new Set([...current.scope.placements, placement.key])]
                                      : current.scope.placements.filter((entry) => entry !== placement.key)
                                  }
                                }))
                              }
                            />
                            <span>{placement.name} ({placement.key})</span>
                          </label>
                        ))}
                      </div>
                      {lastStepErrors.placements ? <p className="text-xs text-rose-700">{lastStepErrors.placements}</p> : null}
                    </div>
                  </section>
                ) : null}

                {activeStep === "population" ? (
                  <section className="space-y-3 rounded-lg border border-stone-200 p-3">
                    <h4 className="font-semibold">Population</h4>
                    <div className="space-y-2 rounded border border-stone-200 p-3">
                      <label className="block text-sm">
                        Audiences
                        <input
                          className="mt-1 w-full rounded border border-stone-300 px-2 py-1"
                          value={audienceInput}
                          list="audience-registry"
                          placeholder="Type audience and press Add"
                          onChange={(event) => setAudienceInput(event.target.value)}
                        />
                        <datalist id="audience-registry">
                          {knownAudiences.map((item) => (
                            <option key={item} value={item} />
                          ))}
                        </datalist>
                      </label>
                      <div className="flex gap-2">
                        <button
                          className="rounded border border-stone-300 px-2 py-1 text-sm"
                          onClick={() => {
                            const next = audienceInput.trim();
                            if (!next) {
                              return;
                            }
                            setForm((current) => ({
                              ...current,
                              population: {
                                ...current.population,
                                audiencesAny: [...new Set([...current.population.audiencesAny, next])]
                              }
                            }));
                            setAudienceInput("");
                          }}
                        >
                          Add audience
                        </button>
                        {unknownAudienceWarning ? <span className="text-xs text-amber-700">Not in registry, manual entry will be used.</span> : null}
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {form.population.audiencesAny.map((audience) => (
                          <button
                            key={audience}
                            className="rounded-full border border-stone-300 px-2 py-1 text-xs"
                            onClick={() =>
                              setForm((current) => ({
                                ...current,
                                population: {
                                  ...current.population,
                                  audiencesAny: current.population.audiencesAny.filter((item) => item !== audience)
                                }
                              }))
                            }
                          >
                            {audience} ×
                          </button>
                        ))}
                      </div>
                    </div>

                    <ConditionBuilder
                      title="Eligibility conditions"
                      rows={form.population.attributes}
                      onChange={(rows) => setForm((current) => ({ ...current, population: { ...current.population, attributes: rows } }))}
                      registry={fieldRegistry}
                      pathPrefix="population.attributes"
                    />
                  </section>
                ) : null}

                {activeStep === "variants" ? (
                  <section className="space-y-3 rounded-lg border border-stone-200 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h4 className="font-semibold">Variants</h4>
                      <div className="flex flex-wrap gap-2">
                        <button className="rounded border border-stone-300 px-2 py-1 text-xs" onClick={() => setForm((current) => ({ ...current, variants: applyWeightPreset("ab_50_50") }))}>A/B 50/50</button>
                        <button className="rounded border border-stone-300 px-2 py-1 text-xs" onClick={() => setForm((current) => ({ ...current, variants: applyWeightPreset("abc_33") }))}>A/B/C 33/33/33</button>
                        <button className="rounded border border-stone-300 px-2 py-1 text-xs" onClick={() => setForm((current) => ({ ...current, variants: applyWeightPreset("80_20") }))}>80/20</button>
                        <button className="rounded border border-stone-300 px-2 py-1 text-xs" onClick={() => setForm((current) => ({ ...current, variants: normalizeWeights(current.variants) }))}>Normalize weights</button>
                      </div>
                    </div>

                    <p className={`text-sm ${weightSum === 100 ? "text-emerald-700" : "text-rose-700"}`}>Weights sum: {weightSum}% {weightSum === 100 ? "✅" : "❌"}</p>
                    {lastStepErrors.weightSum ? <p className="text-xs text-rose-700">{lastStepErrors.weightSum}</p> : null}

                    <div className="space-y-3">
                      {form.variants.map((variant, index) => {
                        const contentSearch = contentSearchByVariant[index] ?? "";
                        const offerSearch = offerSearchByVariant[index] ?? "";
                        const contentCandidates = contentBlocks
                          .filter((item) => item.key.toLowerCase().includes(contentSearch.toLowerCase()) || item.name.toLowerCase().includes(contentSearch.toLowerCase()))
                          .slice(0, 8);
                        const offerCandidates = offers
                          .filter((item) => item.key.toLowerCase().includes(offerSearch.toLowerCase()) || item.name.toLowerCase().includes(offerSearch.toLowerCase()))
                          .slice(0, 8);

                        return (
                          <article key={`${variant.id}-${index}`} className="space-y-2 rounded border border-stone-200 p-3">
                            <div className="flex items-center justify-between">
                              <p className="font-medium">Variant {variant.id || variantLabel(index)}</p>
                              <button
                                className="rounded border border-stone-300 px-2 py-1 text-xs disabled:opacity-50"
                                disabled={form.variants.length <= 2}
                                onClick={() =>
                                  setForm((current) => ({
                                    ...current,
                                    variants: current.variants.filter((_entry, entryIndex) => entryIndex !== index)
                                  }))
                                }
                              >
                                Remove variant
                              </button>
                            </div>

                            <div className="grid gap-3 md:grid-cols-3">
                              <label className="text-sm">
                                Variant ID
                                <input
                                  className="mt-1 w-full rounded border border-stone-300 px-2 py-1"
                                  value={variant.id}
                                  onChange={(event) =>
                                    setForm((current) => ({
                                      ...current,
                                      variants: current.variants.map((entry, entryIndex) =>
                                        entryIndex === index ? { ...entry, id: event.target.value } : entry
                                      )
                                    }))
                                  }
                                />
                              </label>
                              <label className="text-sm">
                                Weight
                                <input
                                  type="number"
                                  min={0}
                                  max={100}
                                  className="mt-1 w-full rounded border border-stone-300 px-2 py-1"
                                  value={variant.weight}
                                  onChange={(event) => {
                                    const parsed = Number(event.target.value);
                                    setForm((current) => ({
                                      ...current,
                                      variants: current.variants.map((entry, entryIndex) =>
                                        entryIndex === index ? { ...entry, weight: Number.isFinite(parsed) ? parsed : 0 } : entry
                                      )
                                    }));
                                  }}
                                />
                              </label>
                            </div>

                            <div className="grid gap-3 lg:grid-cols-2">
                              <div className="space-y-1 rounded border border-stone-200 p-2">
                                <label className="block text-xs font-medium">Content Block (search + select)</label>
                                <input
                                  className="w-full rounded border border-stone-300 px-2 py-1 text-sm"
                                  placeholder="Search content"
                                  value={contentSearch}
                                  onChange={(event) =>
                                    setContentSearchByVariant((current) => ({
                                      ...current,
                                      [index]: event.target.value
                                    }))
                                  }
                                />
                                <div className="max-h-28 space-y-1 overflow-auto">
                                  {contentCandidates.map((candidate) => (
                                    <button
                                      key={candidate.id}
                                      className={`w-full rounded border px-2 py-1 text-left text-xs ${variant.treatment.contentBlock.key === candidate.key ? "border-indigo-500 bg-indigo-50" : "border-stone-300"}`}
                                      onClick={() => {
                                        const activeOffer = variant.treatment.offer?.key ? offerByKey.get(variant.treatment.offer.key) ?? null : null;
                                        setForm((current) => ({
                                          ...current,
                                          variants: current.variants.map((entry, entryIndex) =>
                                            entryIndex === index
                                              ? {
                                                  ...entry,
                                                  treatment: {
                                                    ...entry.treatment,
                                                    contentBlock: { key: candidate.key, version: entry.treatment.contentBlock.version },
                                                    tags: entry.treatment.tags.length > 0 ? entry.treatment.tags : tagsFromSelection(candidate, activeOffer)
                                                  }
                                                }
                                              : entry
                                          )
                                        }));
                                      }}
                                    >
                                      {candidate.name} ({candidate.key}) · ACTIVE v{candidate.version} · {candidate.templateId} · locales {Object.keys(candidate.localesJson ?? {}).join(", ") || "-"}
                                    </button>
                                  ))}
                                </div>
                                <label className="block text-xs">
                                  Pin content version (optional)
                                  <select
                                    className="mt-1 w-full rounded border border-stone-300 px-2 py-1"
                                    value={variant.treatment.contentBlock.version ?? ""}
                                    onChange={(event) => {
                                      const value = event.target.value ? Number(event.target.value) : undefined;
                                      setForm((current) => ({
                                        ...current,
                                        variants: current.variants.map((entry, entryIndex) =>
                                          entryIndex === index
                                            ? {
                                                ...entry,
                                                treatment: {
                                                  ...entry.treatment,
                                                  contentBlock: { ...entry.treatment.contentBlock, ...(value ? { version: value } : {}) }
                                                }
                                              }
                                            : entry
                                        )
                                      }));
                                    }}
                                  >
                                    <option value="">Active version</option>
                                    {(contentVersionsByKey.get(variant.treatment.contentBlock.key) ?? []).map((version) => (
                                      <option key={version} value={version}>v{version}</option>
                                    ))}
                                  </select>
                                </label>
                                {lastStepErrors[`variants.${index}.content`] ? <p className="text-xs text-rose-700">{lastStepErrors[`variants.${index}.content`]}</p> : null}
                              </div>

                              <div className="space-y-1 rounded border border-stone-200 p-2">
                                <label className="block text-xs font-medium">Offer (optional)</label>
                                <input
                                  className="w-full rounded border border-stone-300 px-2 py-1 text-sm"
                                  placeholder="Search offers"
                                  value={offerSearch}
                                  onChange={(event) =>
                                    setOfferSearchByVariant((current) => ({
                                      ...current,
                                      [index]: event.target.value
                                    }))
                                  }
                                />
                                <div className="max-h-28 space-y-1 overflow-auto">
                                  <button
                                    className={`w-full rounded border px-2 py-1 text-left text-xs ${variant.treatment.offer?.key ? "border-stone-300" : "border-indigo-500 bg-indigo-50"}`}
                                    onClick={() =>
                                      setForm((current) => ({
                                        ...current,
                                        variants: current.variants.map((entry, entryIndex) =>
                                          entryIndex === index ? { ...entry, treatment: { ...entry.treatment, offer: undefined } } : entry
                                        )
                                      }))
                                    }
                                  >
                                    None
                                  </button>
                                  {offerCandidates.map((candidate) => (
                                    <button
                                      key={candidate.id}
                                      className={`w-full rounded border px-2 py-1 text-left text-xs ${variant.treatment.offer?.key === candidate.key ? "border-indigo-500 bg-indigo-50" : "border-stone-300"}`}
                                      onClick={() => {
                                        const activeContent = contentByKey.get(variant.treatment.contentBlock.key) ?? null;
                                        setForm((current) => ({
                                          ...current,
                                          variants: current.variants.map((entry, entryIndex) =>
                                            entryIndex === index
                                              ? {
                                                  ...entry,
                                                  treatment: {
                                                    ...entry.treatment,
                                                    offer: { key: candidate.key, version: entry.treatment.offer?.version },
                                                    tags: entry.treatment.tags.length > 0 ? entry.treatment.tags : tagsFromSelection(activeContent, candidate)
                                                  }
                                                }
                                              : entry
                                          )
                                        }));
                                      }}
                                    >
                                      {candidate.name} ({candidate.key}) · ACTIVE v{candidate.version}
                                    </button>
                                  ))}
                                </div>

                                <label className="block text-xs">
                                  Pin offer version (optional)
                                  <select
                                    className="mt-1 w-full rounded border border-stone-300 px-2 py-1"
                                    value={variant.treatment.offer?.version ?? ""}
                                    onChange={(event) => {
                                      const value = event.target.value ? Number(event.target.value) : undefined;
                                      setForm((current) => ({
                                        ...current,
                                        variants: current.variants.map((entry, entryIndex) => {
                                          if (entryIndex !== index || !entry.treatment.offer?.key) {
                                            return entry;
                                          }
                                          return {
                                            ...entry,
                                            treatment: {
                                              ...entry.treatment,
                                              offer: {
                                                key: entry.treatment.offer.key,
                                                ...(value ? { version: value } : {})
                                              }
                                            }
                                          };
                                        })
                                      }));
                                    }}
                                    disabled={!variant.treatment.offer?.key}
                                  >
                                    <option value="">Active version</option>
                                    {(offerVersionsByKey.get(variant.treatment.offer?.key ?? "") ?? []).map((version) => (
                                      <option key={version} value={version}>v{version}</option>
                                    ))}
                                  </select>
                                </label>
                              </div>
                            </div>

                            <label className="block text-sm">
                              Tags (comma-separated)
                              <input
                                className="mt-1 w-full rounded border border-stone-300 px-2 py-1"
                                value={variant.treatment.tags.join(", ")}
                                onChange={(event) =>
                                  setForm((current) => ({
                                    ...current,
                                    variants: current.variants.map((entry, entryIndex) =>
                                      entryIndex === index
                                        ? {
                                            ...entry,
                                            treatment: {
                                              ...entry.treatment,
                                              tags: event.target.value.split(",").map((item) => item.trim()).filter(Boolean)
                                            }
                                          }
                                        : entry
                                    )
                                  }))
                                }
                              />
                            </label>
                          </article>
                        );
                      })}
                    </div>

                    <button
                      className="rounded border border-stone-300 px-3 py-2 text-sm"
                      onClick={() =>
                        setForm((current) => ({
                          ...current,
                          variants: [
                            ...current.variants,
                            {
                              id: variantLabel(current.variants.length),
                              weight: 0,
                              treatment: {
                                type: "inapp_message",
                                contentBlock: { key: "" },
                                tags: []
                              }
                            }
                          ]
                        }))
                      }
                    >
                      Add variant
                    </button>
                    {lastStepErrors.variants ? <p className="text-xs text-rose-700">{lastStepErrors.variants}</p> : null}
                  </section>
                ) : null}

                {activeStep === "holdout" ? (
                  <section className="space-y-3 rounded-lg border border-stone-200 p-3">
                    <h4 className="font-semibold">Holdout & Stickiness</h4>
                    <div className="grid gap-3 md:grid-cols-2">
                      <label className="text-sm">
                        Assignment Unit
                        <select
                          className="mt-1 w-full rounded border border-stone-300 px-2 py-1"
                          value={form.assignment.unit}
                          onChange={(event) => setForm((current) => ({ ...current, assignment: { ...current.assignment, unit: event.target.value as ExperimentDraftForm["assignment"]["unit"] } }))}
                        >
                          <option value="profileId">profileId</option>
                          <option value="anonymousId">anonymousId</option>
                          <option value="stitching_id">stitching_id</option>
                        </select>
                      </label>
                      <label className="text-sm">
                        Salt
                        <div className="mt-1 flex gap-2">
                          <input
                            className="w-full rounded border border-stone-300 px-2 py-1"
                            value={form.assignment.salt}
                            onChange={(event) => setForm((current) => ({ ...current, assignment: { ...current.assignment, salt: event.target.value } }))}
                          />
                          <button
                            className="rounded border border-stone-300 px-2 py-1 text-xs"
                            onClick={() =>
                              setForm((current) => ({
                                ...current,
                                assignment: { ...current.assignment, salt: `${Date.now()}-${Math.random().toString(16).slice(2, 10)}` }
                              }))
                            }
                          >
                            Regenerate
                          </button>
                        </div>
                      </label>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="text-sm">
                        Stickiness
                        <div className="mt-1 flex gap-3">
                          <label className="flex items-center gap-1">
                            <input
                              type="radio"
                              checked={form.assignment.stickinessMode === "static"}
                              onChange={() => setForm((current) => ({ ...current, assignment: { ...current.assignment, stickinessMode: "static" } }))}
                            />
                            static
                          </label>
                          <label className="flex items-center gap-1">
                            <input
                              type="radio"
                              checked={form.assignment.stickinessMode === "ttl"}
                              onChange={() => setForm((current) => ({ ...current, assignment: { ...current.assignment, stickinessMode: "ttl" } }))}
                            />
                            ttl
                          </label>
                        </div>
                      </div>

                      {form.assignment.stickinessMode === "ttl" ? (
                        <label className="text-sm">
                          TTL seconds
                          <input
                            type="number"
                            min={1}
                            className="mt-1 w-full rounded border border-stone-300 px-2 py-1"
                            value={form.assignment.ttlSeconds ?? ""}
                            onChange={(event) => {
                              const parsed = Number(event.target.value);
                              setForm((current) => ({
                                ...current,
                                assignment: { ...current.assignment, ttlSeconds: Number.isFinite(parsed) ? parsed : undefined }
                              }));
                            }}
                          />
                          <div className="mt-1 flex gap-1">
                            <button className="rounded border border-stone-300 px-2 py-1 text-xs" onClick={() => setForm((current) => ({ ...current, assignment: { ...current.assignment, ttlSeconds: 86400 } }))}>1 day</button>
                            <button className="rounded border border-stone-300 px-2 py-1 text-xs" onClick={() => setForm((current) => ({ ...current, assignment: { ...current.assignment, ttlSeconds: 7 * 86400 } }))}>7 days</button>
                            <button className="rounded border border-stone-300 px-2 py-1 text-xs" onClick={() => setForm((current) => ({ ...current, assignment: { ...current.assignment, ttlSeconds: 30 * 86400 } }))}>30 days</button>
                          </div>
                          {lastStepErrors.ttl ? <p className="text-xs text-rose-700">{lastStepErrors.ttl}</p> : null}
                        </label>
                      ) : null}
                    </div>

                    <div className="space-y-2 rounded border border-stone-200 p-3">
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={form.holdout.enabled}
                          onChange={(event) => setForm((current) => ({ ...current, holdout: { ...current.holdout, enabled: event.target.checked } }))}
                        />
                        Enable holdout
                      </label>
                      <label className="text-sm">
                        Holdout percentage
                        <input
                          type="range"
                          min={0}
                          max={100}
                          className="mt-1 w-full"
                          value={form.holdout.percentage}
                          onChange={(event) => setForm((current) => ({ ...current, holdout: { ...current.holdout, percentage: Number(event.target.value) } }))}
                          disabled={!form.holdout.enabled}
                        />
                        <input
                          type="number"
                          min={0}
                          max={100}
                          className="mt-1 w-24 rounded border border-stone-300 px-2 py-1"
                          value={form.holdout.percentage}
                          onChange={(event) => setForm((current) => ({ ...current, holdout: { ...current.holdout, percentage: Number(event.target.value) } }))}
                          disabled={!form.holdout.enabled}
                        />
                        <p className="text-xs text-stone-600">Holdout sees noop to measure incrementality.</p>
                        {lastStepErrors.holdout ? <span className="text-xs text-rose-700">{lastStepErrors.holdout}</span> : null}
                      </label>
                    </div>
                  </section>
                ) : null}

                {activeStep === "schedule" ? (
                  <section className="space-y-3 rounded-lg border border-stone-200 p-3">
                    <h4 className="font-semibold">Schedule</h4>
                    <div className="grid gap-3 md:grid-cols-2">
                      <label className="text-sm">
                        Start At
                        <input
                          type="datetime-local"
                          className="mt-1 w-full rounded border border-stone-300 px-2 py-1"
                          value={toDateTimeLocalInput(form.schedule.startAt)}
                          onChange={(event) => setForm((current) => ({ ...current, schedule: { ...current.schedule, startAt: fromDateTimeLocalInput(event.target.value) } }))}
                        />
                      </label>
                      <label className="text-sm">
                        End At
                        <input
                          type="datetime-local"
                          className="mt-1 w-full rounded border border-stone-300 px-2 py-1"
                          value={toDateTimeLocalInput(form.schedule.endAt)}
                          onChange={(event) => setForm((current) => ({ ...current, schedule: { ...current.schedule, endAt: fromDateTimeLocalInput(event.target.value) } }))}
                        />
                      </label>
                    </div>
                    {lastStepErrors.schedule ? <p className="text-xs text-rose-700">{lastStepErrors.schedule}</p> : null}
                  </section>
                ) : null}

                {activeStep === "review" ? (
                  <section className="space-y-3 rounded-lg border border-stone-200 p-3">
                    <h4 className="font-semibold">Review & Activate</h4>
                    <div className="grid gap-3 md:grid-cols-2">
                      <article className="rounded border border-stone-200 p-2 text-sm">
                        <p><strong>Scope:</strong> app {form.scope.appKey || "-"}, placements {form.scope.placements.join(", ") || "-"}, channels {form.scope.channels.join(", ") || "-"}</p>
                        <p><strong>Population:</strong> audiences {form.population.audiencesAny.length}, conditions {form.population.attributes.length}</p>
                        <p><strong>Assignment:</strong> unit {form.assignment.unit}, {form.assignment.stickinessMode === "ttl" ? `ttl ${form.assignment.ttlSeconds ?? "-"}s` : "static"}</p>
                        <p><strong>Holdout:</strong> {form.holdout.enabled ? `${form.holdout.percentage}%` : "disabled"}</p>
                        <p><strong>Schedule:</strong> {form.schedule.startAt ?? "-"} → {form.schedule.endAt ?? "-"}</p>
                      </article>
                      <article className="rounded border border-stone-200 p-2 text-sm">
                        <p className="font-medium">Variants</p>
                        <ul className="mt-1 space-y-1 text-xs">
                          {form.variants.map((variant) => (
                            <li key={variant.id}>
                              {variant.id}: {variant.weight}% · content {variant.treatment.contentBlock.key || "-"} · offer {variant.treatment.offer?.key || "-"}
                            </li>
                          ))}
                        </ul>
                      </article>
                    </div>

                    <div className="rounded border border-stone-200 p-3 text-sm">
                      <p className="font-medium">Risk flags</p>
                      <ul className="mt-1 list-disc pl-5 text-xs">
                        {form.population.audiencesAny.length === 0 && form.population.attributes.length === 0 ? <li>No audience + no conditions: applies to everyone.</li> : null}
                        {weightSum !== 100 ? <li className="text-rose-700">Weights not equal to 100. Activation blocked.</li> : null}
                        {missingCatalogRefs.map((item) => (
                          <li key={item} className="text-rose-700">{item}. Activation blocked.</li>
                        ))}
                        {overlappingWarnings.map((item) => (
                          <li key={item} className="text-amber-700">{item}</li>
                        ))}
                        {overlappingWarnings.length === 0 && missingCatalogRefs.length === 0 && weightSum === 100 ? <li>No blocking risks detected.</li> : null}
                      </ul>
                    </div>

                    <div className="space-y-2 rounded border border-stone-200 p-3 text-sm">
                      <label className="flex items-center gap-2 text-xs">
                        <input type="checkbox" checked={previewOverride} onChange={(event) => setPreviewOverride(event.target.checked)} />
                        Override preview requirement and allow activation without preview
                      </label>
                      <p className="text-xs">Preview completed: {previewRan ? "yes" : "no"}</p>
                      <p className="text-xs">Validation status: {validation ? (validation.valid ? "passed" : "failed") : "not run"}</p>
                    </div>

                    {validation ? (
                      <div className="rounded border border-stone-200 p-3 text-xs">
                        <p className="font-medium">Validation</p>
                        {validation.errors.length > 0 ? <p className="mt-1 text-rose-700">Errors: {validation.errors.join(" | ")}</p> : <p className="mt-1 text-emerald-700">No errors.</p>}
                        {validation.warnings.length > 0 ? <p className="mt-1 text-amber-700">Warnings: {validation.warnings.join(" | ")}</p> : null}
                      </div>
                    ) : null}
                  </section>
                ) : null}

                <div className="flex items-center justify-between">
                  <button className="rounded border border-stone-300 px-3 py-2 text-sm" onClick={goBackStep} disabled={activeStep === "basics"}>Back</button>
                  <div className="flex flex-wrap gap-2">
                    <button className="rounded border border-stone-300 px-3 py-2 text-sm" onClick={() => void save()} disabled={saving}>Save</button>
                    <button className="rounded border border-stone-300 px-3 py-2 text-sm" onClick={() => void validate()} disabled={saving}>Validate</button>
                    <button className="rounded border border-emerald-400 px-3 py-2 text-sm text-emerald-700 disabled:opacity-50" onClick={() => void activate()} disabled={!canActivate}>Activate</button>
                    <button className="rounded border border-amber-400 px-3 py-2 text-sm text-amber-700" onClick={() => void pause()} disabled={!selectedKey}>Pause</button>
                    <button className="rounded border border-rose-400 px-3 py-2 text-sm text-rose-700" onClick={() => void archive()} disabled={!selectedKey}>Archive</button>
                    <button className="rounded border border-stone-300 px-3 py-2 text-sm" onClick={goNextStep} disabled={activeStep === "review"}>Next</button>
                  </div>
                </div>
              </main>
            </div>
          ) : null}

          {activeTab === "advanced" ? (
            <section className="space-y-3">
              <p className="text-xs text-stone-600">Advanced JSON is synced on tab switches, Save, and Validate.</p>
              <textarea
                className="h-[540px] w-full rounded border border-stone-300 px-2 py-1 font-mono text-xs"
                value={advancedJsonText}
                onChange={(event) => setAdvancedJsonText(event.target.value)}
              />
              <div className="flex flex-wrap gap-2">
                <button
                  className="rounded border border-stone-300 px-3 py-2 text-sm"
                  onClick={() => {
                    try {
                      setAdvancedJsonText(pretty(JSON.parse(advancedJsonText)));
                      setAdvancedWarning(null);
                    } catch (parseError) {
                      setAdvancedWarning(parseError instanceof Error ? parseError.message : "Invalid JSON");
                    }
                  }}
                >
                  Format
                </button>
                <button className="rounded border border-stone-300 px-3 py-2 text-sm" onClick={() => void validate()} disabled={saving}>Validate</button>
                <button className="rounded border border-stone-300 px-3 py-2 text-sm" onClick={() => void save()} disabled={saving}>Save</button>
              </div>
            </section>
          ) : null}

          {activeTab === "preview" ? (
            <section className="space-y-3">
              <p className="text-sm text-stone-700">Run /v1/experiments/:key/preview with identity + context.</p>
              <div className="grid gap-3 md:grid-cols-3">
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

              <label className="block text-sm">
                Context JSON
                <textarea className="mt-1 h-32 w-full rounded border border-stone-300 px-2 py-1 font-mono text-xs" value={previewContextText} onChange={(event) => setPreviewContextText(event.target.value)} />
              </label>

              <button className="rounded border border-indigo-400 px-3 py-2 text-sm text-indigo-700" onClick={() => void runPreview()} disabled={!selectedKey}>Run preview</button>

              {previewResult ? (
                <div className="space-y-3 rounded border border-stone-200 p-3">
                  <p className="text-sm">
                    Assigned variant <strong>{previewResult.assignment.variantId ?? "none"}</strong> · holdout <strong>{String(previewResult.assignment.isHoldout)}</strong> · allocation <strong>{previewResult.assignment.allocationId}</strong>
                  </p>

                  {(() => {
                    const variantId = previewResult.assignment.variantId;
                    const variant = form.variants.find((entry) => entry.id === variantId) ?? null;
                    const content = variant ? contentByKey.get(variant.treatment.contentBlock.key) ?? null : null;
                    const payload = previewResult.payload;
                    if (!content || content.templateId !== "banner_v1" || !payload) {
                      return null;
                    }
                    const title = typeof payload.title === "string" ? payload.title : "Banner title";
                    const body = typeof payload.body === "string" ? payload.body : "Banner body";
                    return (
                      <article className="rounded border border-indigo-200 bg-indigo-50 p-3">
                        <p className="text-xs text-indigo-700">Banner preview ({content.key})</p>
                        <h4 className="text-lg font-semibold text-indigo-900">{title}</h4>
                        <p className="text-sm text-indigo-800">{body}</p>
                      </article>
                    );
                  })()}

                  <pre className="overflow-auto rounded bg-stone-900 p-3 text-xs text-stone-100">{JSON.stringify({ preview: previewResult, debug: previewDebug }, null, 2)}</pre>
                  <button
                    className="rounded border border-stone-300 px-2 py-1 text-xs"
                    onClick={() => {
                      void navigator.clipboard.writeText(JSON.stringify({ preview: previewResult, debug: previewDebug }, null, 2));
                    }}
                  >
                    Copy response JSON
                  </button>
                </div>
              ) : null}
            </section>
          ) : null}
        </div>
      </section>
    </div>
  );
}

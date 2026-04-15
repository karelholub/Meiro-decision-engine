"use client";

import { useEffect, useMemo, useState } from "react";
import type { CatalogOffer } from "@decisioning/shared";
import { apiClient } from "../../../lib/api";
import { getEnvironment, onEnvironmentChange, type UiEnvironment } from "../../../lib/environment";
import { usePermissions } from "../../../lib/permissions";
import { Button } from "../../../components/ui/button";
import { ActivationAssetProfilePanel } from "../../../components/catalog/ActivationAssetProfilePanel";
import { AssetVariantsEditor, CatalogActionBar, OfferEditor, makeVariantEditorRows, serializeVariantRows, type AssetVariantEditorRow } from "../../../components/catalog";
import {
  DEFAULT_OFFER_VALUE,
  deriveDiscountFields,
  fromDatetimeLocal,
  makeOfferEditorSeed,
  mergeDiscountFields,
  readObject,
  safeJsonParse,
  sortVersionsDesc,
  statusLabel,
  toPrettyJson,
  validateDiscountFields,
  type DiscountFields
} from "../../../components/catalog/utils";

type OfferEditorState = ReturnType<typeof makeOfferEditorSeed>;

type GenericPair = { key: string; value: string };

const makeGenericPairs = (valueJsonText: string) => {
  const parsed = safeJsonParse<Record<string, unknown>>(valueJsonText);
  if (!parsed.value) {
    return [{ key: "", value: "" }];
  }
  const pairs = Object.entries(parsed.value).map(([key, value]) => ({ key, value: typeof value === "string" ? value : JSON.stringify(value) }));
  return pairs.length > 0 ? pairs : [{ key: "", value: "" }];
};

const parsePayloadOrThrow = (editor: OfferEditorState) => {
  const valueParsed = safeJsonParse<Record<string, unknown>>(editor.valueJsonText);
  if (!valueParsed.value) {
    throw new Error(`Invalid valueJson: ${valueParsed.error}`);
  }
  const constraintsParsed = safeJsonParse<Record<string, unknown>>(editor.constraintsJsonText);
  if (!constraintsParsed.value) {
    throw new Error(`Invalid constraints: ${constraintsParsed.error}`);
  }

  return {
    key: editor.key.trim(),
    name: editor.name.trim(),
    description: editor.description.trim() || undefined,
    status: editor.status,
    tags: editor.tags,
    type: editor.type,
    valueJson: valueParsed.value,
    constraints: constraintsParsed.value,
    startAt: fromDatetimeLocal(editor.startAt),
    endAt: fromDatetimeLocal(editor.endAt)
  };
};

export default function CatalogOffersPage() {
  const { hasPermission } = usePermissions();
  const [environment, setEnvironment] = useState<UiEnvironment>("DEV");
  const [items, setItems] = useState<CatalogOffer[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editor, setEditor] = useState<OfferEditorState>(() => makeOfferEditorSeed());
  const [createMode, setCreateMode] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [lastValidationValid, setLastValidationValid] = useState<boolean | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [discountFields, setDiscountFields] = useState<DiscountFields>({ code: "", percent: "", minSpend: "", newCustomersOnly: false });
  const [discountErrors, setDiscountErrors] = useState<Partial<Record<"code" | "percent" | "minSpend", string>>>({});
  const [genericPairs, setGenericPairs] = useState<GenericPair[]>([{ key: "", value: "" }]);
  const [variantRows, setVariantRows] = useState<AssetVariantEditorRow[]>(() => makeVariantEditorRows([], DEFAULT_OFFER_VALUE));
  const [previewContext, setPreviewContext] = useState('{\n  "profile": { "first_name": "Alex" }\n}\n');
  const [previewResult, setPreviewResult] = useState<unknown | null>(null);
  const [assetReport, setAssetReport] = useState<Awaited<ReturnType<typeof apiClient.catalog.assets.report>> | null>(null);
  const [changeSummary, setChangeSummary] = useState<{
    readiness: Awaited<ReturnType<typeof apiClient.catalog.assets.readiness>> | null;
    impact: Awaited<ReturnType<typeof apiClient.catalog.assets.impact>> | null;
    archive: Awaited<ReturnType<typeof apiClient.catalog.assets.archivePreview>> | null;
  }>({ readiness: null, impact: null, archive: null });

  const [tagSuggestions, setTagSuggestions] = useState<string[]>([]);
  const [searchText, setSearchText] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | CatalogOffer["status"]>("ALL");

  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false);
  const [archiveConfirmKey, setArchiveConfirmKey] = useState("");

  useEffect(() => {
    setEnvironment(getEnvironment());
    return onEnvironmentChange(setEnvironment);
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const [offers, tags] = await Promise.all([apiClient.catalog.offers.list(), apiClient.catalog.tags()]);
      setItems(offers.items);
      setTagSuggestions(tags.offerTags ?? []);

      if (offers.items.length > 0) {
        const active = selectedId ? offers.items.find((item) => item.id === selectedId) : offers.items[0];
        if (active) {
          const seed = makeOfferEditorSeed(active);
          setEditor(seed);
          setSelectedId(active.id);
          setCreateMode(false);
          setGenericPairs(makeGenericPairs(seed.valueJsonText));
          setVariantRows(makeVariantEditorRows(active.variants, active.valueJson));
        }
      }
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load offers");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [environment]);

  const selectedItem = useMemo(() => items.find((item) => item.id === selectedId) ?? null, [items, selectedId]);

  const versionsForKey = useMemo(() => {
    const key = editor.key.trim();
    if (!key) {
      return [];
    }
    return sortVersionsDesc(items.filter((item) => item.key === key));
  }, [editor.key, items]);

  const statusRibbon = useMemo(() => {
    const active = versionsForKey.find((item) => item.status === "ACTIVE");
    const draft = versionsForKey.find((item) => item.status === "DRAFT");
    const archived = versionsForKey.find((item) => item.status === "ARCHIVED");
    const parts = [
      active ? statusLabel("ACTIVE", active.version) : null,
      draft ? statusLabel("DRAFT", draft.version) : null,
      !active && !draft && archived ? "ARCHIVED" : null
    ].filter((entry): entry is string => Boolean(entry));
    return parts.join(" / ") || statusLabel(editor.status, selectedItem?.version);
  }, [editor.status, selectedItem?.version, versionsForKey]);

  const hasDraftForKey = versionsForKey.some((item) => item.status === "DRAFT");
  const readOnly = editor.status === "ARCHIVED";
  const canActivate = hasPermission("catalog.offer.activate") && !createMode && !readOnly && hasDraftForKey && lastValidationValid === true;

  const valueParse = useMemo(() => safeJsonParse<Record<string, unknown>>(editor.valueJsonText), [editor.valueJsonText]);
  const constraintsParse = useMemo(() => safeJsonParse<Record<string, unknown>>(editor.constraintsJsonText), [editor.constraintsJsonText]);

  useEffect(() => {
    if (!valueParse.value || !constraintsParse.value) {
      return;
    }

    if (editor.type === "discount") {
      const derived = deriveDiscountFields(valueParse.value, constraintsParse.value);
      setDiscountFields(derived.fields);
    } else {
      setGenericPairs(makeGenericPairs(editor.valueJsonText));
    }
  }, [editor.type, editor.valueJsonText, constraintsParse.value, valueParse.value]);

  const filteredItems = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    return items.filter((item) => {
      if (statusFilter !== "ALL" && item.status !== statusFilter) {
        return false;
      }
      if (!query) {
        return true;
      }
      return item.key.toLowerCase().includes(query) || item.name.toLowerCase().includes(query);
    });
  }, [items, searchText, statusFilter]);

  const applyDiscountToJson = (nextFields: DiscountFields) => {
    const valueJson = readObject(valueParse.value);
    const constraints = readObject(constraintsParse.value);
    const merged = mergeDiscountFields(valueJson, constraints, nextFields);
    setEditor((current) => ({
      ...current,
      valueJsonText: toPrettyJson(merged.valueJson),
      constraintsJsonText: toPrettyJson(merged.constraints)
    }));
  };

  const applyGenericPairs = (pairs: GenericPair[]) => {
    setGenericPairs(pairs);
    const currentParsed = readObject(valueParse.value);
    const next: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(currentParsed)) {
      if (!pairs.some((pair) => pair.key === key && pair.key.trim())) {
        next[key] = value;
      }
    }

    for (const pair of pairs) {
      const key = pair.key.trim();
      if (!key) {
        continue;
      }
      const parsedMaybe = safeJsonParse<unknown>(pair.value);
      next[key] = parsedMaybe.value ?? pair.value;
    }

    setEditor((current) => ({ ...current, valueJsonText: toPrettyJson(next) }));
  };

  const save = async () => {
    setSaving(true);
    try {
      const payload = parsePayloadOrThrow(editor);
      const variants = serializeVariantRows(variantRows);

      if (editor.type === "discount") {
        const localErrors = validateDiscountFields(discountFields);
        setDiscountErrors(localErrors);
        if (Object.keys(localErrors).length > 0) {
          throw new Error("Discount fields are invalid");
        }
      }

      if (createMode || !selectedId) {
        const response = await apiClient.catalog.offers.create({ ...payload, variants });
        setSelectedId(response.item.id);
        setCreateMode(false);
        setEditor(makeOfferEditorSeed(response.item));
        setMessage(`Saved offer ${response.item.key} v${response.item.version}`);
      } else {
        const response = await apiClient.catalog.offers.update(selectedId, {
          name: payload.name,
          description: payload.description,
          status: payload.status,
          tags: payload.tags,
          type: payload.type,
          valueJson: payload.valueJson,
          constraints: payload.constraints,
          startAt: payload.startAt,
          endAt: payload.endAt,
          variants
        });
        setEditor(makeOfferEditorSeed(response.item));
        setMessage(`Updated ${response.item.key} v${response.item.version}`);
      }
      setLastValidationValid(null);
      await load();
      setError(null);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const validate = async () => {
    try {
      if (editor.type === "discount") {
        const localErrors = validateDiscountFields(discountFields);
        setDiscountErrors(localErrors);
        if (Object.keys(localErrors).length > 0) {
          setLastValidationValid(false);
          setMessage("Validation failed");
          return;
        }
      }

      const payload = parsePayloadOrThrow(editor);
      const validation = await apiClient.catalog.offers.validate({ ...payload, variants: serializeVariantRows(variantRows) });
      setLastValidationValid(validation.valid);
      setMessage(validation.valid ? "Validation passed" : `Validation failed: ${validation.errors.join(" | ") || "unknown"}`);
      setError(null);
    } catch (validationError) {
      setLastValidationValid(false);
      setError(validationError instanceof Error ? validationError.message : "Validation failed");
    }
  };

  const createNewVersion = async () => {
    setSaving(true);
    try {
      const payload = parsePayloadOrThrow(editor);
      const response = await apiClient.catalog.offers.create({ ...payload, variants: serializeVariantRows(variantRows) });
      setSelectedId(response.item.id);
      setEditor(makeOfferEditorSeed(response.item));
      setCreateMode(false);
      setMessage(`Created new version: ${response.item.key} v${response.item.version}`);
      await load();
      setError(null);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Create version failed");
    } finally {
      setSaving(false);
    }
  };

  const activate = async () => {
    if (!editor.key.trim()) {
      return;
    }
    try {
      const target = items.find((item) => item.id === selectedId);
      const response = await apiClient.catalog.offers.activate(editor.key.trim(), target?.version);
      setMessage(`Activated ${response.item.key} v${response.item.version}`);
      await load();
    } catch (activateError) {
      setError(activateError instanceof Error ? activateError.message : "Activate failed");
    }
  };

  const archive = async () => {
    if (!editor.key.trim()) {
      return;
    }
    try {
      const response = await apiClient.catalog.offers.archive(editor.key.trim());
      setMessage(response.archiveSafety?.warning ? `Archived ${editor.key.trim()}. ${response.archiveSafety.warning}` : `Archived ${editor.key.trim()}`);
      setArchiveConfirmOpen(false);
      setArchiveConfirmKey("");
      await load();
    } catch (archiveError) {
      setError(archiveError instanceof Error ? archiveError.message : "Archive failed");
    }
  };

  const exportJson = () => {
    try {
      const payload = parsePayloadOrThrow(editor);
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${payload.key || "offer"}-v${selectedItem?.version ?? 0}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "Export failed");
    }
  };

  const duplicate = () => {
    const nextKey = `${editor.key}_COPY`;
    setEditor((current) => ({ ...current, key: nextKey, status: "DRAFT", lastSavedAt: null }));
    setCreateMode(true);
    setSelectedId(null);
    setMessage(`Prepared duplicate as ${nextKey}`);
  };

  const runPreview = async () => {
    if (!editor.key.trim()) {
      return;
    }
    try {
      const context = safeJsonParse<Record<string, unknown>>(previewContext);
      if (!context.value) {
        throw new Error(`Invalid preview context: ${context.error}`);
      }
      const response = await apiClient.catalog.offers.preview(editor.key.trim(), {
        locale: "en",
        channel: "inapp",
        placementKey: "home_top",
        context: context.value
      });
      setPreviewResult(response);
      setMessage("Preview generated");
      setError(null);
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : "Preview failed");
    }
  };

  const loadReport = async () => {
    if (!editor.key.trim()) {
      return;
    }
    try {
      const [response, readiness, impact, archive] = await Promise.all([
        apiClient.catalog.assets.report({ type: "offer", key: editor.key.trim() }),
        apiClient.catalog.assets.readiness({ type: "offer", key: editor.key.trim() }),
        apiClient.catalog.assets.impact({ type: "offer", key: editor.key.trim() }),
        apiClient.catalog.assets.archivePreview({ type: "offer", key: editor.key.trim() })
      ]);
      setAssetReport(response);
      setChangeSummary({ readiness, impact, archive });
    } catch (reportError) {
      setError(reportError instanceof Error ? reportError.message : "Report failed");
    }
  };

  return (
    <section className="space-y-4">
      <header className="panel p-4">
        <h2 className="text-xl font-semibold">Catalog / Offers</h2>
        <p className="text-sm text-stone-700">Form-first offer editing with Advanced JSON escape hatch and explicit version lifecycle.</p>
      </header>

      <CatalogActionBar
        status={editor.status}
        versionLabel={statusRibbon}
        environment={environment}
        lastSavedAt={editor.lastSavedAt}
        canSave={hasPermission("catalog.offer.write")}
        canValidate={hasPermission("catalog.offer.write")}
        showActivate={hasPermission("catalog.offer.activate")}
        saving={saving}
        canActivate={canActivate}
        activateDisabledReason={
          readOnly ? "Archived versions are read-only" : !hasDraftForKey ? "No draft version exists" : lastValidationValid !== true ? "Validate first" : undefined
        }
        onSave={() => void save()}
        onValidate={() => void validate()}
        onActivate={() => void activate()}
        onRefresh={() => void load()}
        onCreateVersion={!createMode ? () => void createNewVersion() : null}
        onExportJson={exportJson}
        onDuplicate={duplicate}
      />

      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      {message ? <p className="text-sm text-green-700">{message}</p> : null}
      {loading ? <p className="text-sm text-stone-600">Loading...</p> : null}

      {!createMode && editor.key.trim() ? <ActivationAssetProfilePanel entityType="offer" assetKey={editor.key.trim()} /> : null}

      <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
        <aside className="panel space-y-3 p-3">
          <h3 className="text-sm font-semibold">Versions</h3>
          <div className="space-y-2">
            <input
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              className="w-full rounded-md border border-stone-300 px-2 py-1 text-sm"
              placeholder="Search key or name"
            />
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as "ALL" | CatalogOffer["status"])}
              className="w-full rounded-md border border-stone-300 px-2 py-1 text-sm"
            >
              <option value="ALL">All</option>
              <option value="ACTIVE">Active</option>
              <option value="PENDING_APPROVAL">Pending approval</option>
              <option value="PAUSED">Paused</option>
              <option value="DRAFT">Draft</option>
              <option value="ARCHIVED">Archived</option>
            </select>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                setCreateMode(true);
                setSelectedId(null);
                setEditor(makeOfferEditorSeed());
                setGenericPairs([{ key: "", value: "" }]);
                setVariantRows(makeVariantEditorRows([], DEFAULT_OFFER_VALUE));
                setLastValidationValid(null);
              }}
            >
              New offer
            </Button>
            {versionsForKey.length === 1 && versionsForKey[0]?.status === "ACTIVE" ? (
              <Button variant="outline" className="w-full" onClick={() => void createNewVersion()}>
                Create new draft version
              </Button>
            ) : null}
          </div>

          <div className="space-y-2">
            {filteredItems.map((item) => (
              <button
                key={item.id}
                className={`block w-full rounded-md border px-2 py-2 text-left text-sm ${item.id === selectedId ? "border-ink bg-stone-100" : "border-stone-200"}`}
                onClick={() => {
                  const seed = makeOfferEditorSeed(item);
                  setSelectedId(item.id);
                  setEditor(seed);
                  setCreateMode(false);
                  setGenericPairs(makeGenericPairs(seed.valueJsonText));
                  setVariantRows(makeVariantEditorRows(item.variants, item.valueJson));
                  setLastValidationValid(null);
                }}
              >
                <p className="font-medium">{item.key}</p>
                <p className="text-xs text-stone-600">{statusLabel(item.status, item.version)}</p>
              </button>
            ))}
            {filteredItems.length === 0 ? <p className="text-xs text-stone-600">No offers found.</p> : null}
          </div>
        </aside>

        <OfferEditor
          value={editor}
          onChange={(patch) => {
            setEditor((current) => ({ ...current, ...patch }));
            setLastValidationValid(null);
          }}
          readOnlyKey={!createMode}
          availableTags={tagSuggestions}
          discountFields={discountFields}
          discountErrors={discountErrors}
          genericPairs={genericPairs}
          advancedOnly={
            editor.type === "discount"
              ? !valueParse.value || !constraintsParse.value || deriveDiscountFields(readObject(valueParse.value), readObject(constraintsParse.value)).advancedOnly
              : false
          }
          advancedReasons={
            editor.type === "discount" && valueParse.value && constraintsParse.value
              ? deriveDiscountFields(readObject(valueParse.value), readObject(constraintsParse.value)).reasons
              : []
          }
          onDiscountFieldChange={(patch) => {
            const next = { ...discountFields, ...patch };
            setDiscountFields(next);
            setDiscountErrors((current) => ({ ...current, ...validateDiscountFields(next) }));
            applyDiscountToJson(next);
          }}
          onGenericPairsChange={(pairs) => {
            applyGenericPairs(pairs);
          }}
          showAdvanced={showAdvanced}
          onToggleAdvanced={() => setShowAdvanced((current) => !current)}
        />
      </div>

      <AssetVariantsEditor
        rows={variantRows}
        onChange={(rows) => {
          setVariantRows(rows);
          setLastValidationValid(null);
        }}
        readOnly={readOnly}
        fallbackPayload={readObject(valueParse.value)}
      />

      <section className="panel grid gap-4 p-4 lg:grid-cols-2">
        <div className="space-y-2">
          <h3 className="font-semibold">Preview Resolution</h3>
          <textarea
            value={previewContext}
            onChange={(event) => setPreviewContext(event.target.value)}
            className="min-h-28 w-full rounded-md border border-stone-300 px-2 py-1 font-mono text-xs"
          />
          <Button variant="outline" onClick={() => void runPreview()}>
            Preview en / inapp / home_top
          </Button>
          <pre className="max-h-80 overflow-auto rounded-md bg-stone-950 p-3 text-xs text-stone-50">{JSON.stringify(previewResult, null, 2)}</pre>
        </div>
        <div className="space-y-2">
          <h3 className="font-semibold">Usage & Dependencies</h3>
          <Button variant="outline" onClick={() => void loadReport()}>
            Load usage
          </Button>
          {assetReport ? (
            <div className="space-y-2 text-sm">
              <p className="font-medium">Operational usage, last {assetReport.windowDays} days</p>
              <p>Usage count: {assetReport.usageCount} / In-app impressions: {assetReport.impressions} / Clicks: {assetReport.clicks}</p>
              <p>Decision serves sampled: {assetReport.decisionUsageCount} / Observed events: {assetReport.observedEventCount ?? 0}</p>
              <p>Referenced by decisions: {assetReport.dependencies.decisions.map((item) => `${item.key} v${item.version}`).join(", ") || "-"}</p>
              <p>Referenced by campaigns: {assetReport.dependencies.campaigns.map((item) => item.key).join(", ") || "-"}</p>
              {assetReport.dependencies.archiveSafety?.warning ? <p className="rounded-md border border-red-200 bg-red-50 p-2 text-red-700">{assetReport.dependencies.archiveSafety.warning}</p> : null}
              {(assetReport.warnings ?? []).length > 0 ? <p className="text-stone-600">Report caveats: {assetReport.warnings?.join(", ")}</p> : null}
              {(assetReport.dataCaveats ?? []).length > 0 ? <p className="text-stone-600">{assetReport.dataCaveats?.[0]}</p> : null}
            </div>
          ) : (
            <p className="text-sm text-stone-600">Load usage to see references, engagement counts, and archive risk.</p>
          )}
          {changeSummary.readiness ? (
            <div className="mt-3 space-y-2 rounded-md border border-stone-200 p-3 text-sm">
              <p className="font-medium">Publish readiness: {changeSummary.readiness.readiness.status} / risk {changeSummary.readiness.readiness.riskLevel}</p>
              <p>Impact risk: {changeSummary.impact?.impact.releaseRiskLevel ?? "unknown"} · active refs {Object.values(changeSummary.impact?.impact.activeReferences ?? {}).reduce((sum, value) => sum + value, 0)}</p>
              {changeSummary.impact?.diff.labels.length ? <p>Diff: {changeSummary.impact.diff.labels.slice(0, 3).join(" | ")}</p> : null}
              {changeSummary.readiness.readiness.checks.slice(0, 3).map((check) => (
                <p key={check.code} className={check.severity === "blocking" ? "text-red-700" : "text-stone-700"}>{check.code}: {check.nextAction}</p>
              ))}
            </div>
          ) : null}
        </div>
      </section>

      <section className="panel space-y-3 border-red-300 p-4">
        <h3 className="font-semibold text-red-700">Danger zone</h3>
        <p className="text-sm text-stone-700">Archive key permanently hides all versions of this offer key from active use.</p>
        {assetReport?.dependencies.archiveSafety?.warning ? <p className="text-sm font-medium text-red-700">{assetReport.dependencies.archiveSafety.warning}</p> : null}
        {!archiveConfirmOpen ? (
          <Button variant="danger" onClick={() => setArchiveConfirmOpen(true)}>
            Archive key
          </Button>
        ) : (
          <div className="space-y-2">
            <p className="text-sm">Type <span className="font-mono">{editor.key.trim()}</span> to confirm.</p>
            <input
              value={archiveConfirmKey}
              onChange={(event) => setArchiveConfirmKey(event.target.value)}
              className="rounded-md border border-stone-300 px-2 py-1"
            />
            <div className="flex gap-2">
              <Button variant="danger" onClick={() => void archive()} disabled={archiveConfirmKey.trim() !== editor.key.trim() || !editor.key.trim()}>
                Confirm archive
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setArchiveConfirmOpen(false);
                  setArchiveConfirmKey("");
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </section>

      {versionsForKey.length > 0 ? (
        <section className="panel p-4">
          <h3 className="font-semibold">Version history - {editor.key}</h3>
          <ul className="mt-2 space-y-1 text-sm text-stone-700">
            {versionsForKey.map((item) => (
              <li key={item.id}>
                v{item.version} - {item.status} - updated {new Date(item.updatedAt).toLocaleString()}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </section>
  );
}

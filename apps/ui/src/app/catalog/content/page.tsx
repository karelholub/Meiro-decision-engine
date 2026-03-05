"use client";

import { useEffect, useMemo, useState } from "react";
import type { CatalogContentBlock } from "@decisioning/shared";
import { DependenciesPanel } from "../../../components/registry/DependenciesPanel";
import { apiClient } from "../../../lib/api";
import { DEFAULT_APP_ENUM_SETTINGS, useAppEnumSettings } from "../../../lib/app-enum-settings";
import { validateContentDependencies } from "../../../lib/dependencies";
import { getEnvironment, onEnvironmentChange, type UiEnvironment } from "../../../lib/environment";
import { usePermissions } from "../../../lib/permissions";
import { useRegistry } from "../../../lib/registry";
import { Button } from "../../../components/ui/button";
import { CatalogActionBar, ContentBlockEditor, PreviewPane, type TokenBindingRow } from "../../../components/catalog";
import {
  detectBindingDiagnostics,
  makeContentEditorSeed,
  readObject,
  renderLocaleWithBindings,
  safeJsonParse,
  schemaFields,
  schemaForTemplate,
  schemaSupportsLocaleForm,
  sortVersionsDesc,
  statusLabel,
  toPrettyJson
} from "../../../components/catalog/utils";

type ContentEditorState = ReturnType<typeof makeContentEditorSeed>;

const toTokenRows = (tokenBindingsText: string): TokenBindingRow[] => {
  const parsed = safeJsonParse<Record<string, unknown>>(tokenBindingsText);
  if (!parsed.value) {
    return [{ token: "", sourcePath: "" }];
  }
  const rows = Object.entries(parsed.value).map(([token, sourcePath]) => ({ token, sourcePath: typeof sourcePath === "string" ? sourcePath : "" }));
  return rows.length > 0 ? rows : [{ token: "", sourcePath: "" }];
};

const rowsToBindings = (rows: TokenBindingRow[]) => {
  const output: Record<string, unknown> = {};
  for (const row of rows) {
    const token = row.token.trim();
    const sourcePath = row.sourcePath.trim();
    if (!token || !sourcePath) {
      continue;
    }
    output[token] = sourcePath;
  }
  return output;
};

const withPreferredDefaultLocale = (locales: Record<string, unknown>, preferredLocale: string) => {
  if (!preferredLocale.trim()) {
    return locales;
  }
  if (Object.prototype.hasOwnProperty.call(locales, preferredLocale)) {
    return locales;
  }
  const keys = Object.keys(locales);
  if (keys.length !== 1) {
    return locales;
  }
  const onlyKey = keys[0];
  if (!onlyKey) {
    return locales;
  }
  return {
    [preferredLocale]: readObject(locales[onlyKey])
  };
};

const parsePayloadOrThrow = (editor: ContentEditorState) => {
  const schema = safeJsonParse<Record<string, unknown> | null>(editor.schemaJsonText);
  if (schema.value === null && editor.templateId.trim() === "banner_v1") {
    throw new Error("schemaJson cannot be null for banner_v1");
  }
  if (schema.value === null && editor.templateId.trim() !== "banner_v1") {
    // Keep null schema for unknown templates in advanced mode.
  } else if (!schema.value) {
    throw new Error(`Invalid schemaJson: ${schema.error}`);
  }
  const locales = safeJsonParse<Record<string, unknown>>(editor.localesJsonText);
  if (!locales.value) {
    throw new Error(`Invalid localesJson: ${locales.error}`);
  }
  const tokenBindings = safeJsonParse<Record<string, unknown>>(editor.tokenBindingsText);
  if (!tokenBindings.value) {
    throw new Error(`Invalid tokenBindings: ${tokenBindings.error}`);
  }

  return {
    key: editor.key.trim(),
    name: editor.name.trim(),
    description: editor.description.trim() || undefined,
    status: editor.status,
    templateId: editor.templateId.trim(),
    tags: editor.tags,
    schemaJson: schema.value,
    localesJson: locales.value,
    tokenBindings: tokenBindings.value
  };
};

export default function CatalogContentPage() {
  const { hasPermission } = usePermissions();
  const registry = useRegistry();
  const [environment, setEnvironment] = useState<UiEnvironment>("DEV");
  const [items, setItems] = useState<CatalogContentBlock[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editor, setEditor] = useState<ContentEditorState>(() => makeContentEditorSeed());
  const [createMode, setCreateMode] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [lastValidationValid, setLastValidationValid] = useState<boolean | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [searchText, setSearchText] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | CatalogContentBlock["status"]>("ALL");
  const [tagSuggestions, setTagSuggestions] = useState<string[]>([]);

  const defaultLocale = DEFAULT_APP_ENUM_SETTINGS.locales[0] ?? "en";
  const [activeLocale, setActiveLocale] = useState(defaultLocale);
  const [localeData, setLocaleData] = useState<Record<string, unknown>>({ [defaultLocale]: {} });
  const [tokenBindingRows, setTokenBindingRows] = useState<TokenBindingRow[]>([{ token: "offer", sourcePath: "context.offer" }]);

  const [previewLocale, setPreviewLocale] = useState(defaultLocale);
  const [previewProfileId, setPreviewProfileId] = useState("p-1001");
  const [previewContext, setPreviewContext] = useState('{\n  "offer": { "code": "WINBACK10", "percent": 10 },\n  "profile": { "first_name": "Alex" }\n}\n');
  const [previewResult, setPreviewResult] = useState<unknown | null>(null);

  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false);
  const [archiveConfirmKey, setArchiveConfirmKey] = useState("");
  const { settings: enumSettings } = useAppEnumSettings();
  const preferredLocale = enumSettings.locales[0] ?? defaultLocale;

  useEffect(() => {
    setEnvironment(getEnvironment());
    return onEnvironmentChange(setEnvironment);
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const [content, tags] = await Promise.all([apiClient.catalog.content.list(), apiClient.catalog.tags()]);
      setItems(content.items);
      setTagSuggestions(tags.contentTags ?? []);

      if (content.items.length > 0) {
        const active = selectedId ? content.items.find((item) => item.id === selectedId) : content.items[0];
        if (active) {
          const seed = makeContentEditorSeed(active);
          setEditor(seed);
          setSelectedId(active.id);
          setCreateMode(false);
          setLocaleData(readObject(safeJsonParse<Record<string, unknown>>(seed.localesJsonText).value));
          setTokenBindingRows(toTokenRows(seed.tokenBindingsText));
          setActiveLocale(Object.keys(active.localesJson ?? {})[0] ?? preferredLocale);
          setPreviewLocale(Object.keys(active.localesJson ?? {})[0] ?? preferredLocale);
        }
      }
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load content blocks");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [environment]);

  const selectedItem = useMemo(() => items.find((item) => item.id === selectedId) ?? null, [items, selectedId]);
  const dependencyItems = useMemo(
    () => validateContentDependencies(registry, { templateId: editor.templateId }),
    [registry, editor.templateId]
  );

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
  const canActivate = hasPermission("catalog.content.activate") && !createMode && !readOnly && hasDraftForKey && lastValidationValid === true;

  const schemaParse = useMemo(() => safeJsonParse<Record<string, unknown> | null>(editor.schemaJsonText), [editor.schemaJsonText]);
  const localesParse = useMemo(() => safeJsonParse<Record<string, unknown>>(editor.localesJsonText), [editor.localesJsonText]);
  const tokenBindingsParse = useMemo(() => safeJsonParse<Record<string, unknown>>(editor.tokenBindingsText), [editor.tokenBindingsText]);

  useEffect(() => {
    if (localesParse.value) {
      setLocaleData(readObject(localesParse.value));
    }
  }, [localesParse.value]);

  useEffect(() => {
    if (tokenBindingsParse.value) {
      setTokenBindingRows(toTokenRows(editor.tokenBindingsText));
    }
  }, [editor.tokenBindingsText, tokenBindingsParse.value]);

  const resolvedSchema = schemaForTemplate(editor.templateId.trim(), schemaParse.value && typeof schemaParse.value === "object" ? schemaParse.value : null);
  const usingSchemaFallback = !schemaParse.value && editor.templateId.trim() === "banner_v1";
  const resolvedSchemaFields = schemaFields(resolvedSchema);
  const requiredFields = resolvedSchemaFields.filter((field) => field.required).map((field) => field.key);
  const optionalFields = resolvedSchemaFields.filter((field) => !field.required).map((field) => field.key);

  const advancedReasons = useMemo(() => {
    const reasons: string[] = [];
    if (schemaParse.error) {
      reasons.push(`schemaJson invalid: ${schemaParse.error}`);
    }
    if (localesParse.error) {
      reasons.push(`localesJson invalid: ${localesParse.error}`);
    }
    if (tokenBindingsParse.error) {
      reasons.push(`tokenBindings invalid: ${tokenBindingsParse.error}`);
    }
    if (!schemaSupportsLocaleForm(resolvedSchema)) {
      reasons.push("Schema has fields that are not representable by the form editor");
    }
    return reasons;
  }, [localesParse.error, resolvedSchema, schemaParse.error, tokenBindingsParse.error]);

  const advancedOnly = advancedReasons.length > 0;

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

  const previewContextParsed = safeJsonParse<Record<string, unknown>>(previewContext);
  const tokenBindingsObject = rowsToBindings(tokenBindingRows);
  const localeForPreview = readObject(localeData[previewLocale]);
  const localRendered = renderLocaleWithBindings(localeForPreview, tokenBindingsObject, previewContextParsed.value ?? {});
  const diagnostics = detectBindingDiagnostics(localeData, tokenBindingsObject);
  const remotePreviewPayload = useMemo(() => {
    const payload = (previewResult as { item?: { payload?: unknown } } | null)?.item?.payload;
    if (payload && typeof payload === "object" && !Array.isArray(payload)) {
      return payload as Record<string, unknown>;
    }
    return null;
  }, [previewResult]);

  const save = async () => {
    setSaving(true);
    try {
      const payload = parsePayloadOrThrow(editor);
      if (createMode || !selectedId) {
        const response = await apiClient.catalog.content.create(payload);
        setSelectedId(response.item.id);
        setCreateMode(false);
        setEditor(makeContentEditorSeed(response.item));
        setMessage(`Saved content block ${response.item.key} v${response.item.version}`);
      } else {
        const response = await apiClient.catalog.content.update(selectedId, {
          name: payload.name,
          description: payload.description,
          status: payload.status,
          templateId: payload.templateId,
          tags: payload.tags,
          schemaJson: payload.schemaJson,
          localesJson: payload.localesJson,
          tokenBindings: payload.tokenBindings
        });
        setEditor(makeContentEditorSeed(response.item));
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
      const payload = parsePayloadOrThrow(editor);
      const validation = await apiClient.catalog.content.validate(payload);
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
      const response = await apiClient.catalog.content.create(payload);
      setSelectedId(response.item.id);
      setEditor(makeContentEditorSeed(response.item));
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
      const response = await apiClient.catalog.content.activate(editor.key.trim(), target?.version);
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
      await apiClient.catalog.content.archive(editor.key.trim());
      setMessage(`Archived ${editor.key.trim()}`);
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
      link.download = `${payload.key || "content"}-v${selectedItem?.version ?? 0}.json`;
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
      const response = await apiClient.catalog.content.preview(editor.key.trim(), {
        locale: previewLocale.trim() || preferredLocale,
        profileId: previewProfileId.trim() || undefined,
        context: context.value
      });
      setPreviewResult(response);
      setMessage("Preview generated");
      setError(null);
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : "Preview failed");
    }
  };

  return (
    <section className="space-y-4">
      <header className="panel p-4">
        <h2 className="text-xl font-semibold">Catalog / Content Blocks</h2>
        <p className="text-sm text-stone-700">Schema-driven locale editing with token bindings diagnostics and marketer-first preview.</p>
      </header>

      <CatalogActionBar
        status={editor.status}
        versionLabel={statusRibbon}
        environment={environment}
        lastSavedAt={editor.lastSavedAt}
        canSave={hasPermission("catalog.content.write")}
        canValidate={hasPermission("catalog.content.write")}
        showActivate={hasPermission("catalog.content.activate")}
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
              onChange={(event) => setStatusFilter(event.target.value as "ALL" | CatalogContentBlock["status"])}
              className="w-full rounded-md border border-stone-300 px-2 py-1 text-sm"
            >
              <option value="ALL">All</option>
              <option value="ACTIVE">Active</option>
              <option value="DRAFT">Draft</option>
              <option value="ARCHIVED">Archived</option>
            </select>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                const seed = makeContentEditorSeed();
                const baseLocaleData = readObject(safeJsonParse<Record<string, unknown>>(seed.localesJsonText).value);
                const localeSeed = withPreferredDefaultLocale(baseLocaleData, preferredLocale);
                setCreateMode(true);
                setSelectedId(null);
                setEditor((current) => ({ ...current, ...seed, localesJsonText: toPrettyJson(localeSeed) }));
                setLocaleData(localeSeed);
                setTokenBindingRows(toTokenRows(seed.tokenBindingsText));
                const firstLocale = Object.keys(localeSeed)[0] ?? preferredLocale;
                setActiveLocale(firstLocale);
                setPreviewLocale(firstLocale);
                setLastValidationValid(null);
              }}
            >
              New content block
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
                  const seed = makeContentEditorSeed(item);
                  setSelectedId(item.id);
                  setEditor(seed);
                  setCreateMode(false);
                  setLocaleData(readObject(item.localesJson));
                  setTokenBindingRows(toTokenRows(seed.tokenBindingsText));
                  const firstLocale = Object.keys(item.localesJson ?? {})[0] ?? preferredLocale;
                  setActiveLocale(firstLocale);
                  setPreviewLocale(firstLocale);
                  setLastValidationValid(null);
                }}
              >
                <p className="font-medium">{item.key}</p>
                <p className="text-xs text-stone-600">{statusLabel(item.status, item.version)}</p>
              </button>
            ))}
            {filteredItems.length === 0 ? <p className="text-xs text-stone-600">No content blocks found.</p> : null}
          </div>
        </aside>

        <ContentBlockEditor
          value={editor}
          onChange={(patch) => {
            setEditor((current) => ({ ...current, ...patch }));
            setLastValidationValid(null);
          }}
          readOnlyKey={!createMode}
          readOnly={readOnly}
          availableTags={tagSuggestions}
          schemaFields={resolvedSchemaFields}
          schemaRequired={requiredFields}
          schemaOptional={optionalFields}
          schemaFallbackInUse={usingSchemaFallback}
          localeData={localeData}
          activeLocale={activeLocale}
          onActiveLocaleChange={(locale) => {
            setActiveLocale(locale);
            setPreviewLocale(locale);
          }}
          onLocaleDataChange={(next) => {
            setLocaleData(next);
            setEditor((current) => ({ ...current, localesJsonText: toPrettyJson(next) }));
            setLastValidationValid(null);
          }}
          tokenBindingsRows={tokenBindingRows}
          onTokenBindingsRowsChange={(rows) => {
            setTokenBindingRows(rows);
            const bindings = rowsToBindings(rows);
            setEditor((current) => ({ ...current, tokenBindingsText: toPrettyJson(bindings) }));
            setLastValidationValid(null);
          }}
          bindingWarnings={{ missing: diagnostics.missing, unused: diagnostics.unused }}
          previewContext={previewContextParsed.value ?? {}}
          advancedOnly={advancedOnly}
          advancedReasons={advancedReasons}
          showAdvanced={showAdvanced}
          onToggleAdvanced={() => setShowAdvanced((current) => !current)}
          localeOptions={enumSettings.locales}
        />
        <DependenciesPanel items={dependencyItems} />
      </div>

      <PreviewPane
        localeOptions={Object.keys(localeData).length > 0 ? Object.keys(localeData) : [preferredLocale]}
        previewLocale={previewLocale}
        testProfileId={previewProfileId}
        contextJsonText={previewContext}
        onPreviewLocaleChange={setPreviewLocale}
        onTestProfileIdChange={setPreviewProfileId}
        onContextJsonChange={setPreviewContext}
        onRunPreview={() => void runPreview()}
        visualPayload={remotePreviewPayload ?? localRendered.rendered}
        renderedJson={previewResult ?? localRendered.rendered}
        missingTokens={localRendered.missingTokens}
      />

      <section className="panel space-y-3 border-red-300 p-4">
        <h3 className="font-semibold text-red-700">Danger zone</h3>
        <p className="text-sm text-stone-700">Archive key permanently hides all versions of this content key from active use.</p>
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

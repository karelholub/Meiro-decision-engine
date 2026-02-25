import { useEffect, useMemo, useState } from "react";
import type { ActionType, DecisionOutput } from "@decisioning/dsl";
import { apiClient } from "../../lib/api";
import { getEnvironment, onEnvironmentChange, type UiEnvironment } from "../../lib/environment";

interface CatalogContentOption {
  key: string;
  version: number;
  status: string;
  templateId: string;
}

interface CatalogOfferOption {
  key: string;
  version: number;
  status: string;
}

interface ActionTemplatePickerProps {
  title?: string;
  value: DecisionOutput;
  onChange: (output: DecisionOutput) => void;
  readOnly?: boolean;
  errorByPath?: Record<string, string>;
  pathPrefix: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
};

const defaultPayloadByAction: Record<ActionType, Record<string, unknown>> = {
  noop: {},
  suppress: {
    reason: ""
  },
  message: {
    show: true,
    placement: "home_top",
    templateId: "template_001",
    ttl_seconds: 3600,
    tracking: {
      campaign: "",
      source: "decision_builder"
    },
    payload: {}
  },
  personalize: {
    variant: "A",
    reason: ""
  }
};

const actionHints: Record<ActionType, string> = {
  noop: "Use for safe default behavior or intentional no-op paths.",
  suppress: "Use when user should not receive treatment. Provide a clear reason for reporting/debugging.",
  message: "Use for in-app messaging outcomes with placement/template/ttl and tracking metadata.",
  personalize: "Use for deterministic variant selection and downstream personalization."
};

const ensureObjectPayload = (output: DecisionOutput): DecisionOutput => {
  return {
    ...output,
    payload: isRecord(output.payload) ? output.payload : {}
  };
};

export function ActionTemplatePicker({ title, value, onChange, readOnly, errorByPath, pathPrefix }: ActionTemplatePickerProps) {
  const safeValue = ensureObjectPayload(value);
  const payload = safeValue.payload;
  const payloadRef = isRecord(payload.payloadRef) ? payload.payloadRef : {};
  const selectedContentKey = typeof payloadRef.contentKey === "string" ? payloadRef.contentKey : "";
  const selectedOfferKey = typeof payloadRef.offerKey === "string" ? payloadRef.offerKey : "";

  const [environment, setEnvironment] = useState<UiEnvironment>("DEV");
  const [activeContentOptions, setActiveContentOptions] = useState<CatalogContentOption[]>([]);
  const [activeOfferOptions, setActiveOfferOptions] = useState<CatalogOfferOption[]>([]);
  const [latestContentOptionsByKey, setLatestContentOptionsByKey] = useState<Record<string, CatalogContentOption>>({});
  const [latestOfferOptionsByKey, setLatestOfferOptionsByKey] = useState<Record<string, CatalogOfferOption>>({});

  const [trackingJson, setTrackingJson] = useState(JSON.stringify(isRecord(payload.tracking) ? payload.tracking : {}, null, 2));
  const [nestedPayloadJson, setNestedPayloadJson] = useState(JSON.stringify(isRecord(payload.payload) ? payload.payload : {}, null, 2));
  const [rawPayloadJson, setRawPayloadJson] = useState(JSON.stringify(payload, null, 2));
  const [payloadError, setPayloadError] = useState<string | null>(null);

  useEffect(() => {
    setTrackingJson(JSON.stringify(isRecord(payload.tracking) ? payload.tracking : {}, null, 2));
    setNestedPayloadJson(JSON.stringify(isRecord(payload.payload) ? payload.payload : {}, null, 2));
    setRawPayloadJson(JSON.stringify(payload, null, 2));
    setPayloadError(null);
  }, [payload]);

  useEffect(() => {
    setEnvironment(getEnvironment());
    return onEnvironmentChange(setEnvironment);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadCatalog = async () => {
      try {
        const [contentResponse, offerResponse] = await Promise.all([
          apiClient.catalog.content.list(),
          apiClient.catalog.offers.list()
        ]);

        if (cancelled) {
          return;
        }

        const latestContentByKey = new Map<string, CatalogContentOption>();
        const latestActiveContentByKey = new Map<string, CatalogContentOption>();
        for (const item of contentResponse.items) {
          const current = latestContentByKey.get(item.key);
          if (!current || item.version > current.version) {
            latestContentByKey.set(item.key, {
              key: item.key,
              version: item.version,
              status: item.status,
              templateId: item.templateId
            });
          }
          if (item.status === "ACTIVE") {
            const activeCurrent = latestActiveContentByKey.get(item.key);
            if (!activeCurrent || item.version > activeCurrent.version) {
              latestActiveContentByKey.set(item.key, {
                key: item.key,
                version: item.version,
                status: item.status,
                templateId: item.templateId
              });
            }
          }
        }

        const latestOffersByKey = new Map<string, CatalogOfferOption>();
        const latestActiveOffersByKey = new Map<string, CatalogOfferOption>();
        for (const item of offerResponse.items) {
          const current = latestOffersByKey.get(item.key);
          if (!current || item.version > current.version) {
            latestOffersByKey.set(item.key, {
              key: item.key,
              version: item.version,
              status: item.status
            });
          }
          if (item.status === "ACTIVE") {
            const activeCurrent = latestActiveOffersByKey.get(item.key);
            if (!activeCurrent || item.version > activeCurrent.version) {
              latestActiveOffersByKey.set(item.key, {
                key: item.key,
                version: item.version,
                status: item.status
              });
            }
          }
        }

        const sortByKey = <T extends { key: string }>(items: T[]) => items.sort((a, b) => a.key.localeCompare(b.key));
        setActiveContentOptions(sortByKey([...latestActiveContentByKey.values()]));
        setActiveOfferOptions(sortByKey([...latestActiveOffersByKey.values()]));
        setLatestContentOptionsByKey(Object.fromEntries(latestContentByKey.entries()));
        setLatestOfferOptionsByKey(Object.fromEntries(latestOffersByKey.entries()));
      } catch {
        if (!cancelled) {
          setActiveContentOptions([]);
          setActiveOfferOptions([]);
          setLatestContentOptionsByKey({});
          setLatestOfferOptionsByKey({});
        }
      }
    };

    void loadCatalog();
    return () => {
      cancelled = true;
    };
  }, [environment]);

  const updatePayload = (patch: Record<string, unknown>) => {
    onChange({
      ...safeValue,
      payload: {
        ...payload,
        ...patch
      }
    });
  };

  const updatePayloadRef = (patch: { contentKey?: string; offerKey?: string }, payloadPatch: Record<string, unknown> = {}) => {
    const nextRef: Record<string, unknown> = {
      ...(isRecord(payload.payloadRef) ? payload.payloadRef : {}),
      ...patch
    };

    if (!nextRef.contentKey) {
      delete nextRef.contentKey;
    }
    if (!nextRef.offerKey) {
      delete nextRef.offerKey;
    }

    const nextPayload: Record<string, unknown> = {
      ...payload,
      ...payloadPatch
    };
    if (Object.keys(nextRef).length > 0) {
      nextPayload.payloadRef = nextRef;
    } else {
      delete nextPayload.payloadRef;
    }

    onChange({
      ...safeValue,
      payload: nextPayload
    });
  };

  const applyActionType = (nextActionType: ActionType) => {
    if (safeValue.actionType === nextActionType) {
      return;
    }
    onChange({
      actionType: nextActionType,
      payload: defaultPayloadByAction[nextActionType]
    });
  };

  const actionTypeError = errorByPath?.[`${pathPrefix}.actionType`];
  const payloadPathError = errorByPath?.[`${pathPrefix}.payload`];

  const effectiveContentOptions = useMemo(() => {
    const options = [...activeContentOptions];
    if (selectedContentKey && !options.some((item) => item.key === selectedContentKey)) {
      const selectedFallback = latestContentOptionsByKey[selectedContentKey];
      if (selectedFallback) {
        options.push(selectedFallback);
      }
    }
    return options.sort((a, b) => a.key.localeCompare(b.key));
  }, [activeContentOptions, latestContentOptionsByKey, selectedContentKey]);

  const effectiveOfferOptions = useMemo(() => {
    const options = [...activeOfferOptions];
    if (selectedOfferKey && !options.some((item) => item.key === selectedOfferKey)) {
      const selectedFallback = latestOfferOptionsByKey[selectedOfferKey];
      if (selectedFallback) {
        options.push(selectedFallback);
      }
    }
    return options.sort((a, b) => a.key.localeCompare(b.key));
  }, [activeOfferOptions, latestOfferOptionsByKey, selectedOfferKey]);

  const actionLabel = useMemo(() => {
    if (safeValue.actionType === "message") {
      return "inapp_message";
    }
    return safeValue.actionType;
  }, [safeValue.actionType]);

  return (
    <section className="space-y-3">
      {title ? <h4 className="font-semibold text-sm">{title}</h4> : null}
      <p className="text-xs text-stone-600">Selected action template: {actionLabel}</p>
      <p className="text-xs text-stone-500">{actionHints[safeValue.actionType]}</p>

      <label className="flex flex-col gap-1 text-xs" data-error-path={`${pathPrefix}.actionType`}>
        Action type
        <select
          value={safeValue.actionType}
          onChange={(event) => applyActionType(event.target.value as ActionType)}
          disabled={readOnly}
          className="rounded-md border border-stone-300 px-2 py-1"
        >
          <option value="noop">noop</option>
          <option value="suppress">suppress</option>
          <option value="message">inapp_message</option>
          <option value="personalize">personalize</option>
        </select>
        {actionTypeError ? <span className="text-red-700">{actionTypeError}</span> : null}
      </label>

      {safeValue.actionType === "noop" ? (
        <p className="rounded-md border border-dashed border-stone-300 p-2 text-xs text-stone-600">No payload fields required.</p>
      ) : null}

      {safeValue.actionType === "suppress" ? (
        <label className="flex flex-col gap-1 text-xs" data-error-path={`${pathPrefix}.payload.reason`}>
          Suppression reason
          <input
            value={typeof payload.reason === "string" ? payload.reason : ""}
            onChange={(event) => updatePayload({ reason: event.target.value })}
            disabled={readOnly}
            className="rounded-md border border-stone-300 px-2 py-1"
            placeholder="compliance_rule"
          />
        </label>
      ) : null}

      {safeValue.actionType === "personalize" ? (
        <div className="grid gap-3 md:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs">
            Variant
            <input
              value={typeof payload.variant === "string" ? payload.variant : ""}
              onChange={(event) => updatePayload({ variant: event.target.value })}
              disabled={readOnly}
              className="rounded-md border border-stone-300 px-2 py-1"
              placeholder="A"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            Reason
            <input
              value={typeof payload.reason === "string" ? payload.reason : ""}
              onChange={(event) => updatePayload({ reason: event.target.value })}
              disabled={readOnly}
              className="rounded-md border border-stone-300 px-2 py-1"
              placeholder="segment match"
            />
          </label>
        </div>
      ) : null}

      {safeValue.actionType === "message" ? (
        <div className="space-y-3 rounded-md border border-stone-200 p-3">
          <p className="text-[11px] text-stone-500">
            Catalog references default to ACTIVE items. If this decision already references an inactive key, it remains selectable.
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs">
              Content Block Reference
              <select
                value={selectedContentKey}
                onChange={(event) => {
                  const nextKey = event.target.value || undefined;
                  const selectedOption = nextKey ? effectiveContentOptions.find((item) => item.key === nextKey) : null;
                  updatePayloadRef(
                    { contentKey: nextKey },
                    selectedOption?.templateId ? { templateId: selectedOption.templateId } : {}
                  );
                }}
                disabled={readOnly}
                className="rounded-md border border-stone-300 px-2 py-1"
              >
                <option value="">None (raw payload)</option>
                {effectiveContentOptions.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.key} (v{option.version}, {option.status}
                    {option.status !== "ACTIVE" ? ", selected inactive" : ""})
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs">
              Offer Reference (optional)
              <select
                value={selectedOfferKey}
                onChange={(event) => updatePayloadRef({ offerKey: event.target.value || undefined })}
                disabled={readOnly}
                className="rounded-md border border-stone-300 px-2 py-1"
              >
                <option value="">None</option>
                {effectiveOfferOptions.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.key} (v{option.version}, {option.status}
                    {option.status !== "ACTIVE" ? ", selected inactive" : ""})
                  </option>
                ))}
              </select>
            </label>
          </div>
          {activeContentOptions.length === 0 || activeOfferOptions.length === 0 ? (
            <p className="text-[11px] text-amber-700">
              {activeContentOptions.length === 0 ? "No ACTIVE content blocks found." : ""}
              {activeContentOptions.length === 0 && activeOfferOptions.length === 0 ? " " : ""}
              {activeOfferOptions.length === 0 ? "No ACTIVE offers found." : ""} Activate catalog items in Catalog pages to use them here.
            </p>
          ) : null}

          <div className="grid gap-3 md:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs">
              Show
              <select
                value={String(Boolean(payload.show))}
                onChange={(event) => updatePayload({ show: event.target.value === "true" })}
                disabled={readOnly}
                className="rounded-md border border-stone-300 px-2 py-1"
              >
                <option value="true">true</option>
                <option value="false">false</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs">
              Placement
              <input
                value={typeof payload.placement === "string" ? payload.placement : ""}
                onChange={(event) => updatePayload({ placement: event.target.value })}
                disabled={readOnly}
                className="rounded-md border border-stone-300 px-2 py-1"
                placeholder="home_top"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              Template ID
              <input
                value={typeof payload.templateId === "string" ? payload.templateId : ""}
                onChange={(event) => updatePayload({ templateId: event.target.value })}
                disabled={readOnly}
                className="rounded-md border border-stone-300 px-2 py-1"
                placeholder="template_001"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              TTL (seconds)
              <input
                type="number"
                min={0}
                value={typeof payload.ttl_seconds === "number" ? String(payload.ttl_seconds) : ""}
                onChange={(event) => updatePayload({ ttl_seconds: Number(event.target.value) || 0 })}
                disabled={readOnly}
                className="rounded-md border border-stone-300 px-2 py-1"
                placeholder="3600"
              />
            </label>
          </div>

          <label className="flex flex-col gap-1 text-xs">
            Tracking (JSON object)
            <textarea
              value={trackingJson}
              onChange={(event) => setTrackingJson(event.target.value)}
              onBlur={() => {
                try {
                  const parsed = JSON.parse(trackingJson);
                  if (!isRecord(parsed)) {
                    throw new Error("Tracking must be a JSON object");
                  }
                  updatePayload({ tracking: parsed });
                  setPayloadError(null);
                } catch (error) {
                  setPayloadError(error instanceof Error ? error.message : "Invalid tracking JSON");
                }
              }}
              disabled={readOnly}
              className="min-h-24 rounded-md border border-stone-300 px-2 py-1 font-mono"
            />
          </label>

          <label className="flex flex-col gap-1 text-xs">
            Payload (JSON object)
            <textarea
              value={nestedPayloadJson}
              onChange={(event) => setNestedPayloadJson(event.target.value)}
              onBlur={() => {
                try {
                  const parsed = JSON.parse(nestedPayloadJson);
                  if (!isRecord(parsed)) {
                    throw new Error("Payload must be a JSON object");
                  }
                  updatePayload({ payload: parsed });
                  setPayloadError(null);
                } catch (error) {
                  setPayloadError(error instanceof Error ? error.message : "Invalid payload JSON");
                }
              }}
              disabled={readOnly}
              className="min-h-24 rounded-md border border-stone-300 px-2 py-1 font-mono"
            />
          </label>
        </div>
      ) : null}

      <label className="flex flex-col gap-1 text-xs" data-error-path={`${pathPrefix}.payload`}>
        Raw payload JSON
        <textarea
          value={rawPayloadJson}
          onChange={(event) => setRawPayloadJson(event.target.value)}
          onBlur={() => {
            try {
              const parsed = JSON.parse(rawPayloadJson);
              if (!isRecord(parsed)) {
                throw new Error("Payload must be a JSON object");
              }
              onChange({
                ...safeValue,
                payload: parsed
              });
              setPayloadError(null);
            } catch (error) {
              setPayloadError(error instanceof Error ? error.message : "Invalid payload JSON");
            }
          }}
          disabled={readOnly}
          className="min-h-24 rounded-md border border-stone-300 px-2 py-1 font-mono"
        />
      </label>

      {payloadPathError ? <p className="text-xs text-red-700">{payloadPathError}</p> : null}
      {payloadError ? <p className="text-xs text-red-700">{payloadError}</p> : null}
    </section>
  );
}

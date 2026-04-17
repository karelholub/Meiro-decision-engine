import { useEffect, useMemo, useState } from "react";
import type { ActionType, DecisionOutput } from "@decisioning/dsl";
import { parseLegacyKey, toLegacyKey } from "@decisioning/shared";
import { RefSelect } from "../registry/RefSelect";
import { useRegistry } from "../../lib/registry";
import { ActivationAssetPicker } from "../catalog/ActivationAssetPicker";
import type { ActivationAssetChannel, ActivationLibraryItem } from "../../lib/api";

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
  },
  experiment: {
    experimentKey: "",
    placement: "home_top"
  }
};

const actionHints: Record<ActionType, string> = {
  noop: "Use for safe default behavior or intentional no-op paths.",
  suppress: "Use when user should not receive treatment. Provide a clear reason for reporting/debugging.",
  message: "Use for in-app messaging outcomes with placement/template/ttl and tracking metadata.",
  personalize: "Use for deterministic variant selection and downstream personalization.",
  experiment: "Use to resolve an active experiment into a concrete in-app treatment at runtime."
};

const inferActivationChannelFromPayload = (payload: Record<string, unknown>): ActivationAssetChannel => {
  const text = `${typeof payload.templateId === "string" ? payload.templateId : ""} ${typeof payload.placement === "string" ? payload.placement : ""}`.toLowerCase();
  if (text.includes("whatsapp")) return "whatsapp";
  if (text.includes("push")) return "mobile_push";
  if (text.includes("email")) return "email";
  if (text.includes("journey")) return "journey_canvas";
  if (text.includes("popup") || text.includes("modal") || text.includes("inapp")) return "popup_banner";
  return "website_personalization";
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
  const selectedBundleKey = typeof payloadRef.bundleKey === "string" ? payloadRef.bundleKey : "";
  const selectedContentRef = selectedContentKey ? parseLegacyKey("content", selectedContentKey) : null;
  const selectedOfferRef = selectedOfferKey ? parseLegacyKey("offer", selectedOfferKey) : null;
  const selectedExperimentRef =
    typeof payload.experimentKey === "string" && payload.experimentKey.trim()
      ? parseLegacyKey("experiment", payload.experimentKey)
      : null;

  const registry = useRegistry();

  const [trackingJson, setTrackingJson] = useState(JSON.stringify(isRecord(payload.tracking) ? payload.tracking : {}, null, 2));
  const [nestedPayloadJson, setNestedPayloadJson] = useState(JSON.stringify(isRecord(payload.payload) ? payload.payload : {}, null, 2));
  const [rawPayloadJson, setRawPayloadJson] = useState(JSON.stringify(payload, null, 2));
  const [payloadError, setPayloadError] = useState<string | null>(null);
  const [showAdvancedPayload, setShowAdvancedPayload] = useState(false);

  useEffect(() => {
    setTrackingJson(JSON.stringify(isRecord(payload.tracking) ? payload.tracking : {}, null, 2));
    setNestedPayloadJson(JSON.stringify(isRecord(payload.payload) ? payload.payload : {}, null, 2));
    setRawPayloadJson(JSON.stringify(payload, null, 2));
    setPayloadError(null);
  }, [payload]);


  const updatePayload = (patch: Record<string, unknown>) => {
    onChange({
      ...safeValue,
      payload: {
        ...payload,
        ...patch
      }
    });
  };

  const updatePayloadRef = (patch: { contentKey?: string; offerKey?: string; bundleKey?: string }, payloadPatch: Record<string, unknown> = {}) => {
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
    if (!nextRef.bundleKey) {
      delete nextRef.bundleKey;
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

  const actionLabel = useMemo(() => {
    if (safeValue.actionType === "message") {
      return "inapp_message";
    }
    return safeValue.actionType;
  }, [safeValue.actionType]);

  const selectActivationAsset = (item: ActivationLibraryItem) => {
    updatePayloadRef(
      {
        contentKey: item.runtimeRef.contentKey,
        offerKey: item.runtimeRef.offerKey,
        bundleKey: item.runtimeRef.bundleKey
      },
      item.runtimeRef.contentKey ? { templateId: item.compatibility.templateKeys[0] ?? payload.templateId } : {}
    );
  };

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
          <option value="experiment">experiment</option>
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
              Reusable Asset Reference (required)
              <RefSelect
                type="content"
                value={selectedContentRef}
                onChange={(nextRef) => {
                  const nextKey = nextRef ? toLegacyKey(nextRef) : undefined;
                  const resolved = nextRef ? registry.get(nextRef) : null;
                  const templateId =
                    resolved && typeof resolved.raw.templateId === "string" ? resolved.raw.templateId : undefined;
                  updatePayloadRef({ contentKey: nextKey }, templateId ? { templateId } : {});
                }}
                disabled={readOnly}
                allowVersionPin
              />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              Offer Reference (optional)
              <RefSelect
                type="offer"
                value={selectedOfferRef}
                onChange={(nextRef) => updatePayloadRef({ offerKey: nextRef ? toLegacyKey(nextRef) : undefined })}
                disabled={readOnly}
                allowVersionPin
              />
            </label>
            <label className="flex flex-col gap-1 text-xs md:col-span-2">
              Asset Bundle Reference (optional)
              <input
                className="rounded-md border border-stone-300 px-2 py-1"
                value={selectedBundleKey}
                onChange={(event) => updatePayloadRef({ bundleKey: event.target.value.trim() || undefined })}
                placeholder="winback_home_modal"
                disabled={readOnly}
              />
            </label>
            <div className="md:col-span-2">
              <ActivationAssetPicker
                channel={inferActivationChannelFromPayload(payload)}
                templateKey={typeof payload.templateId === "string" ? payload.templateId : undefined}
                placementKey={typeof payload.placement === "string" ? payload.placement : undefined}
                disabled={readOnly}
                onSelect={selectActivationAsset}
              />
            </div>
          </div>
          {registry.list("content", { status: "ACTIVE" }).length === 0 || registry.list("offer", { status: "ACTIVE" }).length === 0 ? (
            <p className="text-[11px] text-amber-700">
              {registry.list("content", { status: "ACTIVE" }).length === 0 ? "No ACTIVE reusable assets found." : ""}
              {registry.list("content", { status: "ACTIVE" }).length === 0 && registry.list("offer", { status: "ACTIVE" }).length === 0 ? " " : ""}
              {registry.list("offer", { status: "ACTIVE" }).length === 0 ? "No ACTIVE offers found." : ""} Activate catalog items in Catalog pages to use them here.
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

          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={showAdvancedPayload}
              onChange={(event) => setShowAdvancedPayload(event.target.checked)}
              disabled={readOnly}
            />
            Custom payload (advanced)
          </label>
          {showAdvancedPayload ? (
            <>
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
            </>
          ) : null}
        </div>
      ) : null}

      {safeValue.actionType === "experiment" ? (
        <div className="grid gap-3 rounded-md border border-stone-200 p-3">
          <label className="flex flex-col gap-1 text-xs">
            experimentKey
            <RefSelect
              type="experiment"
              value={selectedExperimentRef}
              onChange={(nextRef) => updatePayload({ experimentKey: nextRef ? toLegacyKey(nextRef) : "" })}
              filter={{ status: "ACTIVE" }}
              disabled={readOnly}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            placement (optional)
            <input
              className="rounded border border-stone-300 px-2 py-1 font-mono text-xs"
              value={typeof payload.placement === "string" ? payload.placement : ""}
              onChange={(event) => updatePayload({ placement: event.target.value })}
              placeholder="home_top"
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

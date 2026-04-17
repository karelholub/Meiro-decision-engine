"use client";

import { useEffect, useMemo, useState } from "react";
import type { ExperimentVersionSummary, InAppApplication, InAppPlacement } from "@decisioning/shared";
import { InlineError } from "../../../../components/ui/app-state";
import { Button } from "../../../../components/ui/button";
import { PageHeader, PagePanel, inputClassName } from "../../../../components/ui/page";
import { apiClient, type InAppV2DecideResponse } from "../../../../lib/api";
import { useAppEnumSettings } from "../../../../lib/app-enum-settings";
import { getEnvironment, onEnvironmentChange, type UiEnvironment } from "../../../../lib/environment";

const CUSTOM_LOOKUP_ATTRIBUTE = "__custom_lookup_attribute__";

type IdentityMode = "profile" | "anonymous" | "lookup";
type PlaygroundMode = "runtime" | "experiment";

type ExperimentPreviewResult = {
  item: {
    key: string;
    version: number;
    status: string;
  };
  preview: {
    eligible: boolean;
    assignment: {
      variantId: string | null;
      isHoldout: boolean;
      allocationId: string;
    };
    treatment: Record<string, unknown> | null;
    payload: Record<string, unknown> | null;
    tracking: Record<string, unknown>;
  };
  debug: Record<string, unknown>;
};

type BannerViewModel = {
  badge: string;
  title: string;
  body: string;
  ctaLabel: string;
  ctaUrl: string;
  background: string;
};

const toPretty = (value: unknown) => JSON.stringify(value, null, 2);

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
};

const getByPath = (root: Record<string, unknown>, path: string): unknown => {
  const parts = path.split(".").filter((part) => part.length > 0);
  let cursor: unknown = root;
  for (const part of parts) {
    const rec = asRecord(cursor);
    if (!rec) {
      return undefined;
    }
    cursor = rec[part];
  }
  return cursor;
};

const getStringByPaths = (root: Record<string, unknown>, paths: string[]): string | null => {
  for (const path of paths) {
    const value = getByPath(root, path);
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
};

const resolveBanner = (payload: Record<string, unknown> | null): BannerViewModel => {
  if (!payload) {
    return {
      badge: "Preview",
      title: "No in-app payload",
      body: "Run runtime decide or experiment preview to render a banner here.",
      ctaLabel: "Browse",
      ctaUrl: "#",
      background: "from-stone-700 to-stone-500"
    };
  }

  const title =
    getStringByPaths(payload, ["title", "headline", "message.title", "content.title", "payload.title", "name"]) ?? "Special offer";
  const body =
    getStringByPaths(payload, ["body", "description", "message.body", "content.body", "payload.body", "text"]) ??
    "Your selected experiment variant has been rendered using live response data.";
  const ctaLabel =
    getStringByPaths(payload, ["cta.label", "cta.text", "action.label", "button.label", "button.text", "link.text"]) ?? "Learn more";
  const ctaUrl = getStringByPaths(payload, ["cta.url", "action.url", "button.url", "link.url"]) ?? "#";
  const badge = getStringByPaths(payload, ["badge", "eyebrow", "campaign", "placement"]) ?? "Experiment Variant";
  const tone = getStringByPaths(payload, ["theme", "style.tone", "intent"])?.toLowerCase() ?? "promo";
  const background = tone.includes("warn")
    ? "from-amber-600 to-orange-500"
    : tone.includes("info")
      ? "from-sky-700 to-cyan-600"
      : "from-rose-700 to-orange-600";

  return {
    badge,
    title,
    body,
    ctaLabel,
    ctaUrl,
    background
  };
};

export default function ExperimentPlaygroundPage() {
  const [environment, setEnvironment] = useState<UiEnvironment>("DEV");
  const [loading, setLoading] = useState(false);
  const [sendingEvent, setSendingEvent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [mode, setMode] = useState<PlaygroundMode>("runtime");
  const [apps, setApps] = useState<InAppApplication[]>([]);
  const [placements, setPlacements] = useState<InAppPlacement[]>([]);
  const [experiments, setExperiments] = useState<ExperimentVersionSummary[]>([]);

  const [appKey, setAppKey] = useState("");
  const [placement, setPlacement] = useState("");
  const [experimentKey, setExperimentKey] = useState("");

  const [identityMode, setIdentityMode] = useState<IdentityMode>("profile");
  const [profileId, setProfileId] = useState("p-1001");
  const [anonymousId, setAnonymousId] = useState("anon-visitor-001");
  const [lookupAttribute, setLookupAttribute] = useState("email");
  const [lookupValue, setLookupValue] = useState("tester@example.com");
  const { settings: enumSettings } = useAppEnumSettings(appKey || undefined);
  const isPresetLookupAttribute = enumSettings.lookupAttributes.includes(lookupAttribute);
  const lookupAttributeSelectValue = isPresetLookupAttribute ? lookupAttribute : CUSTOM_LOOKUP_ATTRIBUTE;

  const [contextText, setContextText] = useState("");

  const [runtimeResult, setRuntimeResult] = useState<InAppV2DecideResponse | null>(null);
  const [experimentResult, setExperimentResult] = useState<ExperimentPreviewResult | null>(null);

  useEffect(() => {
    setEnvironment(getEnvironment());
    return onEnvironmentChange(setEnvironment);
  }, []);

  useEffect(() => {
    const load = async () => {
      try {
        const [appsResponse, placementsResponse, experimentsResponse] = await Promise.all([
          apiClient.inapp.apps.list(),
          apiClient.inapp.placements.list(),
          apiClient.experiments.list({ status: "ACTIVE" })
        ]);
        setApps(appsResponse.items);
        setPlacements(placementsResponse.items);
        setExperiments(experimentsResponse.items);
        setError(null);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Failed to load playground options");
      }
    };
    void load();
  }, [environment]);

  useEffect(() => {
    if (!appKey && apps[0]) {
      setAppKey(apps[0].key);
    }
  }, [appKey, apps]);

  useEffect(() => {
    if (!placement && placements[0]) {
      setPlacement(placements[0].key);
    }
  }, [placement, placements]);

  useEffect(() => {
    if (!experimentKey && experiments[0]) {
      setExperimentKey(experiments[0].key);
    }
  }, [experimentKey, experiments]);

  useEffect(() => {
    if (contextText.trim()) {
      return;
    }
    setContextText(
      JSON.stringify({
        locale: enumSettings.locales[0] ?? "en",
        deviceType: enumSettings.deviceTypes[0] ?? "mobile",
        audiences: ["preview"]
      })
    );
  }, [contextText, enumSettings.locales, enumSettings.deviceTypes]);

  const parsedContext = useMemo(() => {
    try {
      const parsed = JSON.parse(contextText) as unknown;
      if (parsed && typeof parsed === "object") {
        return { value: parsed as Record<string, unknown>, error: null };
      }
      return { value: {}, error: null };
    } catch (jsonError) {
      return {
        value: null,
        error: jsonError instanceof Error ? jsonError.message : "Context JSON is invalid"
      };
    }
  }, [contextText]);

  const bannerPayload = useMemo(() => {
    if (mode === "runtime") {
      return runtimeResult?.payload ?? null;
    }
    return experimentResult?.preview.payload ?? null;
  }, [mode, runtimeResult, experimentResult]);

  const banner = useMemo(() => resolveBanner(bannerPayload), [bannerPayload]);

  const runPlayground = async () => {
    setLoading(true);
    try {
      if (!parsedContext.value) {
        throw new Error(parsedContext.error ?? "Context JSON is invalid");
      }

      const identity: Record<string, unknown> =
        identityMode === "profile"
          ? { profileId: profileId.trim() }
          : identityMode === "anonymous"
            ? { anonymousId: anonymousId.trim() }
            : {
                lookup: {
                  attribute: lookupAttribute.trim(),
                  value: lookupValue.trim()
                }
              };

      if (mode === "runtime") {
        const response = await apiClient.inapp.v2.decide({
          appKey: appKey.trim(),
          placement: placement.trim(),
          context: parsedContext.value,
          ...identity
        });
        setRuntimeResult(response);
        setExperimentResult(null);
        setMessage(
          response.show
            ? `Rendered runtime payload. variant=${response.tracking.variant_id} experiment=${response.tracking.experiment_id ?? "none"}`
            : `No message shown. reason=${response.debug.fallbackReason ?? "runtime filtered"}`
        );
      } else {
        if (!experimentKey.trim()) {
          throw new Error("Experiment key is required for experiment mode");
        }
        const response = await apiClient.experiments.preview(experimentKey.trim(), {
          ...identity,
          context: parsedContext.value
        });
        setExperimentResult(response as ExperimentPreviewResult);
        setRuntimeResult(null);
        setMessage(
          `Preview assignment variant=${response.preview.assignment.variantId ?? "none"} holdout=${String(response.preview.assignment.isHoldout)}`
        );
      }

      setError(null);
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "Playground run failed");
    } finally {
      setLoading(false);
    }
  };

  const sendEvent = async (eventType: "IMPRESSION" | "CLICK" | "DISMISS") => {
    if (!runtimeResult?.tracking?.campaign_id || !runtimeResult?.tracking?.message_id) {
      setError("Run runtime mode first so tracking IDs are available.");
      return;
    }

    setSendingEvent(true);
    try {
      await apiClient.inapp.v2.ingestEvent({
        eventType,
        appKey: appKey.trim(),
        placement: placement.trim(),
        tracking: {
          campaign_id: runtimeResult.tracking.campaign_id,
          message_id: runtimeResult.tracking.message_id,
          variant_id: runtimeResult.tracking.variant_id,
          ...(runtimeResult.tracking.experiment_id ? { experiment_id: runtimeResult.tracking.experiment_id } : {}),
          ...(typeof runtimeResult.tracking.experiment_version === "number"
            ? { experiment_version: runtimeResult.tracking.experiment_version }
            : {}),
          ...(typeof runtimeResult.tracking.is_holdout === "boolean" ? { is_holdout: runtimeResult.tracking.is_holdout } : {}),
          ...(runtimeResult.tracking.allocation_id ? { allocation_id: runtimeResult.tracking.allocation_id } : {})
        },
        profileId: identityMode === "profile" ? profileId.trim() : undefined,
        lookup:
          identityMode === "lookup"
            ? {
                attribute: lookupAttribute.trim(),
                value: lookupValue.trim()
              }
            : undefined,
        context: parsedContext.value ?? undefined
      });
      setMessage(`${eventType} accepted for message ${runtimeResult.tracking.message_id}.`);
      setError(null);
    } catch (ingestError) {
      setError(ingestError instanceof Error ? ingestError.message : `Failed to send ${eventType}`);
    } finally {
      setSendingEvent(false);
    }
  };

  const debugJson = useMemo(() => {
    if (mode === "runtime") {
      return runtimeResult ? toPretty(runtimeResult) : "{}";
    }
    return experimentResult ? toPretty(experimentResult) : "{}";
  }, [mode, runtimeResult, experimentResult]);

  return (
    <section className="space-y-4">
      <PageHeader
        density="compact"
        title="Experiment Playground"
        description="Run live assignments and preview what variant content looks like on a website-like surface."
        meta={`Environment: ${environment}`}
      />

      {error ? <InlineError title="Experiment playground failed" description={error} /> : null}
      {message ? <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</div> : null}

      <div className="grid gap-4 xl:grid-cols-[380px_1fr]">
        <PagePanel density="compact" className="space-y-3">
          <h3 className="text-sm font-semibold">Playground Controls</h3>

          <label className="flex flex-col gap-1 text-sm">
            Mode
            <select className={inputClassName} value={mode} onChange={(event) => setMode(event.target.value as PlaygroundMode)}>
              <option value="runtime">Runtime decide (/v2/inapp/decide)</option>
              <option value="experiment">Experiment preview (/v1/experiments/:key/preview)</option>
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            App key
            <select className={inputClassName} value={appKey} onChange={(event) => setAppKey(event.target.value)}>
              <option value="">Select app</option>
              {apps.map((item) => (
                <option key={item.id} value={item.key}>
                  {item.key}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            Placement
            <select className={inputClassName} value={placement} onChange={(event) => setPlacement(event.target.value)}>
              <option value="">Select placement</option>
              {placements.map((item) => (
                <option key={item.id} value={item.key}>
                  {item.key}
                </option>
              ))}
            </select>
          </label>

          {mode === "experiment" ? (
            <label className="flex flex-col gap-1 text-sm">
              Experiment key
              <select className={inputClassName} value={experimentKey} onChange={(event) => setExperimentKey(event.target.value)}>
                <option value="">Select experiment</option>
                {experiments.map((item) => (
                  <option key={`${item.key}:${item.version}`} value={item.key}>
                    {item.key} (v{item.version}, {item.status})
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <label className="flex flex-col gap-1 text-sm">
            Identity
            <select className={inputClassName} value={identityMode} onChange={(event) => setIdentityMode(event.target.value as IdentityMode)}>
              <option value="profile">profileId</option>
              <option value="anonymous">anonymousId</option>
              <option value="lookup">lookup</option>
            </select>
          </label>

          {identityMode === "profile" ? (
            <label className="flex flex-col gap-1 text-sm">
              Profile ID
              <input className={inputClassName} value={profileId} onChange={(event) => setProfileId(event.target.value)} />
            </label>
          ) : null}

          {identityMode === "anonymous" ? (
            <label className="flex flex-col gap-1 text-sm">
              Anonymous ID
              <input className={inputClassName} value={anonymousId} onChange={(event) => setAnonymousId(event.target.value)} />
            </label>
          ) : null}

          {identityMode === "lookup" ? (
            <>
              <label className="flex flex-col gap-1 text-sm">
                Lookup attribute
                <select
                  className={inputClassName}
                  value={lookupAttributeSelectValue}
                  onChange={(event) => {
                    const next = event.target.value;
                    if (next === CUSTOM_LOOKUP_ATTRIBUTE) {
                      if (isPresetLookupAttribute) {
                        setLookupAttribute("");
                      }
                      return;
                    }
                    setLookupAttribute(next);
                  }}
                >
                  {enumSettings.lookupAttributes.map((attribute) => (
                    <option key={attribute} value={attribute}>
                      {attribute}
                    </option>
                  ))}
                  <option value={CUSTOM_LOOKUP_ATTRIBUTE}>Custom...</option>
                </select>
                {lookupAttributeSelectValue === CUSTOM_LOOKUP_ATTRIBUTE ? (
                  <input
                    className={inputClassName}
                    value={lookupAttribute}
                    onChange={(event) => setLookupAttribute(event.target.value)}
                    placeholder="custom attribute key"
                  />
                ) : null}
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Lookup value
                <input className={inputClassName} value={lookupValue} onChange={(event) => setLookupValue(event.target.value)} />
              </label>
            </>
          ) : null}

          <label className="flex flex-col gap-1 text-sm">
            Context JSON
            <textarea
              rows={8}
              className={`${inputClassName} font-mono text-xs`}
              value={contextText}
              onChange={(event) => setContextText(event.target.value)}
            />
          </label>

          <Button size="sm" onClick={() => void runPlayground()} disabled={loading}>
            {loading ? "Running..." : "Run Playground"}
          </Button>

          <div className="space-y-2 border-t border-stone-200 pt-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-stone-600">Event simulation</p>
            <div className="flex gap-2">
              <Button size="xs" variant="outline" onClick={() => void sendEvent("IMPRESSION")} disabled={sendingEvent || mode !== "runtime"}>
                Send IMPRESSION
              </Button>
              <Button size="xs" variant="outline" onClick={() => void sendEvent("CLICK")} disabled={sendingEvent || mode !== "runtime"}>
                Send CLICK
              </Button>
              <Button size="xs" variant="outline" onClick={() => void sendEvent("DISMISS")} disabled={sendingEvent || mode !== "runtime"}>
                Send DISMISS
              </Button>
            </div>
          </div>
        </PagePanel>

        <div className="space-y-4">
          <article className="panel overflow-hidden">
            <div className="border-b border-stone-200 bg-stone-50 px-4 py-2 text-xs font-medium text-stone-600">Website preview</div>
            <div className="bg-[radial-gradient(circle_at_top_left,#fff2d6,#f7f4ed_45%,#ece6d8)] p-4">
              <div className="mx-auto max-w-5xl space-y-3 rounded-md border border-stone-200 bg-white p-3 shadow-sm">
                <header className="flex items-center justify-between border-b border-stone-100 pb-3">
                  <div className="text-lg font-semibold">Meiro Store</div>
                  <nav className="flex gap-4 text-xs text-stone-500">
                    <span>Home</span>
                    <span>Offers</span>
                    <span>Profile</span>
                  </nav>
                </header>

                {mode === "runtime" && runtimeResult && !runtimeResult.show ? (
                  <div className="rounded-lg border border-dashed border-stone-300 bg-stone-50 p-4 text-sm text-stone-600">
                    No banner rendered in runtime mode. fallbackReason: {runtimeResult.debug.fallbackReason ?? "none"}
                  </div>
                ) : null}

                {(mode !== "runtime" || runtimeResult?.show) && (bannerPayload || mode === "experiment") ? (
                  <div className={`rounded-md bg-gradient-to-r ${banner.background} p-4 text-white`}>
                    <p className="text-[11px] uppercase tracking-[0.16em] opacity-80">{banner.badge}</p>
                    <h3 className="mt-1.5 text-xl font-semibold">{banner.title}</h3>
                    <p className="mt-1.5 max-w-2xl text-sm text-white/90">{banner.body}</p>
                    <a
                      className="mt-3 inline-flex rounded-md border border-white/30 bg-white/15 px-3 py-1.5 text-sm font-medium hover:bg-white/20"
                      href={banner.ctaUrl}
                    >
                      {banner.ctaLabel}
                    </a>
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-stone-300 bg-stone-50 p-4 text-sm text-stone-600">
                    Run the playground to render a variant in this slot.
                  </div>
                )}

                <section className="grid gap-3 md:grid-cols-3">
                  {["Sneakers", "Jackets", "Accessories"].map((label) => (
                    <article key={label} className="rounded-lg border border-stone-200 bg-stone-50 p-3">
                      <div className="h-20 rounded-md bg-stone-200" />
                      <p className="mt-2 text-sm font-medium">{label}</p>
                      <p className="text-xs text-stone-500">Personalized section remains stable while testing banner variants.</p>
                    </article>
                  ))}
                </section>
              </div>
            </div>
          </article>

          <PagePanel density="compact">
            <h3 className="mb-2 text-sm font-semibold">Assignment + payload debug</h3>
            <pre className="max-h-72 overflow-auto rounded-md border border-stone-200 bg-stone-50 p-3 text-xs">{debugJson}</pre>
          </PagePanel>
        </div>
      </div>
    </section>
  );
}

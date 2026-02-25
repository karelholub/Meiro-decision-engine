import { useEffect, useState, type KeyboardEvent } from "react";
import type { DecisionDefinition } from "@decisioning/dsl";
import { getGlobalSuppressAudienceKey, onAppSettingsChange } from "../../lib/app-settings";

interface GuardrailsEditorProps {
  definition: DecisionDefinition;
  onChange: (next: DecisionDefinition) => void;
  readOnly?: boolean;
  errorByPath?: Record<string, string>;
}

const hasMarketingConsentShortcut = (definition: DecisionDefinition) => {
  return (definition.eligibility.attributes ?? []).some(
    (predicate) => predicate.field === "consent_marketing" && predicate.op === "eq" && predicate.value === true
  );
};

const hasMxEmailExistsShortcut = (definition: DecisionDefinition) => {
  return (definition.eligibility.attributes ?? []).some((predicate) => predicate.field === "mx_email" && predicate.op === "exists");
};

export function GuardrailsEditor({ definition, onChange, readOnly, errorByPath }: GuardrailsEditorProps) {
  const shortcutEnabled = hasMarketingConsentShortcut(definition);
  const mxEmailShortcutEnabled = hasMxEmailExistsShortcut(definition);
  const [globalSuppressAudienceKey, setGlobalSuppressAudienceKey] = useState("");
  const [capPerDayInput, setCapPerDayInput] = useState(definition.caps.perProfilePerDay?.toString() ?? "");
  const [capPerWeekInput, setCapPerWeekInput] = useState(definition.caps.perProfilePerWeek?.toString() ?? "");
  const [holdoutPercentageInput, setHoldoutPercentageInput] = useState(definition.holdout.percentage.toString());

  useEffect(() => {
    setCapPerDayInput(definition.caps.perProfilePerDay?.toString() ?? "");
  }, [definition.caps.perProfilePerDay]);

  useEffect(() => {
    setCapPerWeekInput(definition.caps.perProfilePerWeek?.toString() ?? "");
  }, [definition.caps.perProfilePerWeek]);

  useEffect(() => {
    setHoldoutPercentageInput(definition.holdout.percentage.toString());
  }, [definition.holdout.percentage]);

  useEffect(() => {
    setGlobalSuppressAudienceKey(getGlobalSuppressAudienceKey());
    return onAppSettingsChange((settings) => setGlobalSuppressAudienceKey(settings.globalSuppressAudienceKey));
  }, []);

  const updateHoldout = (patch: Partial<DecisionDefinition["holdout"]>) => {
    onChange({
      ...definition,
      holdout: {
        ...definition.holdout,
        ...patch
      }
    });
  };

  const updateCaps = (patch: Partial<DecisionDefinition["caps"]>) => {
    onChange({
      ...definition,
      caps: {
        ...definition.caps,
        ...patch
      }
    });
  };

  const toggleConsentShortcut = (enabled: boolean) => {
    const currentAttributes = definition.eligibility.attributes ?? [];
    const withoutShortcut = currentAttributes.filter(
      (predicate) => !(predicate.field === "consent_marketing" && predicate.op === "eq")
    );

    const nextAttributes = enabled
      ? [
          ...withoutShortcut,
          {
            field: "consent_marketing",
            op: "eq" as const,
            value: true
          }
        ]
      : withoutShortcut;

    onChange({
      ...definition,
      eligibility: {
        ...definition.eligibility,
        attributes: nextAttributes
      }
    });
  };

  const toggleMxEmailShortcut = (enabled: boolean) => {
    const currentAttributes = definition.eligibility.attributes ?? [];
    const withoutShortcut = currentAttributes.filter(
      (predicate) => !(predicate.field === "mx_email" && predicate.op === "exists")
    );
    const nextAttributes = enabled
      ? [
          ...withoutShortcut,
          {
            field: "mx_email",
            op: "exists" as const
          }
        ]
      : withoutShortcut;
    onChange({
      ...definition,
      eligibility: {
        ...definition.eligibility,
        attributes: nextAttributes
      }
    });
  };

  const globalSuppressExcluded = globalSuppressAudienceKey
    ? !(definition.eligibility.audiencesAny ?? []).includes(globalSuppressAudienceKey)
    : false;

  const toggleGlobalSuppressExclusion = (enabled: boolean) => {
    if (!globalSuppressAudienceKey) {
      return;
    }
    const audiencesAny = definition.eligibility.audiencesAny ?? [];
    if (enabled) {
      onChange({
        ...definition,
        eligibility: {
          ...definition.eligibility,
          audiencesAny: audiencesAny.filter((audience) => audience !== globalSuppressAudienceKey)
        }
      });
      return;
    }
    onChange({
      ...definition,
      eligibility: {
        ...definition.eligibility,
        audiencesAny: [...new Set([...audiencesAny, globalSuppressAudienceKey])]
      }
    });
  };

  const applyPreset = (preset: "standard_messaging" | "experiment_mode" | "no_caps") => {
    if (preset === "standard_messaging") {
      onChange({
        ...definition,
        caps: {
          ...definition.caps,
          perProfilePerDay: 1,
          perProfilePerWeek: 3
        }
      });
      return;
    }
    if (preset === "experiment_mode") {
      onChange({
        ...definition,
        holdout: {
          ...definition.holdout,
          enabled: true,
          percentage: definition.holdout.percentage > 0 ? definition.holdout.percentage : 10
        }
      });
      return;
    }
    onChange({
      ...definition,
      caps: {
        ...definition.caps,
        perProfilePerDay: null,
        perProfilePerWeek: null
      }
    });
  };

  const commitCapPerDay = () => {
    const value = capPerDayInput.trim();
    if (!value) {
      updateCaps({ perProfilePerDay: null });
      return;
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return;
    }
    updateCaps({ perProfilePerDay: parsed });
  };

  const commitCapPerWeek = () => {
    const value = capPerWeekInput.trim();
    if (!value) {
      updateCaps({ perProfilePerWeek: null });
      return;
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return;
    }
    updateCaps({ perProfilePerWeek: parsed });
  };

  const commitHoldoutPercentage = () => {
    const value = holdoutPercentageInput.trim();
    if (!value) {
      updateHoldout({ percentage: 0 });
      return;
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return;
    }
    updateHoldout({ percentage: parsed });
  };

  const commitOnEnter =
    (commit: () => void) =>
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        commit();
      }
    };

  return (
    <section className="space-y-4">
      <div className="rounded-md border border-stone-200 bg-stone-50 p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-stone-700">Presets</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => applyPreset("standard_messaging")}
            disabled={readOnly}
            className="rounded-md border border-stone-300 px-2 py-1 text-xs disabled:opacity-60"
          >
            Standard messaging safety
          </button>
          <button
            type="button"
            onClick={() => applyPreset("experiment_mode")}
            disabled={readOnly}
            className="rounded-md border border-stone-300 px-2 py-1 text-xs disabled:opacity-60"
          >
            Experiment mode
          </button>
          <button
            type="button"
            onClick={() => applyPreset("no_caps")}
            disabled={readOnly}
            className="rounded-md border border-amber-400 bg-amber-50 px-2 py-1 text-xs text-amber-900 disabled:opacity-60"
          >
            No caps (advanced)
          </button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm" data-error-path="caps.perProfilePerDay">
          Cap per profile per day
          <input
            type="number"
            min={1}
            value={capPerDayInput}
            onChange={(event) => setCapPerDayInput(event.target.value)}
            onBlur={commitCapPerDay}
            onKeyDown={commitOnEnter(commitCapPerDay)}
            disabled={readOnly}
            className="rounded-md border border-stone-300 px-2 py-1"
          />
          {errorByPath?.["caps.perProfilePerDay"] ? <span className="text-xs text-red-700">{errorByPath["caps.perProfilePerDay"]}</span> : null}
        </label>

        <label className="flex flex-col gap-1 text-sm" data-error-path="caps.perProfilePerWeek">
          Cap per profile per week
          <input
            type="number"
            min={1}
            value={capPerWeekInput}
            onChange={(event) => setCapPerWeekInput(event.target.value)}
            onBlur={commitCapPerWeek}
            onKeyDown={commitOnEnter(commitCapPerWeek)}
            disabled={readOnly}
            className="rounded-md border border-stone-300 px-2 py-1"
          />
          {errorByPath?.["caps.perProfilePerWeek"] ? (
            <span className="text-xs text-red-700">{errorByPath["caps.perProfilePerWeek"]}</span>
          ) : null}
        </label>

        <label className="flex items-center gap-2 text-sm" data-error-path="holdout.enabled">
          <input
            type="checkbox"
            checked={definition.holdout.enabled}
            onChange={(event) => updateHoldout({ enabled: event.target.checked })}
            disabled={readOnly}
          />
          Enable holdout group
        </label>

        <label className="flex flex-col gap-1 text-sm" data-error-path="holdout.percentage">
          Holdout percentage
          <input
            type="number"
            min={0}
            max={50}
            value={holdoutPercentageInput}
            onChange={(event) => setHoldoutPercentageInput(event.target.value)}
            onBlur={commitHoldoutPercentage}
            onKeyDown={commitOnEnter(commitHoldoutPercentage)}
            disabled={readOnly}
            className="rounded-md border border-stone-300 px-2 py-1"
          />
          {errorByPath?.["holdout.percentage"] ? (
            <span className="text-xs text-red-700">{errorByPath["holdout.percentage"]}</span>
          ) : null}
        </label>

        <label className="flex flex-col gap-1 text-sm md:col-span-2" data-error-path="holdout.salt">
          Holdout salt
          <input
            value={definition.holdout.salt}
            onChange={(event) => updateHoldout({ salt: event.target.value })}
            disabled={readOnly}
            className="rounded-md border border-stone-300 px-2 py-1 font-mono"
          />
        </label>
      </div>

      <div className="rounded-md border border-stone-200 bg-stone-50 p-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={shortcutEnabled}
            onChange={(event) => toggleConsentShortcut(event.target.checked)}
            disabled={readOnly}
          />
          Require `consent_marketing = true` shortcut
        </label>
        <p className="mt-1 text-xs text-stone-600">Adds/removes an eligibility condition without editing JSON.</p>
        <label className="mt-2 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={mxEmailShortcutEnabled}
            onChange={(event) => toggleMxEmailShortcut(event.target.checked)}
            disabled={readOnly}
          />
          Require `mx_email exists` shortcut
        </label>
        {globalSuppressAudienceKey ? (
          <label className="mt-2 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={globalSuppressExcluded}
              onChange={(event) => toggleGlobalSuppressExclusion(event.target.checked)}
              disabled={readOnly}
            />
            Exclude `{globalSuppressAudienceKey}` audience
          </label>
        ) : null}
      </div>

      <div className="rounded-md border border-stone-200 p-3">
        <h4 className="font-semibold text-sm">Safety checklist</h4>
        <ul className="mt-2 space-y-1 text-xs text-stone-700">
          <li>{definition.holdout.enabled ? "[x]" : "[ ]"} Holdout configured for experimentation</li>
          <li>{definition.caps.perProfilePerDay || definition.caps.perProfilePerWeek ? "[x]" : "[ ]"} Caps configured</li>
          <li>{definition.outputs.default ? "[x]" : "[ ]"} Default output configured</li>
        </ul>
      </div>
    </section>
  );
}

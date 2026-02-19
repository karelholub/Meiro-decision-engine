import type { DecisionDefinition } from "@decisioning/dsl";

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

export function GuardrailsEditor({ definition, onChange, readOnly, errorByPath }: GuardrailsEditorProps) {
  const shortcutEnabled = hasMarketingConsentShortcut(definition);

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

  return (
    <section className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm" data-error-path="caps.perProfilePerDay">
          Cap per profile per day
          <input
            type="number"
            min={1}
            value={definition.caps.perProfilePerDay ?? ""}
            onChange={(event) => updateCaps({ perProfilePerDay: event.target.value ? Number(event.target.value) : null })}
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
            value={definition.caps.perProfilePerWeek ?? ""}
            onChange={(event) => updateCaps({ perProfilePerWeek: event.target.value ? Number(event.target.value) : null })}
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
            value={definition.holdout.percentage}
            onChange={(event) => updateHoldout({ percentage: Number(event.target.value) || 0 })}
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

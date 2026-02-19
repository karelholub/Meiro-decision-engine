import { useMemo, useState } from "react";
import type { AttributePredicate, FlowRule } from "@decisioning/dsl";
import { ActionTemplatePicker } from "./ActionTemplatePicker";
import { ConditionBuilder } from "./ConditionBuilder";
import type { FieldRegistryItem } from "./types";
import {
  attributesToConditionNode,
  attributesToConditionRows,
  conditionNodeToAttributes,
  conditionRowsToAttributes,
  createDefaultRule,
  normalizeRulePriorities,
  reorderRules
} from "./wizard-utils";

interface RuleListBuilderProps {
  rules: FlowRule[];
  onChange: (rules: FlowRule[]) => void;
  registry: FieldRegistryItem[];
  readOnly?: boolean;
  errorByPath?: Record<string, string>;
}

export function RuleListBuilder({ rules, onChange, registry, readOnly, errorByPath }: RuleListBuilderProps) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const normalized = useMemo(() => normalizeRulePriorities(rules), [rules]);

  const applyRules = (nextRules: FlowRule[]) => {
    onChange(normalizeRulePriorities(nextRules));
  };

  const updateRule = (index: number, patch: Partial<FlowRule>) => {
    applyRules(normalized.map((rule, ruleIndex) => (ruleIndex === index ? { ...rule, ...patch } : rule)));
  };

  const removeRule = (index: number) => {
    applyRules(normalized.filter((_rule, ruleIndex) => ruleIndex !== index));
  };

  const addRule = () => {
    applyRules([...normalized, createDefaultRule(normalized.length + 1)]);
  };

  const moveRule = (index: number, direction: -1 | 1) => {
    const next = index + direction;
    applyRules(reorderRules(normalized, index, next));
  };

  const updateWhenAttributes = (index: number, attributes: AttributePredicate[]) => {
    updateRule(index, {
      when: attributesToConditionNode(attributes)
    });
  };

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Rule cards</h3>
        <button
          type="button"
          onClick={addRule}
          disabled={readOnly}
          className="rounded-md bg-ink px-3 py-2 text-sm text-white disabled:opacity-60"
        >
          Add rule
        </button>
      </div>
      <p className="text-xs text-stone-600">
        Rules are evaluated by card order. Drag cards or use move buttons to change priority.
      </p>

      {normalized.length === 0 ? <p className="text-sm text-stone-500">At least one rule is required.</p> : null}

      <div className="space-y-3">
        {normalized.map((rule, index) => {
          const ruleErrors = Object.entries(errorByPath ?? {}).filter(([path]) => path.startsWith(`flow.rules.${index}`));
          const whenDecoded = conditionNodeToAttributes(rule.when);
          const whenRows = attributesToConditionRows(whenDecoded.attributes, registry);

          return (
            <article
              key={rule.id || `${index}`}
              draggable={!readOnly}
              onDragStart={() => setDragIndex(index)}
              onDragOver={(event) => {
                event.preventDefault();
              }}
              onDrop={() => {
                if (dragIndex === null) {
                  return;
                }
                applyRules(reorderRules(normalized, dragIndex, index));
                setDragIndex(null);
              }}
              className="rounded-lg border border-stone-200 bg-white p-4"
            >
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-xs uppercase tracking-wide text-stone-500">Rule #{index + 1}</p>
                  <p className="font-semibold">Priority {rule.priority}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => moveRule(index, -1)}
                    disabled={readOnly || index === 0}
                    className="rounded-md border border-stone-300 px-2 py-1 text-xs disabled:opacity-60"
                  >
                    Move up
                  </button>
                  <button
                    type="button"
                    onClick={() => moveRule(index, 1)}
                    disabled={readOnly || index === normalized.length - 1}
                    className="rounded-md border border-stone-300 px-2 py-1 text-xs disabled:opacity-60"
                  >
                    Move down
                  </button>
                  <button
                    type="button"
                    onClick={() => removeRule(index)}
                    disabled={readOnly || normalized.length === 1}
                    className="rounded-md border border-stone-300 px-2 py-1 text-xs disabled:opacity-60"
                  >
                    Remove
                  </button>
                </div>
              </div>

              <label className="mb-3 flex flex-col gap-1 text-xs" data-error-path={`flow.rules.${index}.id`}>
                Rule id
                <div className="flex gap-2">
                  <input
                    value={rule.id}
                    onChange={(event) => updateRule(index, { id: event.target.value })}
                    disabled={readOnly}
                    className="w-full rounded-md border border-stone-300 px-2 py-1 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => updateRule(index, { id: `rule-${Date.now()}` })}
                    disabled={readOnly}
                    className="rounded-md border border-stone-300 px-2 py-1"
                  >
                    Regenerate
                  </button>
                </div>
              </label>

              <div className="space-y-3 rounded-md border border-stone-200 p-3">
                <h4 className="text-sm font-semibold">IF (optional)</h4>
                {!whenDecoded.supported ? (
                  <p className="text-xs text-amber-700">This rule has advanced conditions. Edit in Advanced JSON.</p>
                ) : null}
                <ConditionBuilder
                  rows={whenRows}
                  onChange={(rows) => {
                    const attributes = conditionRowsToAttributes(rows, registry);
                    updateWhenAttributes(index, attributes);
                  }}
                  registry={registry}
                  readOnly={readOnly || !whenDecoded.supported}
                  errorByPath={errorByPath}
                  pathPrefix={`flow.rules.${index}.when.conditions`}
                />
              </div>

              <div className="mt-3 space-y-3 rounded-md border border-stone-200 p-3">
                <h4 className="text-sm font-semibold">THEN (required)</h4>
                <ActionTemplatePicker
                  value={rule.then}
                  onChange={(then) => updateRule(index, { then })}
                  readOnly={readOnly}
                  errorByPath={errorByPath}
                  pathPrefix={`flow.rules.${index}.then`}
                />
              </div>

              {ruleErrors.length > 0 ? (
                <ul className="mt-3 space-y-1 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">
                  {ruleErrors.map(([path, message]) => (
                    <li key={path}>
                      {path}: {message}
                    </li>
                  ))}
                </ul>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}

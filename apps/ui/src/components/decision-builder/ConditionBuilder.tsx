import { useState } from "react";
import type { AttributeOperator } from "@decisioning/dsl";
import { FieldPicker } from "./FieldPicker";
import type { ConditionRow, FieldRegistryItem } from "./types";
import {
  COMMON_CONDITION_CHIPS,
  conditionRowFromCommonChip,
  createConditionRow,
  getFieldByName,
  getOperatorsForFieldType
} from "./wizard-utils";

interface ConditionBuilderProps {
  title?: string;
  rows: ConditionRow[];
  onChange: (rows: ConditionRow[]) => void;
  registry: FieldRegistryItem[];
  readOnly?: boolean;
  errorByPath?: Record<string, string>;
  pathPrefix: string;
  sampleValueLookup?: Record<string, unknown[]>;
}

const opLabel: Record<AttributeOperator, string> = {
  eq: "equals",
  neq: "does not equal",
  gt: "greater than",
  gte: "greater than or equals",
  lt: "less than",
  lte: "less than or equals",
  in: "in list",
  contains: "contains",
  exists: "exists"
};

const prettyValue = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) {
    return "(empty)";
  }
  return trimmed;
};

const toNaturalLanguage = (row: ConditionRow, label: string) => {
  if (row.op === "exists") {
    return `${label} exists`;
  }
  return `${label} ${opLabel[row.op]} ${prettyValue(row.value)}`;
};

export function ConditionBuilder({
  title,
  rows,
  onChange,
  registry,
  readOnly,
  errorByPath,
  pathPrefix,
  sampleValueLookup
}: ConditionBuilderProps) {
  const [chipWarning, setChipWarning] = useState<string | null>(null);

  const updateRow = (index: number, patch: Partial<ConditionRow>) => {
    const next = rows.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row));
    onChange(next);
  };

  const removeRow = (index: number) => {
    onChange(rows.filter((_row, rowIndex) => rowIndex !== index));
  };

  const addRow = () => {
    const fallbackField = registry.find((item) => item.common) ?? registry[0];
    if (!fallbackField) {
      onChange([...rows, createConditionRow()]);
      return;
    }
    const operators = getOperatorsForFieldType(fallbackField.dataType);
    const op = operators[0] ?? "exists";
    const value = op === "exists" ? "" : String(fallbackField.sampleValues?.[0] ?? "");
    onChange([...rows, createConditionRow({ field: fallbackField.field, op, value })]);
  };

  const applyChip = (chipId: string) => {
    const row = conditionRowFromCommonChip(chipId, registry);
    if (!row) {
      const missing = COMMON_CONDITION_CHIPS.find((chip) => chip.id === chipId)?.field ?? chipId;
      setChipWarning(`Field '${missing}' is not available in this environment registry.`);
      return;
    }
    onChange([...rows, row]);
    setChipWarning(null);
  };

  return (
    <section className="space-y-3">
      {title ? <h4 className="font-semibold text-sm">{title}</h4> : null}
      <p className="text-xs text-stone-600">
        Builder supports AND conditions in this version. Advanced grouping (OR/nested groups) is coming soon.
      </p>
      <p className="text-xs text-stone-500">Examples: `purchase_count eq 0`, `email exists`, `country in US,JP`.</p>
      <div className="space-y-1">
        <p className="text-xs font-medium text-stone-700">Common conditions</p>
        <div className="flex flex-wrap gap-1">
          {COMMON_CONDITION_CHIPS.map((chip) => (
            <button
              key={chip.id}
              type="button"
              onClick={() => applyChip(chip.id)}
              disabled={readOnly}
              className="rounded-full border border-stone-300 bg-white px-2 py-1 text-xs hover:bg-stone-100 disabled:opacity-60"
            >
              {chip.label}
            </button>
          ))}
        </div>
        {chipWarning ? <p className="text-xs text-amber-700">{chipWarning}</p> : null}
      </div>

      <div className="space-y-3">
        {rows.length === 0 ? <p className="text-xs text-stone-500">No conditions yet.</p> : null}
        {rows.map((row, index) => {
          const fieldMeta = getFieldByName(row.field, registry);
          const allowedOperators = getOperatorsForFieldType(fieldMeta?.dataType ?? "string");
          const currentOp = allowedOperators.includes(row.op) ? row.op : allowedOperators[0] ?? "eq";
          const fieldError = errorByPath?.[`${pathPrefix}.${index}.field`];
          const opError = errorByPath?.[`${pathPrefix}.${index}.op`];
          const valueError = errorByPath?.[`${pathPrefix}.${index}.value`];

          return (
            <article key={row.id} className="rounded-md border border-stone-200 p-3">
              <div className="grid gap-3 lg:grid-cols-[2fr_1fr_1fr_auto]">
                <div data-error-path={`${pathPrefix}.${index}.field`}>
                  <p className="mb-1 text-xs font-medium">Field</p>
                  <FieldPicker
                    value={row.field}
                    onChange={(field) => {
                      const nextType = getFieldByName(field, registry)?.dataType ?? "string";
                      const nextOps = getOperatorsForFieldType(nextType);
                      const nextOp = nextOps[0] ?? "eq";
                      updateRow(index, {
                        field,
                        op: nextOps.includes(row.op) ? row.op : nextOp,
                        value: nextOp === "exists" ? "" : row.value
                      });
                    }}
                    registry={registry}
                    disabled={readOnly}
                    error={fieldError}
                    sampleValueLookup={sampleValueLookup}
                  />
                </div>

                <label className="flex flex-col gap-1 text-xs" data-error-path={`${pathPrefix}.${index}.op`}>
                  Operator
                  <select
                    value={currentOp}
                    onChange={(event) => {
                      const nextOp = event.target.value as AttributeOperator;
                      updateRow(index, { op: nextOp, value: nextOp === "exists" ? "" : row.value });
                    }}
                    disabled={readOnly}
                    className="rounded-md border border-stone-300 px-2 py-1"
                  >
                    {allowedOperators.map((operator) => (
                      <option key={operator} value={operator}>
                        {operator}
                      </option>
                    ))}
                  </select>
                  {opError ? <span className="text-red-700">{opError}</span> : null}
                </label>

                <label className="flex flex-col gap-1 text-xs" data-error-path={`${pathPrefix}.${index}.value`}>
                  Value
                  {currentOp === "exists" ? (
                    <div className="rounded-md border border-dashed border-stone-300 px-2 py-2 text-stone-500">Not required</div>
                  ) : (
                    <input
                      value={row.value}
                      onChange={(event) => updateRow(index, { value: event.target.value })}
                      disabled={readOnly}
                      className="rounded-md border border-stone-300 px-2 py-1"
                      placeholder={currentOp === "in" ? "US, CA" : "value"}
                    />
                  )}
                  {valueError ? <span className="text-red-700">{valueError}</span> : null}
                </label>

                <div className="flex items-start justify-end">
                  <button
                    type="button"
                    onClick={() => removeRow(index)}
                    disabled={readOnly}
                    className="rounded-md border border-stone-300 px-2 py-1 text-xs"
                  >
                    Remove
                  </button>
                </div>
              </div>

              <p className="mt-2 rounded-md bg-stone-100 px-2 py-1 text-xs text-stone-700">
                {toNaturalLanguage(row, fieldMeta?.label ?? row.field ?? "Field")}
              </p>
            </article>
          );
        })}
      </div>

      <button
        type="button"
        onClick={addRow}
        disabled={readOnly}
        className="rounded-md bg-ink px-3 py-2 text-sm text-white disabled:opacity-60"
      >
        Add condition
      </button>
    </section>
  );
}

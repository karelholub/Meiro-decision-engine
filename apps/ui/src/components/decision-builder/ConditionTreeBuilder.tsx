import type { AttributeOperator, AttributePredicate, ConditionNode } from "@decisioning/dsl";
import { FieldPicker } from "./FieldPicker";
import type { ConditionRow, FieldRegistryItem } from "./types";
import {
  attributesToConditionRows,
  conditionRowsToAttributes,
  createConditionRow,
  getFieldByName,
  getOperatorsForFieldType
} from "./wizard-utils";

interface ConditionTreeBuilderProps {
  value: ConditionNode | undefined;
  onChange: (node: ConditionNode | undefined) => void;
  registry: FieldRegistryItem[];
  readOnly?: boolean;
  errorByPath?: Record<string, string>;
  pathPrefix: string;
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

const predicateToRow = (predicate: AttributePredicate, registry: FieldRegistryItem[]): ConditionRow => {
  return attributesToConditionRows([predicate], registry)[0] ?? createConditionRow({ field: predicate.field, op: predicate.op });
};

const rowToPredicate = (row: ConditionRow, registry: FieldRegistryItem[]): AttributePredicate => {
  return conditionRowsToAttributes([row], registry)[0] ?? { field: row.field, op: row.op };
};

const defaultPredicateNode = (registry: FieldRegistryItem[]): ConditionNode => {
  const fallbackField = registry.find((item) => item.common) ?? registry[0];
  if (!fallbackField) {
    return {
      type: "predicate",
      predicate: { field: "attribute", op: "exists" }
    };
  }
  const operators = getOperatorsForFieldType(fallbackField.dataType);
  const op = operators[0] ?? "exists";
  const row = createConditionRow({
    field: fallbackField.field,
    op,
    value: op === "exists" ? "" : String(fallbackField.sampleValues?.[0] ?? "")
  });
  return {
    type: "predicate",
    predicate: rowToPredicate(row, registry)
  };
};

const defaultGroupNode = (registry: FieldRegistryItem[], operator: "all" | "any" = "all"): ConditionNode => ({
  type: "group",
  operator,
  conditions: [defaultPredicateNode(registry)]
});

const describePredicate = (predicate: AttributePredicate, registry: FieldRegistryItem[]) => {
  const field = getFieldByName(predicate.field, registry);
  if (predicate.op === "exists") {
    return `${field?.label ?? predicate.field} exists`;
  }
  return `${field?.label ?? predicate.field} ${opLabel[predicate.op]} ${String(predicate.value ?? "")}`;
};

function PredicateEditor({
  node,
  onChange,
  onRemove,
  registry,
  readOnly,
  errorByPath,
  pathPrefix,
  canRemove
}: {
  node: Extract<ConditionNode, { type: "predicate" }>;
  onChange: (node: ConditionNode) => void;
  onRemove?: () => void;
  registry: FieldRegistryItem[];
  readOnly?: boolean;
  errorByPath?: Record<string, string>;
  pathPrefix: string;
  canRemove?: boolean;
}) {
  const row = predicateToRow(node.predicate, registry);
  const fieldMeta = getFieldByName(row.field, registry);
  const allowedOperators = getOperatorsForFieldType(fieldMeta?.dataType ?? "string");
  const currentOp = allowedOperators.includes(row.op) ? row.op : allowedOperators[0] ?? "eq";

  const updateRow = (patch: Partial<ConditionRow>) => {
    const nextRow = { ...row, ...patch };
    onChange({
      type: "predicate",
      predicate: rowToPredicate(nextRow, registry)
    });
  };

  return (
    <article className="rounded-md border border-stone-200 p-3">
      <div className="grid gap-3 lg:grid-cols-[2fr_1fr_1fr_auto]">
        <div data-error-path={`${pathPrefix}.predicate.field`}>
          <p className="mb-1 text-xs font-medium">Field</p>
          <FieldPicker
            value={row.field}
            onChange={(field) => {
              const nextType = getFieldByName(field, registry)?.dataType ?? "string";
              const nextOps = getOperatorsForFieldType(nextType);
              const nextOp = nextOps.includes(row.op) ? row.op : nextOps[0] ?? "exists";
              updateRow({
                field,
                op: nextOp,
                value: nextOp === "exists" ? "" : row.value
              });
            }}
            registry={registry}
            disabled={readOnly}
            error={errorByPath?.[`${pathPrefix}.predicate.field`]}
          />
        </div>

        <label className="flex flex-col gap-1 text-xs" data-error-path={`${pathPrefix}.predicate.op`}>
          Operator
          <select
            value={currentOp}
            onChange={(event) => {
              const nextOp = event.target.value as AttributeOperator;
              updateRow({ op: nextOp, value: nextOp === "exists" ? "" : row.value });
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
        </label>

        <label className="flex flex-col gap-1 text-xs" data-error-path={`${pathPrefix}.predicate.value`}>
          Value
          {currentOp === "exists" ? (
            <div className="rounded-md border border-dashed border-stone-300 px-2 py-2 text-stone-500">Not required</div>
          ) : (
            <input
              value={row.value}
              onChange={(event) => updateRow({ value: event.target.value })}
              disabled={readOnly}
              className="rounded-md border border-stone-300 px-2 py-1"
              placeholder={currentOp === "in" ? "US, CA" : "value"}
            />
          )}
        </label>

        <div className="flex items-start justify-end">
          {canRemove ? (
            <button type="button" onClick={onRemove} disabled={readOnly} className="rounded-md border border-stone-300 px-2 py-1 text-xs">
              Remove
            </button>
          ) : null}
        </div>
      </div>
      <p className="mt-2 rounded-md bg-stone-100 px-2 py-1 text-xs text-stone-700">{describePredicate(node.predicate, registry)}</p>
    </article>
  );
}

function NodeEditor({
  node,
  onChange,
  onRemove,
  registry,
  readOnly,
  errorByPath,
  pathPrefix,
  depth = 0,
  canRemove
}: {
  node: ConditionNode;
  onChange: (node: ConditionNode) => void;
  onRemove?: () => void;
  registry: FieldRegistryItem[];
  readOnly?: boolean;
  errorByPath?: Record<string, string>;
  pathPrefix: string;
  depth?: number;
  canRemove?: boolean;
}) {
  if (node.type === "predicate") {
    return (
      <PredicateEditor
        node={node}
        onChange={onChange}
        onRemove={onRemove}
        registry={registry}
        readOnly={readOnly}
        errorByPath={errorByPath}
        pathPrefix={pathPrefix}
        canRemove={canRemove}
      />
    );
  }

  const updateChild = (index: number, child: ConditionNode) => {
    onChange({
      ...node,
      conditions: node.conditions.map((current, childIndex) => (childIndex === index ? child : current))
    });
  };

  const removeChild = (index: number) => {
    const nextConditions = node.conditions.filter((_child, childIndex) => childIndex !== index);
    if (nextConditions.length === 0) {
      onRemove?.();
      return;
    }
    onChange({
      ...node,
      conditions: nextConditions
    });
  };

  return (
    <article className="space-y-3 rounded-md border border-stone-200 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-xs">
          Match
          <select
            value={node.operator}
            onChange={(event) => onChange({ ...node, operator: event.target.value as "all" | "any" })}
            disabled={readOnly}
            className="rounded-md border border-stone-300 px-2 py-1"
          >
            <option value="all">all conditions (AND)</option>
            <option value="any">any condition (OR)</option>
          </select>
        </label>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onChange({ ...node, conditions: [...node.conditions, defaultPredicateNode(registry)] })}
            disabled={readOnly}
            className="rounded-md border border-stone-300 px-2 py-1 text-xs"
          >
            Add condition
          </button>
          <button
            type="button"
            onClick={() => onChange({ ...node, conditions: [...node.conditions, defaultGroupNode(registry, "any")] })}
            disabled={readOnly || depth >= 3}
            className="rounded-md border border-stone-300 px-2 py-1 text-xs disabled:opacity-60"
          >
            Add OR group
          </button>
          {canRemove ? (
            <button type="button" onClick={onRemove} disabled={readOnly} className="rounded-md border border-stone-300 px-2 py-1 text-xs">
              Remove group
            </button>
          ) : null}
        </div>
      </div>

      <div className="space-y-2 border-l-2 border-stone-200 pl-3">
        {node.conditions.map((child, index) => (
          <NodeEditor
            key={`${pathPrefix}.conditions.${index}:${child.type}`}
            node={child}
            onChange={(nextChild) => updateChild(index, nextChild)}
            onRemove={() => removeChild(index)}
            registry={registry}
            readOnly={readOnly}
            errorByPath={errorByPath}
            pathPrefix={`${pathPrefix}.conditions.${index}`}
            depth={depth + 1}
            canRemove={node.conditions.length > 1}
          />
        ))}
      </div>
    </article>
  );
}

export function ConditionTreeBuilder({ value, onChange, registry, readOnly, errorByPath, pathPrefix }: ConditionTreeBuilderProps) {
  if (!value) {
    return (
      <section className="space-y-2">
        <p className="text-xs text-stone-600">No IF condition means this rule can match any eligible profile.</p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onChange(defaultPredicateNode(registry))}
            disabled={readOnly}
            className="rounded-md border border-stone-300 px-3 py-2 text-sm disabled:opacity-60"
          >
            Add condition
          </button>
          <button
            type="button"
            onClick={() => onChange(defaultGroupNode(registry, "any"))}
            disabled={readOnly}
            className="rounded-md border border-stone-300 px-3 py-2 text-sm disabled:opacity-60"
          >
            Add OR group
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-2">
      <p className="text-xs text-stone-600">Build AND/OR groups visually. JSON mode remains available for unsupported custom condition shapes.</p>
      <NodeEditor
        node={value}
        onChange={onChange}
        onRemove={() => onChange(undefined)}
        registry={registry}
        readOnly={readOnly}
        errorByPath={errorByPath}
        pathPrefix={pathPrefix}
      />
      <button type="button" onClick={() => onChange(undefined)} disabled={readOnly} className="rounded-md border border-stone-300 px-2 py-1 text-xs">
        Clear IF condition
      </button>
    </section>
  );
}

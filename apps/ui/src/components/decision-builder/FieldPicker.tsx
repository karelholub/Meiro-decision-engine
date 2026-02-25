import { useMemo, useState } from "react";
import type { FieldRegistryItem } from "./types";

interface FieldPickerProps {
  value: string;
  onChange: (nextField: string) => void;
  registry: FieldRegistryItem[];
  disabled?: boolean;
  error?: string;
  sampleValueLookup?: Record<string, unknown[]>;
}

const formatSamples = (values: unknown[] | undefined) => {
  if (!values || values.length === 0) {
    return "";
  }
  return values.map((value) => JSON.stringify(value)).join(", ");
};

export function FieldPicker({ value, onChange, registry, disabled, error, sampleValueLookup }: FieldPickerProps) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const search = query.trim().toLowerCase();
    if (!search) {
      return registry;
    }
    return registry.filter((item) => {
      return item.field.toLowerCase().includes(search) || item.label.toLowerCase().includes(search);
    });
  }, [query, registry]);

  const commonFields = useMemo(() => filtered.filter((item) => item.common), [filtered]);

  return (
    <div className="space-y-2">
      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search fields"
        className="w-full rounded-md border border-stone-300 px-2 py-1 text-sm"
        disabled={disabled}
      />

      {commonFields.length > 0 ? (
        <div className="space-y-1">
          <p className="text-xs font-medium text-stone-700">Common fields</p>
          <div className="flex flex-wrap gap-1">
            {commonFields.map((item) => (
              <button
                key={`common-${item.field}`}
                type="button"
                onClick={() => onChange(item.field)}
                disabled={disabled}
                className={`rounded-full border px-2 py-1 text-xs ${
                  value === item.field ? "border-ink bg-ink text-white" : "border-stone-300 bg-white"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="space-y-1">
        <p className="text-xs font-medium text-stone-700">All fields</p>
        <div className="max-h-40 overflow-auto rounded-md border border-stone-200 bg-stone-50">
        {filtered.map((item) => {
          const sampleValues = sampleValueLookup?.[item.field] ?? item.sampleValues;
          return (
            <button
              key={item.field}
              type="button"
              onClick={() => onChange(item.field)}
              disabled={disabled}
              className={`block w-full border-b border-stone-200 px-2 py-2 text-left text-xs last:border-b-0 ${
                value === item.field ? "bg-stone-200" : "hover:bg-stone-100"
              }`}
            >
              <p className="font-medium text-ink">{item.label}</p>
              <p className="font-mono text-stone-700">{item.field}</p>
              <p className="text-stone-600">type: {item.dataType}</p>
              {sampleValues && sampleValues.length > 0 ? <p className="text-stone-500">samples: {formatSamples(sampleValues)}</p> : null}
            </button>
          );
        })}
        </div>
      </div>

      <label className="flex flex-col gap-1 text-xs">
        Technical field
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          className="rounded-md border border-stone-300 px-2 py-1 font-mono"
          placeholder="profile.attribute"
        />
      </label>

      {error ? <p className="text-xs text-red-700">{error}</p> : null}
    </div>
  );
}

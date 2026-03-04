"use client";

import { useMemo, useState } from "react";
import type { Ref, RefType } from "@decisioning/shared";
import { useRegistry, type RegistryListItem } from "../../lib/registry";
import { StatusBadge } from "../ui/status-badges";

type RefSelectProps = {
  type: RefType;
  value: Ref | null;
  onChange: (value: Ref | null) => void;
  filter?: { status?: "DRAFT" | "ACTIVE" | "PAUSED" | "ARCHIVED" | "PENDING_APPROVAL" | "UNKNOWN"; appKey?: string };
  allowClear?: boolean;
  allowVersionPin?: boolean;
  disabled?: boolean;
  placeholder?: string;
};

export function RefSelect({
  type,
  value,
  onChange,
  filter,
  allowClear = true,
  allowVersionPin = false,
  disabled,
  placeholder
}: RefSelectProps) {
  const registry = useRegistry();
  const [query, setQuery] = useState("");

  const options = useMemo(() => registry.search(type, query, filter), [registry, type, query, filter?.status, filter?.appKey]);
  const selected = value ? registry.get(value) : null;

  const byKey = useMemo(() => {
    if (!value?.key) {
      return [] as RegistryListItem[];
    }
    return registry.list(type).filter((item) => item.key === value.key).sort((a, b) => (b.version ?? 0) - (a.version ?? 0));
  }, [registry, type, value?.key]);

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={placeholder ?? `Search ${type}`}
          className="w-full rounded-md border border-stone-300 px-2 py-1 text-sm"
          disabled={disabled}
        />
        {allowClear ? (
          <button type="button" className="rounded-md border border-stone-300 px-2 py-1 text-xs" onClick={() => onChange(null)} disabled={disabled || !value}>
            Clear
          </button>
        ) : null}
      </div>

      <select
        className="w-full rounded-md border border-stone-300 px-2 py-1 text-sm"
        value={value ? `${value.key}@@${value.version ?? ""}` : ""}
        onChange={(event) => {
          const [nextKey, nextVersionRaw] = event.target.value.split("@@");
          if (!nextKey) {
            onChange(null);
            return;
          }
          const nextVersion = Number.parseInt(nextVersionRaw ?? "", 10);
          onChange({
            type,
            key: nextKey,
            ...(Number.isFinite(nextVersion) ? { version: nextVersion } : {})
          });
        }}
        disabled={disabled}
      >
        <option value="">Select {type}</option>
        {options.map((item) => (
          <option key={`${item.key}:${item.version ?? 0}:${item.status}`} value={`${item.key}@@${item.version ?? ""}`}>
            {item.name} ({item.key}) [{item.status}] {item.version ? `v${item.version}` : ""}
          </option>
        ))}
      </select>

      {allowVersionPin && value?.key ? (
        <select
          className="w-full rounded-md border border-stone-300 px-2 py-1 text-sm"
          value={value.version ?? ""}
          onChange={(event) => {
            const nextVersion = Number.parseInt(event.target.value, 10);
            onChange({
              type,
              key: value.key,
              ...(Number.isFinite(nextVersion) ? { version: nextVersion } : {})
            });
          }}
          disabled={disabled}
        >
          <option value="">Pin latest active</option>
          {byKey.map((item) => (
            <option key={`${item.key}:${item.version ?? 0}`} value={item.version ?? ""}>
              {item.version ? `v${item.version}` : "latest"} [{item.status}]
            </option>
          ))}
        </select>
      ) : null}

      {selected ? (
        <div className="flex items-center gap-2 text-xs text-stone-600">
          <span>{selected.name} ({selected.key})</span>
          {selected.status !== "UNKNOWN" ? <StatusBadge status={selected.status} /> : null}
          {selected.version ? <span>v{selected.version}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { apiClient, type MeiroMcpSegment } from "../../lib/api";
import { inputClassName } from "../ui/page";

type MeiroSegmentPickerProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
};

export function MeiroSegmentPicker({ value, onChange, placeholder = "Meiro segment id", disabled }: MeiroSegmentPickerProps) {
  const datalistId = useId();
  const [segments, setSegments] = useState<MeiroMcpSegment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await apiClient.meiro.mcp.segments();
        if (!cancelled) {
          setSegments(response.items);
        }
      } catch (loadError) {
        if (!cancelled) {
          setSegments([]);
          setError(loadError instanceof Error ? loadError.message : "Meiro segments unavailable");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const selected = useMemo(() => segments.find((segment) => segment.id === value || segment.key === value) ?? null, [segments, value]);

  return (
    <div>
      <input
        className={inputClassName}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        list={datalistId}
        placeholder={loading ? "Loading Meiro segments..." : placeholder}
        disabled={disabled}
      />
      <datalist id={datalistId}>
        {segments.map((segment) => (
          <option key={segment.id} value={segment.id}>
            {segment.name}
          </option>
        ))}
      </datalist>
      {selected ? (
        <p className="mt-1 truncate text-xs text-stone-600">
          {selected.name}
          {selected.customerCount !== null && selected.customerCount !== undefined ? ` · ${selected.customerCount.toLocaleString()} customers` : ""}
        </p>
      ) : error ? (
        <p className="mt-1 text-xs text-amber-700">{error}</p>
      ) : segments.length > 0 ? (
        <p className="mt-1 text-xs text-stone-500">Pick a Meiro segment id or type a known audience key.</p>
      ) : null}
    </div>
  );
}

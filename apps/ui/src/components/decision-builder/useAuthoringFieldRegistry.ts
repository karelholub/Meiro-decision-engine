import { useEffect, useMemo, useState } from "react";
import type { WbsMappingAttributeRule } from "@decisioning/shared";
import { apiClient } from "../../lib/api";
import { fieldRegistry as fallbackFieldRegistry } from "./field-registry";
import type { FieldDataType, FieldRegistryItem } from "./types";

const inferType = (mapping: WbsMappingAttributeRule): FieldDataType => {
  if (mapping.transform === "coerceNumber") {
    return "number";
  }
  if (mapping.transform === "takeAll") {
    return "array";
  }
  if (typeof mapping.defaultValue === "number") {
    return "number";
  }
  if (typeof mapping.defaultValue === "boolean") {
    return "boolean";
  }
  if (Array.isArray(mapping.defaultValue)) {
    return "array";
  }
  return "string";
};

const humanize = (value: string) =>
  value
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (char) => char.toUpperCase());

const mergeRegistries = (base: FieldRegistryItem[], mapped: FieldRegistryItem[]) => {
  const byField = new Map<string, FieldRegistryItem>();
  for (const item of base) {
    byField.set(item.field, item);
  }
  for (const item of mapped) {
    byField.set(item.field, {
      ...byField.get(item.field),
      ...item,
      common: byField.get(item.field)?.common ?? item.common
    });
  }
  return [...byField.values()].sort((left, right) => Number(Boolean(right.common)) - Number(Boolean(left.common)) || left.label.localeCompare(right.label));
};

export function useAuthoringFieldRegistry() {
  const [mappedFields, setMappedFields] = useState<FieldRegistryItem[]>([]);
  const [sourceLabel, setSourceLabel] = useState("Built-in profile fields");

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const response = await apiClient.settings.getWbsMapping();
        const item = response.item;
        const mapping = item?.mappingJson;
        if (!mapping) {
          if (!cancelled) {
            setMappedFields([]);
            setSourceLabel("Built-in profile fields");
          }
          return;
        }

        const fields = mapping.attributeMappings.map((entry) => ({
          field: entry.targetKey,
          label: humanize(entry.targetKey),
          dataType: inferType(entry),
          common: false,
          sampleValues: entry.defaultValue === undefined ? undefined : [entry.defaultValue]
        }));

        if (!cancelled) {
          setMappedFields(fields);
          setSourceLabel(`${item.name} WBS mapping`);
        }
      } catch {
        if (!cancelled) {
          setMappedFields([]);
          setSourceLabel("Built-in profile fields");
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const registry = useMemo(() => mergeRegistries(fallbackFieldRegistry, mappedFields), [mappedFields]);

  return {
    registry,
    sourceLabel,
    mappedFieldCount: mappedFields.length
  };
}

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

const inferMeiroType = (dataType: string): FieldDataType => {
  const normalized = dataType.toLowerCase();
  if (normalized === "int" || normalized === "float" || normalized === "number") {
    return "number";
  }
  if (normalized === "bool" || normalized === "boolean") {
    return "boolean";
  }
  if (normalized === "compound" || normalized.includes("array")) {
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
  const [meiroFields, setMeiroFields] = useState<FieldRegistryItem[]>([]);
  const [prismFields, setPrismFields] = useState<FieldRegistryItem[]>([]);
  const [prismAudiences, setPrismAudiences] = useState<Array<{ id: string; name: string }>>([]);
  const [prismAudienceCount, setPrismAudienceCount] = useState(0);
  const [audienceSourceLabel, setAudienceSourceLabel] = useState("Prism audiences");
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

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const status = await apiClient.pipes.prismStatus();
        if (status.sourceMode === "meiro_mcp") {
          const [attributes, segments] = await Promise.all([
            apiClient.meiro.mcp.attributes(),
            apiClient.meiro.mcp.segments()
          ]);
          if (cancelled) {
            return;
          }
          setMeiroFields(
            attributes.items.map((attribute) => ({
              field: attribute.id,
              label: attribute.name,
              dataType: inferMeiroType(attribute.dataType),
              description: attribute.description ?? undefined,
              common: false
            }))
          );
          setPrismFields([]);
          setPrismAudiences(segments.items.map((segment) => ({ id: String(segment.id), name: segment.name })));
          setPrismAudienceCount(segments.items.length);
          setAudienceSourceLabel("Meiro MCP segments");
          return;
        }

        const response = await apiClient.pipes.prismFieldRegistry();
        if (cancelled) {
          return;
        }
        setMeiroFields([]);
        setPrismFields(
          response.attributes.map((attribute) => ({
            field: attribute.field,
            label: attribute.label,
            dataType: attribute.dataType,
            description: attribute.description,
            common: false
          }))
        );
        setPrismAudiences(response.audiences.map((audience) => ({ id: audience.id, name: audience.name })));
        setPrismAudienceCount(response.counts.audiences);
        setAudienceSourceLabel("Prism audiences");
      } catch {
        if (!cancelled) {
          setMeiroFields([]);
          setPrismFields([]);
          setPrismAudiences([]);
          setPrismAudienceCount(0);
          setAudienceSourceLabel("Prism audiences");
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const registry = useMemo(
    () => mergeRegistries(mergeRegistries(mergeRegistries(fallbackFieldRegistry, mappedFields), meiroFields), prismFields),
    [mappedFields, meiroFields, prismFields]
  );

  const sourceParts = [sourceLabel];
  if (meiroFields.length > 0) sourceParts.push("Meiro CDP attributes");
  if (prismFields.length > 0) sourceParts.push("Prism snapshot");

  return {
    registry,
    sourceLabel: sourceParts.join(" + "),
    mappedFieldCount: mappedFields.length + meiroFields.length + prismFields.length,
    prismAudiences,
    prismAudienceCount,
    audienceSourceLabel
  };
}

import type { ExperimentDefinition } from "@decisioning/shared";
import type { ConditionRow } from "../../../../components/decision-builder/types";
import { createUuid } from "../../../../components/decision-builder/wizard-utils";

export interface ExperimentDraftForm {
  key: string;
  name: string;
  description?: string;
  status?: "DRAFT" | "ACTIVE" | "PAUSED" | "ARCHIVED";
  scope: {
    appKey: string;
    placements: string[];
    channels: Array<"inapp" | "web" | "app">;
  };
  population: {
    audiencesAny: string[];
    attributes: ConditionRow[];
  };
  assignment: {
    unit: "profileId" | "anonymousId" | "stitching_id";
    salt: string;
    stickinessMode: "ttl" | "static";
    ttlSeconds?: number;
  };
  variants: Array<{
    id: string;
    weight: number;
    treatment: {
      type: "inapp_message";
      contentBlock: { key: string; version?: number };
      offer?: { key: string; version?: number };
      tags: string[];
    };
  }>;
  holdout: {
    enabled: boolean;
    percentage: number;
    behavior: "noop";
  };
  schedule: {
    startAt?: string;
    endAt?: string;
  };
  advancedExtras?: Record<string, unknown>;
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

const toStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0).map((entry) => entry.trim());
};

const toNumber = (value: unknown, fallback: number) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
};

const omitKeys = (source: Record<string, unknown>, known: Set<string>): Record<string, unknown> => {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (!known.has(key)) {
      result[key] = value;
    }
  }
  return result;
};

const hasAnyData = (value: unknown): boolean => {
  if (value === undefined || value === null) {
    return false;
  }
  if (Array.isArray(value)) {
    return value.some((entry) => hasAnyData(entry));
  }
  if (isRecord(value)) {
    return Object.values(value).some((entry) => hasAnyData(entry));
  }
  return true;
};

export const hasAdvancedOnlyFields = (extras: Record<string, unknown> | undefined): boolean => hasAnyData(extras);

const defaultVariantId = (index: number) => String.fromCharCode(65 + index) || `V${index + 1}`;

const defaultVariants = () => [
  {
    id: "A",
    weight: 50,
    treatment: {
      type: "inapp_message" as const,
      contentBlock: { key: "" },
      tags: []
    }
  },
  {
    id: "B",
    weight: 50,
    treatment: {
      type: "inapp_message" as const,
      contentBlock: { key: "" },
      tags: []
    }
  }
];

export const createEmptyExperimentForm = (): ExperimentDraftForm => ({
  key: "",
  name: "",
  description: "",
  status: "DRAFT",
  scope: {
    appKey: "",
    placements: [],
    channels: ["inapp"]
  },
  population: {
    audiencesAny: [],
    attributes: []
  },
  assignment: {
    unit: "profileId",
    salt: createUuid(),
    stickinessMode: "ttl",
    ttlSeconds: 30 * 24 * 60 * 60
  },
  variants: defaultVariants(),
  holdout: {
    enabled: false,
    percentage: 0,
    behavior: "noop"
  },
  schedule: {},
  advancedExtras: undefined
});

const deepMerge = (base: unknown, extras: unknown): unknown => {
  if (Array.isArray(base) && Array.isArray(extras)) {
    return base.map((entry, index) => deepMerge(entry, extras[index]));
  }
  if (isRecord(base) && isRecord(extras)) {
    const merged: Record<string, unknown> = { ...base };
    for (const [key, value] of Object.entries(extras)) {
      if (key in merged) {
        merged[key] = deepMerge(merged[key], value);
      } else {
        merged[key] = value;
      }
    }
    return merged;
  }
  return extras === undefined ? base : extras;
};

const toConditionRows = (attributes: unknown): ConditionRow[] => {
  if (!Array.isArray(attributes)) {
    return [];
  }
  return attributes
    .map((entry, index) => {
      const row = isRecord(entry) ? entry : {};
      const field = typeof row.field === "string" ? row.field : "";
      const op = typeof row.op === "string" ? row.op : "exists";
      const rawValue = row.value;
      return {
        id: `condition-${index}`,
        field,
        op: op as ConditionRow["op"],
        value:
          rawValue === undefined
            ? ""
            : typeof rawValue === "string"
              ? rawValue
              : JSON.stringify(rawValue)
      };
    })
    .filter((row) => row.field.trim().length > 0);
};

export const experimentJsonToForm = (json: unknown): ExperimentDraftForm => {
  const root = isRecord(json) ? json : {};

  const scope = isRecord(root.scope) ? root.scope : {};
  const population = isRecord(root.population) ? root.population : {};
  const eligibility = isRecord(population.eligibility) ? population.eligibility : {};
  const assignment = isRecord(root.assignment) ? root.assignment : {};
  const stickiness = isRecord(assignment.stickiness) ? assignment.stickiness : {};
  const holdout = isRecord(root.holdout) ? root.holdout : {};
  const activation = isRecord(root.activation) ? root.activation : {};

  const variantsRaw = Array.isArray(root.variants) ? root.variants : [];
  const variants = variantsRaw
    .map((entry, index) => {
      const variant = isRecord(entry) ? entry : {};
      const treatment = isRecord(variant.treatment) ? variant.treatment : {};
      const contentVersion = toNumber(treatment.contentVersion, NaN);
      const offerVersion = toNumber(treatment.offerVersion, NaN);
      return {
        id: typeof variant.id === "string" && variant.id.trim().length > 0 ? variant.id : defaultVariantId(index),
        weight: toNumber(variant.weight, 0),
        treatment: {
          type: "inapp_message" as const,
          contentBlock: {
            key: typeof treatment.contentKey === "string" ? treatment.contentKey : "",
            ...(Number.isFinite(contentVersion) ? { version: contentVersion } : {})
          },
          ...(typeof treatment.offerKey === "string"
            ? {
                offer: {
                  key: treatment.offerKey,
                  ...(Number.isFinite(offerVersion) ? { version: offerVersion } : {})
                }
              }
            : {}),
          tags: toStringArray(treatment.tags)
        }
      };
    })
    .filter((variant) => variant.id.trim().length > 0);

  const topExtras = omitKeys(root, new Set(["schemaVersion", "key", "scope", "population", "assignment", "variants", "holdout", "activation"]));
  const scopeExtras = omitKeys(scope, new Set(["appKey", "placements", "channels"]));
  const populationExtras = omitKeys(population, new Set(["eligibility"]));
  const eligibilityExtras = omitKeys(eligibility, new Set(["audiencesAny", "attributes"]));
  const assignmentExtras = omitKeys(assignment, new Set(["unit", "salt", "stickiness", "weights"]));
  const stickinessExtras = omitKeys(stickiness, new Set(["mode", "ttl_seconds"]));
  const holdoutExtras = omitKeys(holdout, new Set(["enabled", "percentage", "behavior"]));
  const activationExtras = omitKeys(activation, new Set(["startAt", "endAt"]));

  const variantExtras = variantsRaw.map((entry) => {
    const variant = isRecord(entry) ? entry : {};
    const treatment = isRecord(variant.treatment) ? variant.treatment : {};
    const variantUnknown = omitKeys(variant, new Set(["id", "weight", "treatment"]));
    const treatmentUnknown = omitKeys(treatment, new Set(["type", "contentKey", "offerKey", "tags", "contentVersion", "offerVersion"]));
    if (hasAnyData(treatmentUnknown)) {
      variantUnknown.treatment = treatmentUnknown;
    }
    return variantUnknown;
  });

  const advancedExtras: Record<string, unknown> = {
    ...topExtras,
    ...(hasAnyData(scopeExtras) ? { scope: scopeExtras } : {}),
    ...(hasAnyData(populationExtras) || hasAnyData(eligibilityExtras)
      ? {
          population: {
            ...(hasAnyData(populationExtras) ? populationExtras : {}),
            ...(hasAnyData(eligibilityExtras) ? { eligibility: eligibilityExtras } : {})
          }
        }
      : {}),
    ...(hasAnyData(assignmentExtras) || hasAnyData(stickinessExtras)
      ? {
          assignment: {
            ...(hasAnyData(assignmentExtras) ? assignmentExtras : {}),
            ...(hasAnyData(stickinessExtras) ? { stickiness: stickinessExtras } : {})
          }
        }
      : {}),
    ...(hasAnyData(holdoutExtras) ? { holdout: holdoutExtras } : {}),
    ...(hasAnyData(activationExtras) ? { activation: activationExtras } : {}),
    ...(variantExtras.some((entry) => hasAnyData(entry)) ? { variants: variantExtras } : {})
  };

  return {
    key: typeof root.key === "string" ? root.key : "",
    name: "",
    description: "",
    status: undefined,
    scope: {
      appKey: typeof scope.appKey === "string" ? scope.appKey : "",
      placements: toStringArray(scope.placements),
      channels: toStringArray(scope.channels).filter((entry): entry is "inapp" | "web" | "app" => ["inapp", "web", "app"].includes(entry))
    },
    population: {
      audiencesAny: toStringArray(eligibility.audiencesAny),
      attributes: toConditionRows(eligibility.attributes)
    },
    assignment: {
      unit:
        assignment.unit === "anonymousId" || assignment.unit === "stitching_id"
          ? assignment.unit
          : "profileId",
      salt: typeof assignment.salt === "string" && assignment.salt.trim().length > 0 ? assignment.salt : createUuid(),
      stickinessMode: stickiness.mode === "static" ? "static" : "ttl",
      ttlSeconds: toNumber(stickiness.ttl_seconds, 30 * 24 * 60 * 60)
    },
    variants: variants.length > 0 ? variants : defaultVariants(),
    holdout: {
      enabled: Boolean(holdout.enabled),
      percentage: toNumber(holdout.percentage, 0),
      behavior: "noop"
    },
    schedule: {
      ...(typeof activation.startAt === "string" ? { startAt: activation.startAt } : {}),
      ...(typeof activation.endAt === "string" ? { endAt: activation.endAt } : {})
    },
    advancedExtras: hasAdvancedOnlyFields(advancedExtras) ? advancedExtras : undefined
  };
};

export const conditionRowsToExperimentAttributes = (rows: ConditionRow[]) =>
  rows
    .filter((row) => row.field.trim().length > 0)
    .map((row) => {
      if (row.op === "exists") {
        return {
          field: row.field.trim(),
          op: row.op
        };
      }
      let parsedValue: unknown = row.value;
      try {
        parsedValue = JSON.parse(row.value);
      } catch {
        if (row.value === "true") {
          parsedValue = true;
        } else if (row.value === "false") {
          parsedValue = false;
        } else {
          const asNumber = Number(row.value);
          parsedValue = Number.isFinite(asNumber) && row.value.trim() !== "" ? asNumber : row.value;
        }
      }

      return {
        field: row.field.trim(),
        op: row.op,
        value: parsedValue
      };
    });

export const formToExperimentJson = (form: ExperimentDraftForm): ExperimentDefinition & Record<string, unknown> => {
  const base: Record<string, unknown> = {
    schemaVersion: "experiment.v1",
    key: form.key.trim(),
    scope: {
      ...(form.scope.appKey.trim() ? { appKey: form.scope.appKey.trim() } : {}),
      placements: form.scope.placements,
      channels: form.scope.channels
    },
    population: {
      eligibility: {
        audiencesAny: form.population.audiencesAny,
        attributes: conditionRowsToExperimentAttributes(form.population.attributes)
      }
    },
    assignment: {
      unit: form.assignment.unit,
      salt: form.assignment.salt.trim() || createUuid(),
      stickiness: {
        mode: form.assignment.stickinessMode,
        ...(form.assignment.stickinessMode === "ttl" ? { ttl_seconds: form.assignment.ttlSeconds ?? 30 * 24 * 60 * 60 } : {})
      },
      weights: "static"
    },
    variants: form.variants.map((variant, index) => {
      const baseVariant: Record<string, unknown> = {
        id: variant.id || defaultVariantId(index),
        weight: Number(variant.weight) || 0,
        treatment: {
          type: "inapp_message",
          contentKey: variant.treatment.contentBlock.key,
          ...(variant.treatment.contentBlock.version ? { contentVersion: variant.treatment.contentBlock.version } : {}),
          ...(variant.treatment.offer?.key ? { offerKey: variant.treatment.offer.key } : {}),
          ...(variant.treatment.offer?.version ? { offerVersion: variant.treatment.offer.version } : {}),
          tags: variant.treatment.tags
        }
      };

      const variantExtras =
        Array.isArray(form.advancedExtras?.variants) && isRecord(form.advancedExtras.variants[index])
          ? (form.advancedExtras.variants[index] as Record<string, unknown>)
          : undefined;
      return deepMerge(baseVariant, variantExtras);
    }),
    holdout: {
      enabled: form.holdout.enabled,
      percentage: form.holdout.percentage,
      behavior: "noop"
    },
    activation: {
      ...(form.schedule.startAt ? { startAt: form.schedule.startAt } : {}),
      ...(form.schedule.endAt ? { endAt: form.schedule.endAt } : {})
    }
  };

  const extrasWithoutVariants = isRecord(form.advancedExtras)
    ? Object.fromEntries(Object.entries(form.advancedExtras).filter(([key]) => key !== "variants"))
    : undefined;

  return deepMerge(base, extrasWithoutVariants) as ExperimentDefinition & Record<string, unknown>;
};

export const getWeightsSum = (variants: ExperimentDraftForm["variants"]) =>
  variants.reduce((sum, variant) => sum + (Number.isFinite(variant.weight) ? variant.weight : 0), 0);

export const normalizeWeights = (variants: ExperimentDraftForm["variants"]): ExperimentDraftForm["variants"] => {
  if (variants.length === 0) {
    return variants;
  }
  const total = getWeightsSum(variants);
  if (total <= 0) {
    const even = Math.floor(100 / variants.length);
    const remainder = 100 - even * variants.length;
    return variants.map((variant, index) => ({
      ...variant,
      weight: even + (index < remainder ? 1 : 0)
    }));
  }

  const raw = variants.map((variant) => (variant.weight / total) * 100);
  const rounded = raw.map((value) => Math.floor(value));
  let remainder = 100 - rounded.reduce((sum, value) => sum + value, 0);
  const order = raw
    .map((value, index) => ({ index, frac: value - Math.floor(value) }))
    .sort((a, b) => b.frac - a.frac);
  for (const candidate of order) {
    if (remainder <= 0) {
      break;
    }
    rounded[candidate.index] = (rounded[candidate.index] ?? 0) + 1;
    remainder -= 1;
  }

  return variants.map((variant, index) => ({ ...variant, weight: rounded[index] ?? 0 }));
};

export const applyWeightPreset = (preset: "ab_50_50" | "abc_33" | "80_20"): ExperimentDraftForm["variants"] => {
  if (preset === "ab_50_50") {
    return [
      { id: "A", weight: 50, treatment: { type: "inapp_message", contentBlock: { key: "" }, tags: [] } },
      { id: "B", weight: 50, treatment: { type: "inapp_message", contentBlock: { key: "" }, tags: [] } }
    ];
  }
  if (preset === "80_20") {
    return [
      { id: "A", weight: 80, treatment: { type: "inapp_message", contentBlock: { key: "" }, tags: [] } },
      { id: "B", weight: 20, treatment: { type: "inapp_message", contentBlock: { key: "" }, tags: [] } }
    ];
  }
  return [
    { id: "A", weight: 34, treatment: { type: "inapp_message", contentBlock: { key: "" }, tags: [] } },
    { id: "B", weight: 33, treatment: { type: "inapp_message", contentBlock: { key: "" }, tags: [] } },
    { id: "C", weight: 33, treatment: { type: "inapp_message", contentBlock: { key: "" }, tags: [] } }
  ];
};

export const toDateTimeLocalInput = (iso: string | null | undefined): string => {
  if (!iso) {
    return "";
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60 * 1000);
  return local.toISOString().slice(0, 16);
};

export const fromDateTimeLocalInput = (value: string | undefined): string | undefined => {
  if (!value || !value.trim()) {
    return undefined;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }
  return parsed.toISOString();
};

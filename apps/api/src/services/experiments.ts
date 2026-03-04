import type { Environment, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { sha256 } from "../lib/cacheKey";

const operatorSchema = z.enum(["eq", "neq", "gt", "gte", "lt", "lte", "in", "contains", "exists"]);

const experimentAttributePredicateSchema = z
  .object({
    field: z.string().min(1),
    op: operatorSchema,
    value: z.unknown().optional()
  })
  .passthrough();

const experimentVariantSchema = z
  .object({
    id: z.string().min(1),
    weight: z.number().nonnegative(),
    treatment: z
      .object({
        type: z.literal("inapp_message"),
        contentKey: z.string().min(1),
        offerKey: z.string().min(1).optional(),
        tags: z.array(z.string()).optional()
      })
      .passthrough()
  })
  .passthrough();

export const experimentSpecSchema = z
  .object({
    schemaVersion: z.literal("experiment.v1"),
    key: z.string().min(1),
    scope: z
      .object({
        appKey: z.string().optional(),
        placements: z.array(z.string().min(1)).optional(),
        channels: z.array(z.string().min(1)).optional()
      })
      .passthrough()
      .default({}),
    population: z
      .object({
        eligibility: z
          .object({
            audiencesAny: z.array(z.string().min(1)).optional(),
            attributes: z.array(experimentAttributePredicateSchema).optional()
          })
          .passthrough()
          .optional()
      })
      .passthrough()
      .optional(),
    assignment: z
      .object({
        unit: z.enum(["profileId", "anonymousId", "stitching_id"]),
        salt: z.string().min(1),
        stickiness: z
          .object({
            mode: z.enum(["ttl", "static"]).default("ttl"),
            ttl_seconds: z.number().int().positive().optional()
          })
          .passthrough()
          .optional(),
        weights: z.literal("static").optional()
      })
      .passthrough(),
    variants: z.array(experimentVariantSchema).min(1),
    holdout: z
      .object({
        enabled: z.boolean(),
        percentage: z.number().min(0).max(100),
        behavior: z.enum(["noop"]).optional()
      })
      .passthrough()
      .optional(),
    activation: z
      .object({
        startAt: z.string().datetime().optional(),
        endAt: z.string().datetime().optional()
      })
      .passthrough()
      .optional()
  })
  .passthrough()
  .superRefine((value, ctx) => {
    const seenIds = new Set<string>();
    for (const [index, variant] of value.variants.entries()) {
      if (seenIds.has(variant.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["variants", index, "id"],
          message: "Variant ids must be unique"
        });
      }
      seenIds.add(variant.id);
    }

    if (value.variants.some((variant) => variant.weight < 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["variants"],
        message: "Variant weights must be non-negative"
      });
    }

    if (value.scope.channels?.includes("inapp") && (!value.scope.placements || value.scope.placements.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["scope", "placements"],
        message: "placements must be provided for in-app experiments"
      });
    }

    const startAt = value.activation?.startAt ? new Date(value.activation.startAt) : null;
    const endAt = value.activation?.endAt ? new Date(value.activation.endAt) : null;
    if (startAt && endAt && startAt.getTime() >= endAt.getTime()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["activation", "endAt"],
        message: "activation.startAt must be before activation.endAt"
      });
    }
  });

export type ExperimentSpec = z.infer<typeof experimentSpecSchema>;

export interface ExperimentAssignmentResult {
  variantId: string | null;
  isHoldout: boolean;
  allocationId: string;
  bucketInfo: {
    unitHash: string;
    timeBucket: string;
    bucket: number;
    variantBucket: number;
  };
}

const safeGet = (source: Record<string, unknown>, path: string): unknown => {
  return path.split(".").reduce<unknown>((current, segment) => {
    if (!segment) {
      return current;
    }
    if (current && typeof current === "object" && !Array.isArray(current)) {
      return (current as Record<string, unknown>)[segment];
    }
    return undefined;
  }, source);
};

const evaluatePredicate = (input: { fieldValue: unknown; op: z.infer<typeof operatorSchema>; expected?: unknown }): boolean => {
  const { fieldValue, op, expected } = input;

  if (op === "exists") {
    return fieldValue !== undefined && fieldValue !== null;
  }
  if (op === "eq") {
    return fieldValue === expected;
  }
  if (op === "neq") {
    return fieldValue !== expected;
  }
  if (op === "gt" || op === "gte" || op === "lt" || op === "lte") {
    if (typeof fieldValue !== "number" || typeof expected !== "number") {
      return false;
    }
    if (op === "gt") return fieldValue > expected;
    if (op === "gte") return fieldValue >= expected;
    if (op === "lt") return fieldValue < expected;
    return fieldValue <= expected;
  }
  if (op === "in") {
    if (!Array.isArray(expected)) {
      return false;
    }
    return expected.some((entry) => entry === fieldValue);
  }
  if (op === "contains") {
    if (Array.isArray(fieldValue)) {
      return fieldValue.some((entry) => entry === expected);
    }
    if (typeof fieldValue === "string" && typeof expected === "string") {
      return fieldValue.includes(expected);
    }
    return false;
  }

  return false;
};

const deterministicBucket01 = (seed: string): number => {
  const digest = sha256(seed).slice(0, 8);
  const numeric = Number.parseInt(digest, 16);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return (numeric % 10000) / 10000;
};

const resolveTimeBucket = (spec: ExperimentSpec, now: Date): string => {
  const mode = spec.assignment.stickiness?.mode ?? "ttl";
  if (mode === "static") {
    return "static";
  }

  const ttl = spec.assignment.stickiness?.ttl_seconds ?? 30 * 24 * 60 * 60;
  if (!Number.isFinite(ttl) || ttl <= 0) {
    return "static";
  }
  return String(Math.floor(Math.floor(now.getTime() / 1000) / ttl));
};

export const chooseVariant = (spec: ExperimentSpec, unitValue: string, now: Date): ExperimentAssignmentResult => {
  const timeBucket = resolveTimeBucket(spec, now);
  const unitHash = sha256(unitValue);
  const bucket = deterministicBucket01(`${spec.assignment.salt}:${unitHash}:${timeBucket}`);
  const allocationId = sha256(`${spec.key}:${unitHash}:${timeBucket}`).slice(0, 20);

  const holdoutPct = spec.holdout?.enabled ? Math.max(0, Math.min(100, spec.holdout.percentage)) : 0;
  const holdoutThreshold = holdoutPct / 100;
  if (holdoutThreshold > 0 && bucket < holdoutThreshold) {
    return {
      variantId: null,
      isHoldout: true,
      allocationId,
      bucketInfo: {
        unitHash,
        timeBucket,
        bucket,
        variantBucket: 0
      }
    };
  }

  const variantBucket = holdoutThreshold > 0 ? (bucket - holdoutThreshold) / (1 - holdoutThreshold) : bucket;
  const totalWeight = spec.variants.reduce((sum, variant) => sum + variant.weight, 0);
  const normalizedTotal = totalWeight > 0 ? totalWeight : spec.variants.length;

  let cursor = 0;
  let selected = spec.variants[0]?.id ?? null;
  for (const variant of spec.variants) {
    const weight = totalWeight > 0 ? variant.weight : 1;
    const next = cursor + weight / normalizedTotal;
    if (variantBucket <= next || variant === spec.variants[spec.variants.length - 1]) {
      selected = variant.id;
      break;
    }
    cursor = next;
  }

  return {
    variantId: selected,
    isHoldout: false,
    allocationId,
    bucketInfo: {
      unitHash,
      timeBucket,
      bucket,
      variantBucket
    }
  };
};

export const evaluateEligibilityForExperiment = (input: {
  spec: ExperimentSpec;
  profile?: {
    audiences?: string[];
    attributes?: Record<string, unknown>;
  };
  audiences?: string[];
  context?: Record<string, unknown>;
}): boolean => {
  const eligibility = input.spec.population?.eligibility;
  if (!eligibility) {
    return true;
  }

  const audiences = new Set([...(input.profile?.audiences ?? []), ...(input.audiences ?? [])]);
  if (Array.isArray(eligibility.audiencesAny) && eligibility.audiencesAny.length > 0) {
    if (!eligibility.audiencesAny.some((audience) => audiences.has(audience))) {
      return false;
    }
  }

  const source: Record<string, unknown> = {
    ...(input.profile?.attributes ?? {}),
    ...(input.context ?? {})
  };

  if (Array.isArray(eligibility.attributes)) {
    for (const predicate of eligibility.attributes) {
      const fieldValue = safeGet(source, predicate.field);
      if (!evaluatePredicate({ fieldValue, op: predicate.op, expected: predicate.value })) {
        return false;
      }
    }
  }

  return true;
};

const toStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
};

export const serializeExperimentSummary = (item: {
  id: string;
  environment: Environment;
  key: string;
  version: number;
  status: string;
  name: string;
  description: string | null;
  experimentJson: unknown;
  updatedAt: Date;
  activatedAt: Date | null;
  startAt: Date | null;
  endAt: Date | null;
}) => {
  const parsed = experimentSpecSchema.safeParse(item.experimentJson);
  const placements = parsed.success ? toStringArray(parsed.data.scope.placements) : [];
  const appKey = parsed.success && typeof parsed.data.scope.appKey === "string" ? parsed.data.scope.appKey : null;

  return {
    id: item.id,
    environment: item.environment,
    key: item.key,
    version: item.version,
    status: item.status,
    name: item.name,
    description: item.description,
    updatedAt: item.updatedAt.toISOString(),
    activatedAt: item.activatedAt?.toISOString() ?? null,
    startAt: item.startAt?.toISOString() ?? null,
    endAt: item.endAt?.toISOString() ?? null,
    appKey,
    placements
  };
};

export const loadActiveExperiment = async (input: {
  prisma: PrismaClient;
  environment: Environment;
  key: string;
}): Promise<{
  id: string;
  key: string;
  version: number;
  status: string;
  name: string;
  description: string | null;
  experimentJson: ExperimentSpec;
  startAt: Date | null;
  endAt: Date | null;
} | null> => {
  const row = await (input.prisma as any).experimentVersion.findFirst({
    where: {
      environment: input.environment,
      key: input.key,
      status: "ACTIVE"
    },
    orderBy: { version: "desc" }
  });

  if (!row) {
    return null;
  }

  const parsed = experimentSpecSchema.safeParse(row.experimentJson);
  if (!parsed.success) {
    return null;
  }

  return {
    id: row.id,
    key: row.key,
    version: row.version,
    status: row.status,
    name: row.name,
    description: row.description,
    experimentJson: parsed.data,
    startAt: row.startAt,
    endAt: row.endAt
  };
};

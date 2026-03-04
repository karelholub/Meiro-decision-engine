import { z } from "zod";

export const DecisionStatusSchema = z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]);
export type DecisionStatus = z.infer<typeof DecisionStatusSchema>;

export const ActionTypeSchema = z.enum(["noop", "personalize", "message", "suppress", "experiment"]);
export type ActionType = z.infer<typeof ActionTypeSchema>;

export const OutcomeSchema = z.enum(["ELIGIBLE", "IN_HOLDOUT", "CAPPED", "NOT_ELIGIBLE", "ERROR"]);
export type Outcome = z.infer<typeof OutcomeSchema>;

export const AttributeOperatorSchema = z.enum([
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "in",
  "contains",
  "exists"
]);
export type AttributeOperator = z.infer<typeof AttributeOperatorSchema>;

export const AttributePredicateSchema = z.object({
  field: z.string().min(1),
  op: AttributeOperatorSchema,
  value: z.unknown().optional()
});
export type AttributePredicate = z.infer<typeof AttributePredicateSchema>;

export type ConditionNode =
  | {
      type: "predicate";
      predicate: AttributePredicate;
    }
  | {
      type: "group";
      operator: "all" | "any";
      conditions: ConditionNode[];
    };

export const ConditionNodeSchema: z.ZodType<ConditionNode> = z.lazy(() =>
  z.union([
    z.object({
      type: z.literal("predicate"),
      predicate: AttributePredicateSchema
    }),
    z.object({
      type: z.literal("group"),
      operator: z.enum(["all", "any"]),
      conditions: z.array(ConditionNodeSchema).min(1)
    })
  ])
);

export const DecisionOutputSchema = z.object({
  actionType: ActionTypeSchema,
  payload: z.record(z.unknown()).default({}),
  templateVars: z.record(z.string()).optional()
});
export type DecisionOutput = z.infer<typeof DecisionOutputSchema>;

export const FlowRuleSchema = z.object({
  id: z.string().min(1),
  priority: z.number().int().nonnegative(),
  when: ConditionNodeSchema.optional(),
  then: DecisionOutputSchema,
  else: DecisionOutputSchema.optional()
});
export type FlowRule = z.infer<typeof FlowRuleSchema>;

export const HoldoutSchema = z.object({
  enabled: z.boolean().default(false),
  percentage: z.number().min(0).max(50).default(0),
  salt: z.string().min(1)
});
export type HoldoutConfig = z.infer<typeof HoldoutSchema>;

export const EligibilitySchema = z.object({
  audiencesAll: z.array(z.string()).optional(),
  audiencesAny: z.array(z.string()).optional(),
  audiencesNone: z.array(z.string()).optional(),
  attributes: z.array(AttributePredicateSchema).optional(),
  consent: z
    .object({
      requiredConsents: z.array(z.string()).optional()
    })
    .optional()
});
export type Eligibility = z.infer<typeof EligibilitySchema>;

export const CapsSchema = z.object({
  perProfilePerDay: z.number().int().positive().nullable().optional(),
  perProfilePerWeek: z.number().int().positive().nullable().optional()
});
export type Caps = z.infer<typeof CapsSchema>;

export const PoliciesConfigSchema = z.object({
  requiredConsents: z.array(z.string()).optional(),
  payloadAllowlist: z.array(z.string()).optional(),
  redactKeys: z.array(z.string()).optional()
});
export type PoliciesConfig = z.infer<typeof PoliciesConfigSchema>;

export const WritebackConfigSchema = z.object({
  enabled: z.boolean(),
  mode: z.enum(["label", "attribute"]),
  key: z.string().min(1),
  ttlDays: z.number().int().positive().optional()
});
export type WritebackConfig = z.infer<typeof WritebackConfigSchema>;

export const ReasonSchema = z.object({
  code: z.string().min(1),
  detail: z.string().optional()
});
export type Reason = z.infer<typeof ReasonSchema>;

export const DecisionPerformanceSchema = z.object({
  timeoutMs: z.number().int().min(20).max(5000).optional(),
  wbsTimeoutMs: z.number().int().min(10).max(4000).optional(),
  requiredAttributesOverride: z.array(z.string().min(1)).optional(),
  requiredContextKeysOverride: z.array(z.string().min(1)).optional()
});
export type DecisionPerformance = z.infer<typeof DecisionPerformanceSchema>;

export const DecisionCachePolicyModeSchema = z.enum([
  "disabled",
  "normal",
  "stale_if_error",
  "stale_while_revalidate"
]);
export type DecisionCachePolicyMode = z.infer<typeof DecisionCachePolicyModeSchema>;

export const DecisionCachePolicySchema = z.object({
  mode: DecisionCachePolicyModeSchema.optional(),
  ttlSeconds: z.number().int().min(1).max(86_400).optional(),
  staleTtlSeconds: z.number().int().min(0).max(604_800).optional(),
  keyContextAllowlist: z.array(z.string().min(1)).optional()
});
export type DecisionCachePolicy = z.infer<typeof DecisionCachePolicySchema>;

export const DecisionFallbackActionSchema = z.object({
  actionType: ActionTypeSchema,
  payload: z.record(z.unknown()).default({}),
  ttl_seconds: z.number().int().positive().max(86_400).optional(),
  tracking: z.record(z.unknown()).optional()
});
export type DecisionFallbackAction = z.infer<typeof DecisionFallbackActionSchema>;

export const DecisionFallbackConfigSchema = z.object({
  preferStaleCache: z.boolean().optional(),
  onTimeout: DecisionFallbackActionSchema.optional(),
  onError: DecisionFallbackActionSchema.optional(),
  defaultOutput: z.string().min(1).optional()
});
export type DecisionFallbackConfig = z.infer<typeof DecisionFallbackConfigSchema>;

export const DecisionDefinitionSchema = z.object({
  id: z.string().uuid(),
  key: z.string().regex(/^[a-zA-Z0-9_-]+$/),
  name: z.string().min(1),
  description: z.string().default(""),
  status: DecisionStatusSchema,
  version: z.number().int().positive(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  activatedAt: z.string().datetime().nullable().optional(),
  holdout: HoldoutSchema,
  eligibility: EligibilitySchema.default({}),
  requiredAttributes: z.array(z.string().min(1)).optional(),
  performance: DecisionPerformanceSchema.optional(),
  cachePolicy: DecisionCachePolicySchema.optional(),
  fallback: DecisionFallbackConfigSchema.optional(),
  caps: CapsSchema.default({}),
  policies: PoliciesConfigSchema.optional(),
  writeback: WritebackConfigSchema.optional(),
  flow: z.object({
    rules: z.array(FlowRuleSchema).min(1)
  }),
  outputs: z
    .object({
      default: DecisionOutputSchema.optional()
    })
    .catchall(DecisionOutputSchema)
    .default({})
});
export type DecisionDefinition = z.infer<typeof DecisionDefinitionSchema>;

export const StackWhenSchema = z
  .object({
    op: z.enum(["eq", "neq", "exists"]),
    left: z.string().min(1),
    right: z.string().optional()
  })
  .superRefine((value, ctx) => {
    if (!value.left.startsWith("exports.") && !value.left.startsWith("context.")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "when.left must start with exports. or context."
      });
    }
    if ((value.op === "eq" || value.op === "neq") && (value.right === undefined || value.right.trim() === "")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "when.right is required for eq and neq operators"
      });
    }
  });
export type StackWhen = z.infer<typeof StackWhenSchema>;

export const StackFinalOutputModeSchema = z.enum(["FIRST_NON_NOOP", "LAST_MATCH", "EXPLICIT"]);
export type StackFinalOutputMode = z.infer<typeof StackFinalOutputModeSchema>;

export const StackLimitsSchema = z.object({
  maxSteps: z.number().int().positive().max(20).default(10),
  maxTotalMs: z.number().int().positive().max(5000).default(250)
});
export type StackLimits = z.infer<typeof StackLimitsSchema>;

export const DecisionStackStepSchema = z.object({
  id: z.string().min(1),
  decisionKey: z.string().regex(/^[a-zA-Z0-9_-]+$/),
  enabled: z.boolean().default(true),
  stopOnMatch: z.boolean().default(false),
  stopOnActionTypes: z.array(ActionTypeSchema).default(["suppress"]),
  continueOnNoMatch: z.boolean().default(true),
  when: StackWhenSchema.optional(),
  label: z.string().optional(),
  description: z.string().optional()
});
export type DecisionStackStep = z.infer<typeof DecisionStackStepSchema>;

export const DecisionStackDefinitionSchema = z.object({
  id: z.string().uuid(),
  key: z.string().regex(/^[a-zA-Z0-9_-]+$/),
  name: z.string().min(1),
  description: z.string().default(""),
  status: DecisionStatusSchema,
  version: z.number().int().positive(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  activatedAt: z.string().datetime().nullable().optional(),
  limits: StackLimitsSchema.default({
    maxSteps: 10,
    maxTotalMs: 250
  }),
  requiredAttributes: z.array(z.string().min(1)).optional(),
  steps: z.array(DecisionStackStepSchema).min(1).max(20),
  finalOutputMode: StackFinalOutputModeSchema.default("FIRST_NON_NOOP"),
  outputs: z
    .object({
      default: DecisionOutputSchema.default({
        actionType: "noop",
        payload: {}
      })
    })
    .default({
      default: {
        actionType: "noop",
        payload: {}
      }
    })
});
export type DecisionStackDefinition = z.infer<typeof DecisionStackDefinitionSchema>;

const newId = () => {
  if (typeof globalThis.crypto !== "undefined" && "randomUUID" in globalThis.crypto) {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

export interface CreateDefinitionInput {
  id: string;
  key: string;
  name: string;
  description?: string;
  version: number;
  status?: DecisionStatus;
  salt?: string;
}

export const createDefaultDecisionDefinition = ({
  id,
  key,
  name,
  description,
  version,
  status = "DRAFT",
  salt = newId()
}: CreateDefinitionInput): DecisionDefinition => {
  const now = new Date().toISOString();
  return {
    id,
    key,
    name,
    description: description ?? "",
    status,
    version,
    createdAt: now,
    updatedAt: now,
    activatedAt: status === "ACTIVE" ? now : null,
    holdout: {
      enabled: false,
      percentage: 0,
      salt
    },
    eligibility: {},
    requiredAttributes: [],
    caps: {
      perProfilePerDay: null,
      perProfilePerWeek: null
    },
    flow: {
      rules: [
        {
          id: "default-rule",
          priority: 1,
          when: undefined,
          then: {
            actionType: "noop",
            payload: {}
          }
        }
      ]
    },
    outputs: {
      default: {
        actionType: "noop",
        payload: {}
      }
    }
  };
};

export interface CreateStackDefinitionInput {
  id: string;
  key: string;
  name: string;
  description?: string;
  version: number;
  status?: DecisionStatus;
}

export const createDefaultDecisionStackDefinition = ({
  id,
  key,
  name,
  description,
  version,
  status = "DRAFT"
}: CreateStackDefinitionInput): DecisionStackDefinition => {
  const now = new Date().toISOString();
  return {
    id,
    key,
    name,
    description: description ?? "",
    status,
    version,
    createdAt: now,
    updatedAt: now,
    activatedAt: status === "ACTIVE" ? now : null,
    limits: {
      maxSteps: 10,
      maxTotalMs: 250
    },
    requiredAttributes: [],
    steps: [
      {
        id: "step-1",
        decisionKey: "global_suppression",
        enabled: true,
        stopOnMatch: false,
        stopOnActionTypes: ["suppress"],
        continueOnNoMatch: true
      }
    ],
    finalOutputMode: "FIRST_NON_NOOP",
    outputs: {
      default: {
        actionType: "noop",
        payload: {}
      }
    }
  };
};

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  data?: DecisionDefinition;
}

export const validateDecisionDefinition = (input: unknown): ValidationResult => {
  const parsed = DecisionDefinitionSchema.safeParse(input);
  if (!parsed.success) {
    return {
      valid: false,
      errors: parsed.error.issues.map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`),
      warnings: []
    };
  }

  const definition = parsed.data;
  const warnings: string[] = [];

  if (definition.holdout.enabled && definition.holdout.percentage === 0) {
    warnings.push("Holdout is enabled but percentage is 0.");
  }

  if (!definition.outputs.default) {
    warnings.push("No default output is set. Non-matching traffic will return noop.");
  }

  if (
    typeof definition.performance?.timeoutMs === "number" &&
    typeof definition.performance?.wbsTimeoutMs === "number" &&
    definition.performance.wbsTimeoutMs > definition.performance.timeoutMs
  ) {
    warnings.push("performance.wbsTimeoutMs exceeds performance.timeoutMs and will be clamped at runtime.");
  }

  const priorities = definition.flow.rules.map((rule) => rule.priority);
  const hasDuplicatePriority = new Set(priorities).size !== priorities.length;
  if (hasDuplicatePriority) {
    warnings.push("Rules have duplicate priorities. Evaluation order may be unclear.");
  }

  return {
    valid: true,
    errors: [],
    warnings,
    data: definition
  };
};

export interface StackValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  data?: DecisionStackDefinition;
}

export const validateDecisionStackDefinition = (input: unknown): StackValidationResult => {
  const parsed = DecisionStackDefinitionSchema.safeParse(input);
  if (!parsed.success) {
    return {
      valid: false,
      errors: parsed.error.issues.map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`),
      warnings: []
    };
  }

  const definition = parsed.data;
  const warnings: string[] = [];
  const stepIds = new Set<string>();
  const enabledStepCount = definition.steps.filter((step) => step.enabled).length;

  if (enabledStepCount === 0) {
    warnings.push("No enabled steps configured.");
  }

  if (definition.steps.length >= 20) {
    warnings.push("Stack is at hard step cap (20).");
  }

  for (const step of definition.steps) {
    if (stepIds.has(step.id)) {
      warnings.push(`Duplicate step id: ${step.id}`);
    }
    stepIds.add(step.id);
  }

  return {
    valid: true,
    errors: [],
    warnings,
    data: definition
  };
};

export const formatDecisionDefinition = (input: unknown): string => {
  const parsed = DecisionDefinitionSchema.parse(input);
  return `${JSON.stringify(parsed, null, 2)}\n`;
};

export const formatDecisionStackDefinition = (input: unknown): string => {
  const parsed = DecisionStackDefinitionSchema.parse(input);
  return `${JSON.stringify(parsed, null, 2)}\n`;
};

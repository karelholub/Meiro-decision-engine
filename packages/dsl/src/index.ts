import { z } from "zod";

export const DecisionStatusSchema = z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]);
export type DecisionStatus = z.infer<typeof DecisionStatusSchema>;

export const ActionTypeSchema = z.enum(["noop", "personalize", "message", "suppress"]);
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
    .default({})
});
export type DecisionDefinition = z.infer<typeof DecisionDefinitionSchema>;

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

export const formatDecisionDefinition = (input: unknown): string => {
  const parsed = DecisionDefinitionSchema.parse(input);
  return `${JSON.stringify(parsed, null, 2)}\n`;
};

import { z } from "zod";

const stringArraySchema = z.array(z.string().min(1)).min(1);

export const orchestrationFallbackActionSchema = z.object({
  actionType: z.string().min(1),
  payload: z.record(z.unknown()).default({})
});

const ruleAppliesToSchema = z
  .object({
    actionTypes: stringArraySchema.optional(),
    tagsAny: stringArraySchema.optional()
  })
  .default({});

export const frequencyCapRuleSchema = z.object({
  id: z.string().min(1),
  type: z.literal("frequency_cap"),
  scope: z.enum(["global", "app", "placement"]).default("global"),
  appliesTo: ruleAppliesToSchema,
  limits: z
    .object({
      perDay: z.number().int().positive().optional(),
      perWeek: z.number().int().positive().optional()
    })
    .refine((value) => typeof value.perDay === "number" || typeof value.perWeek === "number", {
      message: "frequency_cap.limits requires perDay or perWeek"
    }),
  reasonCode: z.string().min(1).default("GLOBAL_CAP")
});

export const mutexRuleSchema = z.object({
  id: z.string().min(1),
  type: z.literal("mutex_group"),
  groupKey: z.string().min(1),
  appliesTo: ruleAppliesToSchema,
  window: z.object({
    seconds: z.number().int().positive()
  }),
  reasonCode: z.string().min(1).default("MUTEX_BLOCKED")
});

export const cooldownRuleSchema = z.object({
  id: z.string().min(1),
  type: z.literal("cooldown"),
  trigger: z.object({
    eventType: z.string().min(1)
  }),
  blocks: z.object({
    tagsAny: stringArraySchema
  }),
  window: z.object({
    seconds: z.number().int().positive()
  }),
  reasonCode: z.string().min(1).default("COOLDOWN_BLOCKED")
});

export const orchestrationRuleSchema = z.discriminatedUnion("type", [
  frequencyCapRuleSchema,
  mutexRuleSchema,
  cooldownRuleSchema
]);

export const orchestrationPolicySchema = z.object({
  schemaVersion: z.literal("orchestration_policy.v1"),
  defaults: z
    .object({
      mode: z.enum(["fail_open", "fail_closed"]).default("fail_open"),
      fallbackAction: orchestrationFallbackActionSchema.optional()
    })
    .default({
      mode: "fail_open"
    }),
  rules: z.array(orchestrationRuleSchema).default([])
});

export type OrchestrationPolicyDocument = z.infer<typeof orchestrationPolicySchema>;
export type OrchestrationRule = z.infer<typeof orchestrationRuleSchema>;
export type OrchestrationFrequencyCapRule = z.infer<typeof frequencyCapRuleSchema>;
export type OrchestrationMutexRule = z.infer<typeof mutexRuleSchema>;
export type OrchestrationCooldownRule = z.infer<typeof cooldownRuleSchema>;

import { createHash } from "node:crypto";
import type {
  ActionType,
  AttributePredicate,
  ConditionNode,
  DecisionDefinition,
  DecisionOutput,
  Outcome,
  Reason
} from "@decisioning/dsl";

export interface EngineProfile {
  profileId: string;
  attributes: Record<string, unknown>;
  audiences: string[];
  consents?: string[];
}

export interface EngineContext {
  now: string;
  channel?: string;
  device?: string;
  locale?: string;
  requestId?: string;
  sessionId?: string;
}

export interface EngineHistory {
  perProfilePerDay?: number;
  perProfilePerWeek?: number;
}

export interface RuleTrace {
  ruleId: string;
  matched: boolean;
  usedElse: boolean;
}

export interface EvaluationTrace {
  eligibilityPassed: boolean;
  holdoutBucket?: number;
  capSnapshot: {
    perProfilePerDay: number;
    perProfilePerWeek: number;
  };
  ruleTrace: RuleTrace[];
}

export interface EvaluateDecisionInput {
  definition: DecisionDefinition;
  profile: EngineProfile;
  context: EngineContext;
  history?: EngineHistory;
  debug?: boolean;
}

export interface EngineResult {
  decisionId: string;
  version: number;
  selectedRuleId?: string | undefined;
  actionType: ActionType;
  payload: Record<string, unknown>;
  templateVars?: Record<string, string> | undefined;
  outcome: Outcome;
  reasons: Reason[];
  trace?: EvaluationTrace | undefined;
}

const getNestedValue = (source: Record<string, unknown>, path: string): unknown => {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object" && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, source);
};

export const evaluatePredicate = (attributes: Record<string, unknown>, predicate: AttributePredicate): boolean => {
  const attributeValue = getNestedValue(attributes, predicate.field);

  switch (predicate.op) {
    case "eq":
      return attributeValue === predicate.value;
    case "neq":
      return attributeValue !== predicate.value;
    case "gt":
      return Number(attributeValue) > Number(predicate.value);
    case "gte":
      return Number(attributeValue) >= Number(predicate.value);
    case "lt":
      return Number(attributeValue) < Number(predicate.value);
    case "lte":
      return Number(attributeValue) <= Number(predicate.value);
    case "in":
      return Array.isArray(predicate.value) && predicate.value.includes(attributeValue);
    case "contains":
      if (Array.isArray(attributeValue)) {
        return attributeValue.includes(predicate.value);
      }
      if (typeof attributeValue === "string") {
        return attributeValue.includes(String(predicate.value));
      }
      return false;
    case "exists":
      return attributeValue !== undefined && attributeValue !== null;
    default:
      return false;
  }
};

const evaluateConditionNode = (attributes: Record<string, unknown>, condition: ConditionNode): boolean => {
  if (condition.type === "predicate") {
    return evaluatePredicate(attributes, condition.predicate);
  }

  if (condition.operator === "all") {
    return condition.conditions.every((child) => evaluateConditionNode(attributes, child));
  }

  return condition.conditions.some((child) => evaluateConditionNode(attributes, child));
};

const getHoldoutBucket = (profileId: string, decisionId: string, salt: string): number => {
  const hash = createHash("sha256").update(`${profileId}:${decisionId}:${salt}`).digest("hex");
  const intValue = Number.parseInt(hash.slice(0, 8), 16);
  return (intValue / 0xffffffff) * 100;
};

const noopOutput = (): DecisionOutput => ({
  actionType: "noop",
  payload: {}
});

export const evaluateDecision = ({ definition, profile, context, history, debug = false }: EvaluateDecisionInput): EngineResult => {
  const reasons: Reason[] = [];
  const trace: EvaluationTrace = {
    eligibilityPassed: true,
    capSnapshot: {
      perProfilePerDay: history?.perProfilePerDay ?? 0,
      perProfilePerWeek: history?.perProfilePerWeek ?? 0
    },
    ruleTrace: []
  };

  const fallback = definition.outputs.default ?? noopOutput();
  const eligibility = definition.eligibility;

  const audiences = new Set(profile.audiences);

  if (eligibility.audiencesAll && !eligibility.audiencesAll.every((aud) => audiences.has(aud))) {
    reasons.push({ code: "AUDIENCES_ALL_FAILED" });
  }

  if (eligibility.audiencesAny && eligibility.audiencesAny.length > 0) {
    const hasAny = eligibility.audiencesAny.some((aud) => audiences.has(aud));
    if (!hasAny) {
      reasons.push({ code: "AUDIENCES_ANY_FAILED" });
    }
  }

  if (eligibility.audiencesNone && eligibility.audiencesNone.some((aud) => audiences.has(aud))) {
    reasons.push({ code: "AUDIENCES_NONE_FAILED" });
  }

  if (eligibility.attributes) {
    const allPredicatesPassed = eligibility.attributes.every((predicate) =>
      evaluatePredicate(profile.attributes, predicate)
    );
    if (!allPredicatesPassed) {
      reasons.push({ code: "ATTRIBUTE_ELIGIBILITY_FAILED" });
    }
  }

  if (eligibility.consent?.requiredConsents?.length) {
    const consents = new Set(profile.consents ?? []);
    const allConsentsPresent = eligibility.consent.requiredConsents.every((consent) => consents.has(consent));
    if (!allConsentsPresent) {
      reasons.push({ code: "CONSENT_REQUIRED" });
    }
  }

  if (reasons.length > 0) {
    trace.eligibilityPassed = false;
    return {
      decisionId: definition.id,
      version: definition.version,
      actionType: "noop",
      payload: {},
      outcome: "NOT_ELIGIBLE",
      reasons,
      trace: debug ? trace : undefined
    };
  }

  if (definition.holdout.enabled && definition.holdout.percentage > 0) {
    const bucket = getHoldoutBucket(profile.profileId, definition.id, definition.holdout.salt);
    trace.holdoutBucket = bucket;
    if (bucket < definition.holdout.percentage) {
      return {
        decisionId: definition.id,
        version: definition.version,
        actionType: "noop",
        payload: {},
        outcome: "IN_HOLDOUT",
        reasons: [{ code: "HOLDOUT_ASSIGNED", detail: `Bucket ${bucket.toFixed(3)} is below holdout percentage.` }],
        trace: debug ? trace : undefined
      };
    }
  }

  const perDayCount = history?.perProfilePerDay ?? 0;
  if (definition.caps.perProfilePerDay && perDayCount >= definition.caps.perProfilePerDay) {
    return {
      decisionId: definition.id,
      version: definition.version,
      actionType: "noop",
      payload: {},
      outcome: "CAPPED",
      reasons: [{ code: "CAP_DAILY_EXCEEDED", detail: `Daily cap ${definition.caps.perProfilePerDay} reached.` }],
      trace: debug ? trace : undefined
    };
  }

  const perWeekCount = history?.perProfilePerWeek ?? 0;
  if (definition.caps.perProfilePerWeek && perWeekCount >= definition.caps.perProfilePerWeek) {
    return {
      decisionId: definition.id,
      version: definition.version,
      actionType: "noop",
      payload: {},
      outcome: "CAPPED",
      reasons: [{ code: "CAP_WEEKLY_EXCEEDED", detail: `Weekly cap ${definition.caps.perProfilePerWeek} reached.` }],
      trace: debug ? trace : undefined
    };
  }

  const sortedRules = [...definition.flow.rules].sort((a, b) => a.priority - b.priority);

  for (const rule of sortedRules) {
    const matched = rule.when ? evaluateConditionNode(profile.attributes, rule.when) : true;
    if (matched) {
      trace.ruleTrace.push({ ruleId: rule.id, matched: true, usedElse: false });
      return {
        decisionId: definition.id,
        version: definition.version,
        selectedRuleId: rule.id,
        actionType: rule.then.actionType,
        payload: rule.then.payload,
        templateVars: rule.then.templateVars,
        outcome: "ELIGIBLE",
        reasons: [{ code: "RULE_MATCH" }],
        trace: debug ? trace : undefined
      };
    }

    if (rule.else) {
      trace.ruleTrace.push({ ruleId: rule.id, matched: false, usedElse: true });
      return {
        decisionId: definition.id,
        version: definition.version,
        selectedRuleId: rule.id,
        actionType: rule.else.actionType,
        payload: rule.else.payload,
        templateVars: rule.else.templateVars,
        outcome: "ELIGIBLE",
        reasons: [{ code: "RULE_ELSE_MATCH" }],
        trace: debug ? trace : undefined
      };
    }

    trace.ruleTrace.push({ ruleId: rule.id, matched: false, usedElse: false });
  }

  return {
    decisionId: definition.id,
    version: definition.version,
    actionType: fallback.actionType,
    payload: fallback.payload,
    templateVars: fallback.templateVars,
    outcome: "ELIGIBLE",
    reasons: [{ code: "DEFAULT_OUTPUT" }],
    trace: debug ? trace : undefined
  };
};

export const deterministicRunKey = (definitionId: string, profileId: string, now: string): string => {
  return createHash("sha256").update(`${definitionId}:${profileId}:${contextSafe(now)}`).digest("hex");
};

const contextSafe = (value: string): string => value;

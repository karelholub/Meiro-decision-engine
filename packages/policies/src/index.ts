import type { ActionType, DecisionDefinition, Outcome, Reason } from "@decisioning/dsl";
import type { EngineContext, EngineProfile } from "@decisioning/engine";

export interface PolicyEvaluationDraft {
  actionType: ActionType;
  payload: Record<string, unknown>;
  outcome: Outcome;
  reasons: Reason[];
}

export interface PolicyContext {
  decisionVersion: DecisionDefinition;
  profile: EngineProfile;
  context: EngineContext;
  evaluationDraft?: PolicyEvaluationDraft;
}

export interface PolicyResult {
  allow: boolean;
  mutatePayload?: (payload: Record<string, unknown>) => Record<string, unknown>;
  reasons?: Reason[];
}

export interface Policy {
  name: string;
  evaluate(context: PolicyContext): PolicyResult;
}

export interface AppliedPoliciesResult {
  allow: boolean;
  payload: Record<string, unknown>;
  reasons: Reason[];
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const toRedactedCopy = (
  value: unknown,
  matcher: (key: string) => boolean,
  keyHint?: string
): { value: unknown; redactedCount: number } => {
  if (Array.isArray(value)) {
    let redactedCount = 0;
    const next = value.map((item) => {
      const redacted = toRedactedCopy(item, matcher, keyHint);
      redactedCount += redacted.redactedCount;
      return redacted.value;
    });
    return { value: next, redactedCount };
  }

  if (isRecord(value)) {
    let redactedCount = 0;
    const next: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      if (matcher(key)) {
        next[key] = "[REDACTED]";
        redactedCount += 1;
      } else {
        const redacted = toRedactedCopy(nested, matcher, key);
        next[key] = redacted.value;
        redactedCount += redacted.redactedCount;
      }
    }
    return { value: next, redactedCount };
  }

  if (keyHint && matcher(keyHint)) {
    return { value: "[REDACTED]", redactedCount: 1 };
  }

  return { value, redactedCount: 0 };
};

export class ConsentPolicy implements Policy {
  name = "ConsentPolicy";

  evaluate(context: PolicyContext): PolicyResult {
    const requiredConsents = context.decisionVersion.policies?.requiredConsents ?? [];
    if (requiredConsents.length === 0) {
      return { allow: true };
    }

    const consentSet = new Set(context.profile.consents ?? []);
    const missing = requiredConsents.filter((consent) => !consentSet.has(consent));

    if (missing.length > 0) {
      return {
        allow: false,
        reasons: [
          {
            code: "POLICY_CONSENT_REQUIRED",
            detail: `Missing required consents: ${missing.join(", ")}`
          }
        ]
      };
    }

    return { allow: true };
  }
}

export class PayloadAllowlistPolicy implements Policy {
  name = "PayloadAllowlistPolicy";

  evaluate(context: PolicyContext): PolicyResult {
    const allowlist = context.decisionVersion.policies?.payloadAllowlist;
    const actionType = context.evaluationDraft?.actionType;

    if (!allowlist || allowlist.length === 0) {
      return { allow: true };
    }

    if (actionType !== "message" && actionType !== "personalize") {
      return { allow: true };
    }

    const sourcePayload = context.evaluationDraft?.payload ?? {};
    const allowSet = new Set(allowlist);
    const filteredEntries = Object.entries(sourcePayload).filter(([key]) => allowSet.has(key));
    const filteredPayload = Object.fromEntries(filteredEntries);
    const removedCount = Math.max(0, Object.keys(sourcePayload).length - Object.keys(filteredPayload).length);

    return {
      allow: true,
      mutatePayload: () => filteredPayload,
      reasons:
        removedCount > 0
          ? [
              {
                code: "POLICY_PAYLOAD_ALLOWLIST_APPLIED",
                detail: `Removed ${removedCount} payload keys not in allowlist.`
              }
            ]
          : []
    };
  }
}

export class PiiRedactionPolicy implements Policy {
  name = "PiiRedactionPolicy";

  evaluate(context: PolicyContext): PolicyResult {
    if (!context.decisionVersion.policies) {
      return { allow: true };
    }

    const configuredPatterns = context.decisionVersion.policies.redactKeys ?? [];
    const patterns = ["email", "phone", "address", ...configuredPatterns].map((pattern) => pattern.toLowerCase());

    const matcher = (key: string) => {
      const normalized = key.toLowerCase();
      return patterns.some((pattern) => normalized.includes(pattern));
    };

    const sourcePayload = context.evaluationDraft?.payload ?? {};
    const redacted = toRedactedCopy(sourcePayload, matcher);
    const redactedPayload = isRecord(redacted.value) ? redacted.value : sourcePayload;

    return {
      allow: true,
      mutatePayload: () => redactedPayload,
      reasons:
        redacted.redactedCount > 0
          ? [
              {
                code: "POLICY_PII_REDACTED",
                detail: `Redacted ${redacted.redactedCount} payload fields.`
              }
            ]
          : []
    };
  }
}

export interface ApplyPoliciesInput {
  policies: Policy[];
  context: PolicyContext;
}

export const applyPolicies = ({ policies, context }: ApplyPoliciesInput): AppliedPoliciesResult => {
  const basePayload = context.evaluationDraft?.payload ?? {};
  let nextPayload = { ...basePayload };
  const reasons: Reason[] = [];

  for (const policy of policies) {
    const result = policy.evaluate({
      ...context,
      evaluationDraft: context.evaluationDraft
        ? {
            ...context.evaluationDraft,
            payload: nextPayload,
            reasons: [...context.evaluationDraft.reasons, ...reasons]
          }
        : undefined
    });

    if (result.mutatePayload) {
      nextPayload = result.mutatePayload(nextPayload);
    }

    if (result.reasons?.length) {
      reasons.push(...result.reasons);
    }

    if (!result.allow) {
      return {
        allow: false,
        payload: nextPayload,
        reasons
      };
    }
  }

  return {
    allow: true,
    payload: nextPayload,
    reasons
  };
};

export const createDefaultPolicies = (): Policy[] => {
  return [new ConsentPolicy(), new PayloadAllowlistPolicy(), new PiiRedactionPolicy()];
};

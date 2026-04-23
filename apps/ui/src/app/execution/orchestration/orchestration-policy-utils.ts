import type { OrchestrationPolicy, OrchestrationPolicyJson, OrchestrationPolicyRule } from "../../../lib/api";
import { campaignTypeTag } from "../../../lib/campaign-taxonomy";

export type PolicyTemplateId =
  | "global_pressure"
  | "placement_pressure"
  | "promo_mutex"
  | "post_purchase_cooldown"
  | "channel_message_cap"
  | "newsletter_weekly_cap"
  | "discount_daily_cap";

export const POLICY_TEMPLATES: Array<{
  id: PolicyTemplateId;
  label: string;
  description: string;
}> = [
  {
    id: "global_pressure",
    label: "Global pressure cap",
    description: "Limit total customer messaging across placements and apps."
  },
  {
    id: "placement_pressure",
    label: "Placement cap",
    description: "Limit repeated exposure in one placement."
  },
  {
    id: "promo_mutex",
    label: "Promo mutual exclusion",
    description: "Prevent multiple promo actions from competing in a short window."
  },
  {
    id: "post_purchase_cooldown",
    label: "Post-purchase cooldown",
    description: "Pause promo content after a purchase event."
  },
  {
    id: "channel_message_cap",
    label: "Message channel cap",
    description: "Limit message-like actions by day and week."
  },
  {
    id: "newsletter_weekly_cap",
    label: "Newsletter cap",
    description: "Allow newsletter campaigns up to 5 profile touches per week."
  },
  {
    id: "discount_daily_cap",
    label: "Discount campaign cap",
    description: "Allow discount campaigns up to 1 profile touch per day."
  }
];

export const HUMAN_DURATION_OPTIONS = [
  { label: "1 hour", seconds: 3600 },
  { label: "6 hours", seconds: 21600 },
  { label: "24 hours", seconds: 86400 },
  { label: "3 days", seconds: 259200 },
  { label: "7 days", seconds: 604800 },
  { label: "30 days", seconds: 2592000 }
];

const plural = (value: number, singular: string): string => `${value} ${singular}${value === 1 ? "" : "s"}`;

export const durationLabel = (seconds: number): string => {
  const exact = HUMAN_DURATION_OPTIONS.find((option) => option.seconds === seconds);
  if (exact) {
    return exact.label;
  }
  if (seconds % 86400 === 0) {
    return plural(seconds / 86400, "day");
  }
  if (seconds % 3600 === 0) {
    return plural(seconds / 3600, "hour");
  }
  return plural(seconds, "second");
};

export const actionTypesLabel = (actionTypes?: string[]): string => {
  if (!actionTypes || actionTypes.length === 0) {
    return "any action";
  }
  return actionTypes.join(", ");
};

export const tagsLabel = (tags?: string[]): string => {
  if (!tags || tags.length === 0) {
    return "any tag";
  }
  return tags.join(", ");
};

export const audiencesLabel = (audiences?: string[]): string => {
  if (!audiences || audiences.length === 0) {
    return "any audience";
  }
  return audiences.join(", ");
};

export const summarizeRule = (rule: OrchestrationPolicyRule): string => {
  if (rule.type === "frequency_cap") {
    const limits = [
      typeof rule.limits.perDay === "number" ? `${rule.limits.perDay}/day` : null,
      typeof rule.limits.perWeek === "number" ? `${rule.limits.perWeek}/week` : null
    ].filter(Boolean);
    return `Allow at most ${limits.join(" and ")} for ${actionTypesLabel(rule.appliesTo?.actionTypes)}${
      rule.appliesTo?.tagsAny?.length ? ` tagged ${tagsLabel(rule.appliesTo.tagsAny)}` : ""
    }${rule.appliesTo?.audiencesAny?.length ? ` with audience ${audiencesLabel(rule.appliesTo.audiencesAny)}` : ""} at ${rule.scope} scope.`;
  }
  if (rule.type === "mutex_group") {
    return `After one ${actionTypesLabel(rule.appliesTo?.actionTypes)}${
      rule.appliesTo?.tagsAny?.length ? ` tagged ${tagsLabel(rule.appliesTo.tagsAny)}` : ""
    }${rule.appliesTo?.audiencesAny?.length ? ` with audience ${audiencesLabel(rule.appliesTo.audiencesAny)}` : ""}, block another item in group ${rule.groupKey} for ${durationLabel(rule.window.seconds)}.`;
  }
  return `After ${rule.trigger.eventType}, block content tagged ${tagsLabel(rule.blocks.tagsAny)} for ${durationLabel(
    rule.window.seconds
  )}.`;
};

export const createSegmentPressureCapRule = (input: {
  audienceKey: string;
  maxDailyTouches?: number;
  maxWeeklyTouches?: number;
  campaignTypeTag?: string | null;
}): OrchestrationPolicyRule => {
  const suffix = Date.now();
  const limits = {
    ...(typeof input.maxDailyTouches === "number" && input.maxDailyTouches > 0 ? { perDay: input.maxDailyTouches } : {}),
    ...(typeof input.maxWeeklyTouches === "number" && input.maxWeeklyTouches > 0 ? { perWeek: input.maxWeeklyTouches } : {})
  };
  return {
    id: `segment_pressure_cap_${suffix}`,
    type: "frequency_cap",
    scope: "global",
    appliesTo: {
      actionTypes: ["inapp_message", "message"],
      audiencesAny: [input.audienceKey],
      ...(input.campaignTypeTag ? { tagsAny: [input.campaignTypeTag] } : {})
    },
    limits: Object.keys(limits).length > 0 ? limits : { perDay: 1 },
    reasonCode: "SEGMENT_PRESSURE_CAP"
  };
};

export const createRuleFromTemplate = (templateId: PolicyTemplateId): OrchestrationPolicyRule => {
  const suffix = Date.now();
  if (templateId === "placement_pressure") {
    return {
      id: `placement_cap_${suffix}`,
      type: "frequency_cap",
      scope: "placement",
      appliesTo: { actionTypes: ["inapp_message", "message"] },
      limits: { perDay: 1, perWeek: 3 },
      reasonCode: "PLACEMENT_CAP"
    };
  }
  if (templateId === "promo_mutex") {
    return {
      id: `promo_mutex_${suffix}`,
      type: "mutex_group",
      groupKey: "promo_any",
      appliesTo: { actionTypes: ["inapp_message", "message"], tagsAny: ["promo"] },
      window: { seconds: 86400 },
      reasonCode: "MUTEX_PROMO"
    };
  }
  if (templateId === "post_purchase_cooldown") {
    return {
      id: `post_purchase_cooldown_${suffix}`,
      type: "cooldown",
      trigger: { eventType: "purchase" },
      blocks: { tagsAny: ["promo"] },
      window: { seconds: 604800 },
      reasonCode: "COOLDOWN_POST_PURCHASE"
    };
  }
  if (templateId === "channel_message_cap") {
    return {
      id: `message_cap_${suffix}`,
      type: "frequency_cap",
      scope: "app",
      appliesTo: { actionTypes: ["message"] },
      limits: { perDay: 1, perWeek: 4 },
      reasonCode: "MESSAGE_CAP"
    };
  }
  if (templateId === "newsletter_weekly_cap") {
    return {
      id: `newsletter_weekly_cap_${suffix}`,
      type: "frequency_cap",
      scope: "global",
      appliesTo: { actionTypes: ["inapp_message", "message"], tagsAny: [campaignTypeTag("newsletter") ?? "campaign_type:newsletter"] },
      limits: { perWeek: 5 },
      reasonCode: "NEWSLETTER_WEEKLY_CAP"
    };
  }
  if (templateId === "discount_daily_cap") {
    return {
      id: `discount_daily_cap_${suffix}`,
      type: "frequency_cap",
      scope: "global",
      appliesTo: { actionTypes: ["inapp_message", "message"], tagsAny: [campaignTypeTag("discount") ?? "campaign_type:discount"] },
      limits: { perDay: 1 },
      reasonCode: "DISCOUNT_DAILY_CAP"
    };
  }
  return {
    id: `global_cap_${suffix}`,
    type: "frequency_cap",
    scope: "global",
    appliesTo: { actionTypes: ["inapp_message", "message"] },
    limits: { perDay: 2, perWeek: 6 },
    reasonCode: "GLOBAL_CAP"
  };
};

export const summarizePolicyHealth = (
  policyJson: OrchestrationPolicyJson,
  knownTags: string[]
): Array<{ level: "info" | "warning" | "critical"; message: string }> => {
  const output: Array<{ level: "info" | "warning" | "critical"; message: string }> = [];
  const rules = policyJson.rules ?? [];
  if (rules.length === 0) {
    output.push({ level: "warning", message: "This policy has no rules and will not change runtime behavior." });
  }
  if (policyJson.defaults?.mode === "fail_closed") {
    output.push({ level: "critical", message: "Fail-closed can block eligible actions if policy evaluation fails." });
  }
  if (policyJson.defaults?.fallbackAction?.actionType && policyJson.defaults.fallbackAction.actionType !== "noop") {
    output.push({ level: "warning", message: `Fallback action is ${policyJson.defaults.fallbackAction.actionType}, not noop.` });
  }

  const knownTagSet = new Set(knownTags);
  const referencedTags = new Set<string>();
  for (const rule of rules) {
    if (rule.type === "cooldown") {
      rule.blocks.tagsAny.forEach((tag) => referencedTags.add(tag));
    } else {
      rule.appliesTo?.tagsAny?.forEach((tag) => referencedTags.add(tag));
    }
  }
  const missingTags = [...referencedTags].filter((tag) => knownTagSet.size > 0 && !knownTagSet.has(tag));
  if (missingTags.length > 0) {
    output.push({ level: "warning", message: `Unknown catalog tags referenced: ${missingTags.slice(0, 5).join(", ")}.` });
  }
  output.push({
    level: "info",
    message: `${rules.length} rule${rules.length === 1 ? "" : "s"}: ${rules.filter((rule) => rule.type === "frequency_cap").length} caps, ${
      rules.filter((rule) => rule.type === "mutex_group").length
    } mutex groups, ${rules.filter((rule) => rule.type === "cooldown").length} cooldowns.`
  });
  return output;
};

export const activePolicyForDraft = (items: OrchestrationPolicy[], selected: OrchestrationPolicy | null): OrchestrationPolicy | null => {
  if (!selected) {
    return null;
  }
  return (
    items.find(
      (item) =>
        item.status === "ACTIVE" &&
        item.key === selected.key &&
        item.appKey === selected.appKey &&
        item.environment === selected.environment &&
        item.id !== selected.id
    ) ?? null
  );
};

export const policyHasMeaningfulChange = (left: OrchestrationPolicyJson | null, right: OrchestrationPolicyJson): boolean => {
  if (!left) {
    return true;
  }
  return JSON.stringify(left) !== JSON.stringify(right);
};

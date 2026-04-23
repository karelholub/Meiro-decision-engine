import { describe, expect, it, vi } from "vitest";
import {
  createSegmentPressureCapRule,
  createRuleFromTemplate,
  durationLabel,
  policyHasMeaningfulChange,
  summarizePolicyHealth,
  summarizeRule
} from "./orchestration-policy-utils";
import type { OrchestrationPolicyJson } from "../../../lib/api";

describe("orchestration policy utils", () => {
  it("summarizes rules in operational language", () => {
    expect(
      summarizeRule({
        id: "cap",
        type: "frequency_cap",
        scope: "global",
        appliesTo: { actionTypes: ["message"], tagsAny: ["promo"], audiencesAny: ["meiro_segment:vip"] },
        limits: { perDay: 1 },
        reasonCode: "CAP"
      })
    ).toContain("Allow at most 1/day");
    expect(
      summarizeRule({
        id: "cap",
        type: "frequency_cap",
        scope: "global",
        appliesTo: { actionTypes: ["message"], audiencesAny: ["meiro_segment:vip"] },
        limits: { perWeek: 3 },
        reasonCode: "CAP"
      })
    ).toContain("with audience meiro_segment:vip");

    expect(
      summarizeRule({
        id: "cooldown",
        type: "cooldown",
        trigger: { eventType: "purchase" },
        blocks: { tagsAny: ["promo"] },
        window: { seconds: 604800 },
        reasonCode: "COOLDOWN"
      })
    ).toContain("After purchase");
  });

  it("formats human durations", () => {
    expect(durationLabel(86400)).toBe("24 hours");
    expect(durationLabel(172800)).toBe("2 days");
  });

  it("creates deterministic template shapes with generated ids", () => {
    vi.spyOn(Date, "now").mockReturnValue(123);
    expect(createRuleFromTemplate("promo_mutex")).toMatchObject({
      id: "promo_mutex_123",
      type: "mutex_group",
      groupKey: "promo_any"
    });
    expect(createRuleFromTemplate("newsletter_weekly_cap")).toMatchObject({
      id: "newsletter_weekly_cap_123",
      type: "frequency_cap",
      appliesTo: { tagsAny: ["campaign_type:newsletter"] },
      limits: { perWeek: 5 }
    });
    expect(createRuleFromTemplate("discount_daily_cap")).toMatchObject({
      id: "discount_daily_cap_123",
      type: "frequency_cap",
      appliesTo: { tagsAny: ["campaign_type:discount"] },
      limits: { perDay: 1 }
    });
  });

  it("creates segment pressure cap rules from exact audience refs", () => {
    vi.spyOn(Date, "now").mockReturnValue(456);
    expect(
      createSegmentPressureCapRule({
        audienceKey: "meiro_segment:vip",
        maxDailyTouches: 1,
        maxWeeklyTouches: 3,
        campaignTypeTag: "campaign_type:newsletter"
      })
    ).toMatchObject({
      id: "segment_pressure_cap_456",
      type: "frequency_cap",
      scope: "global",
      appliesTo: {
        actionTypes: ["inapp_message", "message"],
        audiencesAny: ["meiro_segment:vip"],
        tagsAny: ["campaign_type:newsletter"]
      },
      limits: { perDay: 1, perWeek: 3 },
      reasonCode: "SEGMENT_PRESSURE_CAP"
    });
  });

  it("reports policy health warnings", () => {
    const policy: OrchestrationPolicyJson = {
      schemaVersion: "orchestration_policy.v1",
      defaults: { mode: "fail_closed" },
      rules: []
    };
    const health = summarizePolicyHealth(policy, []);
    expect(health.some((item) => item.level === "critical")).toBe(true);
    expect(health.some((item) => item.message.includes("no rules"))).toBe(true);
  });

  it("detects meaningful policy changes", () => {
    const policy: OrchestrationPolicyJson = {
      schemaVersion: "orchestration_policy.v1",
      rules: []
    };
    expect(policyHasMeaningfulChange(policy, policy)).toBe(false);
    expect(policyHasMeaningfulChange(null, policy)).toBe(true);
  });
});

import { InAppCampaignStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  canRunInAppGovernanceAction,
  getInAppGovernanceAllowedStatuses,
  getInAppGovernanceTransitionError
} from "../src/lib/inappGovernance";

describe("in-app governance transitions", () => {
  it("allows only valid status transitions", () => {
    expect(
      canRunInAppGovernanceAction({
        currentStatus: InAppCampaignStatus.DRAFT,
        action: "submit_for_approval"
      })
    ).toBe(true);
    expect(
      canRunInAppGovernanceAction({
        currentStatus: InAppCampaignStatus.PENDING_APPROVAL,
        action: "approve_and_activate"
      })
    ).toBe(true);
    expect(
      canRunInAppGovernanceAction({
        currentStatus: InAppCampaignStatus.PENDING_APPROVAL,
        action: "reject_to_draft"
      })
    ).toBe(true);
    expect(
      canRunInAppGovernanceAction({
        currentStatus: InAppCampaignStatus.ACTIVE,
        action: "rollback"
      })
    ).toBe(true);
  });

  it("rejects invalid transitions and returns explicit errors", () => {
    const error = getInAppGovernanceTransitionError({
      currentStatus: InAppCampaignStatus.ACTIVE,
      action: "submit_for_approval"
    });
    expect(error).toContain("Invalid transition");
    expect(error).toContain("ACTIVE");

    const noError = getInAppGovernanceTransitionError({
      currentStatus: InAppCampaignStatus.PENDING_APPROVAL,
      action: "approve_and_activate"
    });
    expect(noError).toBeNull();
  });

  it("exposes allowed statuses per action for API details", () => {
    expect(getInAppGovernanceAllowedStatuses("submit_for_approval")).toEqual([InAppCampaignStatus.DRAFT]);
    expect(getInAppGovernanceAllowedStatuses("approve_and_activate")).toEqual([InAppCampaignStatus.PENDING_APPROVAL]);
    expect(getInAppGovernanceAllowedStatuses("reject_to_draft")).toEqual([InAppCampaignStatus.PENDING_APPROVAL]);
    expect(getInAppGovernanceAllowedStatuses("rollback")).toEqual([InAppCampaignStatus.ACTIVE]);
  });
});

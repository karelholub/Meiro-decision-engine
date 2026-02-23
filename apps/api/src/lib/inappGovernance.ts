import { InAppCampaignStatus } from "@prisma/client";

export type InAppGovernanceAction = "submit_for_approval" | "approve_and_activate" | "reject_to_draft" | "rollback";

const governanceRules: Record<InAppGovernanceAction, { from: InAppCampaignStatus[]; to: InAppCampaignStatus }> = {
  submit_for_approval: {
    from: [InAppCampaignStatus.DRAFT, InAppCampaignStatus.ACTIVE],
    to: InAppCampaignStatus.PENDING_APPROVAL
  },
  approve_and_activate: {
    from: [InAppCampaignStatus.PENDING_APPROVAL],
    to: InAppCampaignStatus.ACTIVE
  },
  reject_to_draft: {
    from: [InAppCampaignStatus.PENDING_APPROVAL],
    to: InAppCampaignStatus.DRAFT
  },
  rollback: {
    from: [InAppCampaignStatus.ACTIVE],
    to: InAppCampaignStatus.ACTIVE
  }
};

export const getInAppGovernanceAllowedStatuses = (action: InAppGovernanceAction): InAppCampaignStatus[] => {
  return [...governanceRules[action].from];
};

export const canRunInAppGovernanceAction = (input: {
  currentStatus: InAppCampaignStatus;
  action: InAppGovernanceAction;
}): boolean => {
  const rule = governanceRules[input.action];
  return rule.from.includes(input.currentStatus);
};

export const getInAppGovernanceTransitionError = (input: {
  currentStatus: InAppCampaignStatus;
  action: InAppGovernanceAction;
}): string | null => {
  if (canRunInAppGovernanceAction(input)) {
    return null;
  }
  const allowed = governanceRules[input.action].from.join(", ");
  return `Invalid transition for '${input.action}'. Current status '${input.currentStatus}' must be one of: ${allowed}.`;
};

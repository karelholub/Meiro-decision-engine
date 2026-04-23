export type CampaignTypePreset = {
  value: string;
  label: string;
  description: string;
};

export const DEFAULT_CAMPAIGN_TYPES: CampaignTypePreset[] = [
  {
    value: "newsletter",
    label: "Newsletter",
    description: "Recurring editorial or lifecycle messaging. Typical cap: 5/week."
  },
  {
    value: "discount",
    label: "Discount",
    description: "Commercial offer or price incentive. Typical cap: 1/day."
  },
  {
    value: "transactional",
    label: "Transactional",
    description: "Service or account communication. Usually excluded from marketing caps."
  },
  {
    value: "lifecycle",
    label: "Lifecycle",
    description: "Onboarding, retention, or winback communication."
  },
  {
    value: "announcement",
    label: "Announcement",
    description: "Product, policy, or operational announcement."
  }
];

export const normalizeCampaignType = (value: string | null | undefined): string | null => {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized.length > 0 ? normalized : null;
};

export const campaignTypeTag = (value: string | null | undefined): string | null => {
  const normalized = normalizeCampaignType(value);
  return normalized ? `campaign_type:${normalized}` : null;
};

export const campaignTypeTags = (value: string | null | undefined): string[] => {
  const tag = campaignTypeTag(value);
  return tag ? [tag] : [];
};

export const campaignTypeLabel = (value: string | null | undefined): string => {
  const normalized = normalizeCampaignType(value);
  if (!normalized) {
    return "Unclassified";
  }
  return DEFAULT_CAMPAIGN_TYPES.find((item) => item.value === normalized)?.label ?? normalized.replace(/_/g, " ");
};

export const defaultCampaignTypeTags = (): string[] => DEFAULT_CAMPAIGN_TYPES.map((item) => `campaign_type:${item.value}`);

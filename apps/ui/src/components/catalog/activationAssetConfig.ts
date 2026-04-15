import type { ActivationAssetCategory, ActivationAssetChannel, ActivationAssetType, ActivationLibraryItem } from "../../lib/api";

export type ActivationAssetCreationGroup = "Primitive assets" | "Channel assets" | "Existing governed objects";

export type ActivationAssetCreationOption = {
  assetType: ActivationAssetType;
  label: string;
  group: ActivationAssetCreationGroup;
  description: string;
  channels: ActivationAssetChannel[];
  templateHint: string;
};

export type ActivationAssetBrowseTab = {
  id: string;
  label: string;
  category?: ActivationAssetCategory;
  assetType?: ActivationAssetType;
  description: string;
};

export const activationAssetTypeOptions: Array<{ value: ActivationAssetType; label: string }> = [
  { value: "image", label: "Image" },
  { value: "copy_snippet", label: "Copy Snippet" },
  { value: "cta", label: "CTA" },
  { value: "offer", label: "Offer" },
  { value: "website_banner", label: "Website Banner" },
  { value: "popup_banner", label: "Popup Banner" },
  { value: "email_block", label: "Email Block" },
  { value: "push_message", label: "Push Message" },
  { value: "whatsapp_message", label: "WhatsApp Message" },
  { value: "journey_asset", label: "Journey Asset" },
  { value: "bundle", label: "Bundle" }
];

export const activationAssetTypeFilterOptions: Array<{ value: "" | ActivationAssetType; label: string }> = [
  { value: "", label: "All types" },
  { value: "image", label: "Images" },
  { value: "copy_snippet", label: "Copy" },
  { value: "cta", label: "CTAs" },
  { value: "offer", label: "Offers" },
  { value: "website_banner", label: "Website banners" },
  { value: "popup_banner", label: "Popup banners" },
  { value: "email_block", label: "Email blocks" },
  { value: "push_message", label: "Push messages" },
  { value: "whatsapp_message", label: "WhatsApp messages" },
  { value: "journey_asset", label: "Journey assets" },
  { value: "bundle", label: "Bundles" }
];

export const activationChannelFilterOptions: Array<{ value: "" | ActivationAssetChannel; label: string }> = [
  { value: "", label: "All channels" },
  { value: "website_personalization", label: "Website personalization" },
  { value: "popup_banner", label: "Popup banners" },
  { value: "email", label: "Email" },
  { value: "mobile_push", label: "Mobile push" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "journey_canvas", label: "Journey canvas" }
];

export const channelFilterLabel = (value: ActivationAssetChannel) =>
  activationChannelFilterOptions.find((option) => option.value === value)?.label ?? value;

export const activationAssetCreationOptions: ActivationAssetCreationOption[] = [
  {
    assetType: "image",
    label: "Image",
    group: "Primitive assets",
    description: "Reusable image reference with source, description, and tags.",
    channels: ["website_personalization", "popup_banner", "email"],
    templateHint: "image_ref_v1"
  },
  {
    assetType: "copy_snippet",
    label: "Copy Snippet",
    group: "Primitive assets",
    description: "Token-aware reusable copy for messages, banners, and journey steps.",
    channels: ["website_personalization", "popup_banner", "email", "mobile_push", "whatsapp", "journey_canvas"],
    templateHint: "copy_snippet_v1"
  },
  {
    assetType: "cta",
    label: "CTA",
    group: "Primitive assets",
    description: "Reusable button label and target/action fields.",
    channels: ["website_personalization", "popup_banner", "email", "mobile_push", "whatsapp", "journey_canvas"],
    templateHint: "cta_v1"
  },
  {
    assetType: "website_banner",
    label: "Website Banner",
    group: "Channel assets",
    description: "Website personalization banner with title, subtitle, CTA, image, and URL starter fields.",
    channels: ["website_personalization"],
    templateHint: "banner_v1"
  },
  {
    assetType: "popup_banner",
    label: "Popup Banner",
    group: "Channel assets",
    description: "Popup or modal banner with short body, CTA, URL, and image reference.",
    channels: ["popup_banner"],
    templateHint: "popup_banner_v1"
  },
  {
    assetType: "email_block",
    label: "Email Block",
    group: "Channel assets",
    description: "Email content block with headline, body, CTA, image, and footer fields.",
    channels: ["email"],
    templateHint: "email_block_v1"
  },
  {
    assetType: "push_message",
    label: "Push Message",
    group: "Channel assets",
    description: "Short mobile push draft with title, body, deeplink, and action fields.",
    channels: ["mobile_push"],
    templateHint: "push_message_v1"
  },
  {
    assetType: "whatsapp_message",
    label: "WhatsApp Message",
    group: "Channel assets",
    description: "WhatsApp message draft with body, button, action, and variable guidance.",
    channels: ["whatsapp"],
    templateHint: "whatsapp_message_v1"
  },
  {
    assetType: "journey_asset",
    label: "Journey Asset",
    group: "Channel assets",
    description: "Journey-compatible content block for decision, message, or fallback nodes.",
    channels: ["journey_canvas"],
    templateHint: "journey_asset_v1"
  },
  {
    assetType: "offer",
    label: "Offer",
    group: "Existing governed objects",
    description: "Governed offer draft with starter value and constraints.",
    channels: ["website_personalization", "popup_banner", "email", "mobile_push", "whatsapp", "journey_canvas"],
    templateHint: "Offer editor"
  },
  {
    assetType: "bundle",
    label: "Bundle",
    group: "Existing governed objects",
    description: "Reusable package for governed offer and content block references.",
    channels: [],
    templateHint: "Bundle editor"
  }
];

export const activationAssetCreationGroups: ActivationAssetCreationGroup[] = [
  "Primitive assets",
  "Channel assets",
  "Existing governed objects"
];

export const activationAssetBrowseTabs: ActivationAssetBrowseTab[] = [
  { id: "all", label: "All Assets", description: "Every governed activation asset in one library." },
  { id: "images", label: "Images", assetType: "image", description: "Thumbnail-forward reusable image references." },
  { id: "copy", label: "Copy", assetType: "copy_snippet", description: "Reusable snippets, tokenized copy, and fragments." },
  { id: "ctas", label: "CTAs", assetType: "cta", description: "Reusable labels, URLs, and deeplinks." },
  { id: "offers", label: "Offers", assetType: "offer", description: "Decision-ready offer objects." },
  { id: "channel", label: "Channel Assets", category: "channel", description: "Campaign-ready assets by channel and template." },
  { id: "bundles", label: "Bundles", assetType: "bundle", description: "Composed packages of governed assets." }
];

export const createTypeForBrowseTab = (tab: ActivationAssetBrowseTab): ActivationAssetType => {
  if (tab.assetType) return tab.assetType;
  if (tab.category === "channel") return "website_banner";
  return "website_banner";
};

export const campaignCreationHref = (input: {
  startAt?: string | null;
  endAt?: string | null;
  appKey?: string | null;
  placementKey?: string | null;
  assetKey?: string | null;
  assetType?: ActivationAssetType | string | null;
  assetKind?: "content" | "offer" | null;
  name?: string | null;
}) => {
  const params = new URLSearchParams();
  if (input.startAt) params.set("startAt", input.startAt);
  if (input.endAt) params.set("endAt", input.endAt);
  if (input.appKey?.trim()) params.set("appKey", input.appKey.trim());
  if (input.placementKey?.trim()) params.set("placementKey", input.placementKey.trim());
  if (input.assetType?.trim()) params.set("assetType", input.assetType.trim());
  if (input.name?.trim()) params.set("name", input.name.trim());

  const assetKey = input.assetKey?.trim();
  if (assetKey) {
    const kind = input.assetKind ?? (input.assetType === "offer" ? "offer" : input.assetType === "bundle" ? null : "content");
    if (kind === "offer") {
      params.set("offerKey", assetKey);
    } else if (kind === "content") {
      params.set("contentKey", assetKey);
    }
  }

  const query = params.toString();
  return `/engage/campaigns/new/edit${query ? `?${query}` : ""}`;
};

export const assetCampaignPlanHref = (item: ActivationLibraryItem) => {
  const assetKey = item.runtimeRef.offerKey ?? item.runtimeRef.contentKey;
  if (!assetKey) {
    return null;
  }
  return campaignCreationHref({
    assetKey,
    assetKind: item.runtimeRef.offerKey ? "offer" : "content",
    assetType: item.assetType,
    name: `Campaign for ${item.name}`
  });
};

export const assetCalendarUsageHref = (item: Pick<ActivationLibraryItem, "key" | "assetType">) => {
  const params = new URLSearchParams({
    assetKey: item.key,
    assetType: item.assetType
  });
  return `/engage/calendar?${params.toString()}`;
};

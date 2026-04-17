export type ActivationAssetCategory = "primitive" | "channel" | "composite";
export type ActivationAssetEntityType = "offer" | "content" | "bundle";
export type ActivationAssetCreationTarget = ActivationAssetEntityType;
export type ActivationAssetCreationGroup = "Primitive assets" | "Channel assets" | "Existing governed objects";
export type ActivationAssetPickerMode = "runtime_asset" | "primitive_parts" | "all";

export type ActivationAssetChannel =
  | "website_personalization"
  | "popup_banner"
  | "email"
  | "mobile_push"
  | "whatsapp"
  | "journey_canvas";

export type ActivationAssetType =
  | "image"
  | "copy_snippet"
  | "cta"
  | "offer"
  | "website_banner"
  | "popup_banner"
  | "email_block"
  | "push_message"
  | "whatsapp_message"
  | "journey_asset"
  | "bundle";

export interface ActivationCompatibility {
  channels: ActivationAssetChannel[];
  templateKeys: string[];
  placementKeys: string[];
  locales: string[];
  journeyNodeContexts: string[];
}

export interface ActivationAssetTypeDefinition {
  assetType: ActivationAssetType;
  label: string;
  pluralLabel: string;
  category: ActivationAssetCategory;
  creationTarget: ActivationAssetCreationTarget;
  creationGroup: ActivationAssetCreationGroup;
  description: string;
  guidance: string;
  defaultChannels: ActivationAssetChannel[];
  defaultTemplateKey?: string;
  defaultPlacementKeys: string[];
  defaultJourneyNodeContexts: string[];
  keyPrefix: string;
}

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

export type ActivationAssetCategoryInput = {
  category: ActivationAssetCategory;
};

export const ACTIVATION_ASSET_TYPES: ActivationAssetType[] = [
  "image",
  "copy_snippet",
  "cta",
  "offer",
  "website_banner",
  "popup_banner",
  "email_block",
  "push_message",
  "whatsapp_message",
  "journey_asset",
  "bundle"
];

export const ACTIVATION_ASSET_TYPE_REGISTRY: Record<ActivationAssetType, ActivationAssetTypeDefinition> = {
  image: {
    assetType: "image",
    label: "Image",
    pluralLabel: "Images",
    category: "primitive",
    creationTarget: "content",
    creationGroup: "Primitive assets",
    description: "Reusable image reference with source, description, and tags.",
    guidance:
      "Stores an image reference and descriptive metadata as a primitive content block. Binary upload and transformations stay outside this sprint.",
    defaultChannels: ["website_personalization", "popup_banner", "email"],
    defaultTemplateKey: "image_ref_v1",
    defaultPlacementKeys: [],
    defaultJourneyNodeContexts: [],
    keyPrefix: "IMAGE"
  },
  copy_snippet: {
    assetType: "copy_snippet",
    label: "Copy Snippet",
    pluralLabel: "Copy",
    category: "primitive",
    creationTarget: "content",
    creationGroup: "Primitive assets",
    description: "Token-aware reusable copy for messages, banners, and journey steps.",
    guidance: "Stores reusable text with token guidance as a primitive content block.",
    defaultChannels: ["website_personalization", "popup_banner", "email", "mobile_push", "whatsapp", "journey_canvas"],
    defaultTemplateKey: "copy_snippet_v1",
    defaultPlacementKeys: [],
    defaultJourneyNodeContexts: [],
    keyPrefix: "COPY"
  },
  cta: {
    assetType: "cta",
    label: "CTA",
    pluralLabel: "CTAs",
    category: "primitive",
    creationTarget: "content",
    creationGroup: "Primitive assets",
    description: "Reusable button label and target/action fields.",
    guidance: "Stores reusable button label and target fields as a primitive content block.",
    defaultChannels: ["website_personalization", "popup_banner", "email", "mobile_push", "whatsapp", "journey_canvas"],
    defaultTemplateKey: "cta_v1",
    defaultPlacementKeys: [],
    defaultJourneyNodeContexts: [],
    keyPrefix: "CTA"
  },
  offer: {
    assetType: "offer",
    label: "Offer",
    pluralLabel: "Offers",
    category: "primitive",
    creationTarget: "offer",
    creationGroup: "Existing governed objects",
    description: "Governed offer draft with starter value and constraints.",
    guidance: "Creates a governed offer draft with starter discount fields.",
    defaultChannels: ["website_personalization", "popup_banner", "email", "mobile_push", "whatsapp", "journey_canvas"],
    defaultPlacementKeys: [],
    defaultJourneyNodeContexts: [],
    keyPrefix: "OFFER"
  },
  website_banner: {
    assetType: "website_banner",
    label: "Website Banner",
    pluralLabel: "Website banners",
    category: "channel",
    creationTarget: "content",
    creationGroup: "Channel assets",
    description: "Website personalization banner with title, subtitle, CTA, image, and URL starter fields.",
    guidance: "Creates a website-compatible content block with banner fields, template metadata, and a default website variant.",
    defaultChannels: ["website_personalization"],
    defaultTemplateKey: "banner_v1",
    defaultPlacementKeys: ["home_top"],
    defaultJourneyNodeContexts: [],
    keyPrefix: "WEB_BANNER"
  },
  popup_banner: {
    assetType: "popup_banner",
    label: "Popup Banner",
    pluralLabel: "Popup banners",
    category: "channel",
    creationTarget: "content",
    creationGroup: "Channel assets",
    description: "Popup or modal banner with short body, CTA, URL, and image reference.",
    guidance: "Creates a popup-compatible content block with modal copy, action, and image-reference fields.",
    defaultChannels: ["popup_banner"],
    defaultTemplateKey: "popup_banner_v1",
    defaultPlacementKeys: ["modal"],
    defaultJourneyNodeContexts: [],
    keyPrefix: "POPUP"
  },
  email_block: {
    assetType: "email_block",
    label: "Email Block",
    pluralLabel: "Email blocks",
    category: "channel",
    creationTarget: "content",
    creationGroup: "Channel assets",
    description: "Email-ready asset with headline, body, CTA, image, and footer fields.",
    guidance: "Creates an email-compatible content block with headline, body, CTA, image, and footer fields.",
    defaultChannels: ["email"],
    defaultTemplateKey: "email_block_v1",
    defaultPlacementKeys: [],
    defaultJourneyNodeContexts: [],
    keyPrefix: "EMAIL_BLOCK"
  },
  push_message: {
    assetType: "push_message",
    label: "Push Message",
    pluralLabel: "Push messages",
    category: "channel",
    creationTarget: "content",
    creationGroup: "Channel assets",
    description: "Short mobile push draft with title, body, deeplink, and action fields.",
    guidance: "Creates a mobile-push content block with short title, body, and deeplink fields.",
    defaultChannels: ["mobile_push"],
    defaultTemplateKey: "push_message_v1",
    defaultPlacementKeys: [],
    defaultJourneyNodeContexts: [],
    keyPrefix: "PUSH"
  },
  whatsapp_message: {
    assetType: "whatsapp_message",
    label: "WhatsApp Message",
    pluralLabel: "WhatsApp messages",
    category: "channel",
    creationTarget: "content",
    creationGroup: "Channel assets",
    description: "WhatsApp message draft with body, button, action, and variable guidance.",
    guidance: "Creates a WhatsApp-compatible content block with body, button, action, and token guidance.",
    defaultChannels: ["whatsapp"],
    defaultTemplateKey: "whatsapp_message_v1",
    defaultPlacementKeys: [],
    defaultJourneyNodeContexts: [],
    keyPrefix: "WHATSAPP"
  },
  journey_asset: {
    assetType: "journey_asset",
    label: "Journey Asset",
    pluralLabel: "Journey assets",
    category: "channel",
    creationTarget: "content",
    creationGroup: "Channel assets",
    description: "Journey-compatible asset for decision, message, or fallback nodes.",
    guidance: "Creates a journey-compatible content block that can be selected through the existing content asset path.",
    defaultChannels: ["journey_canvas"],
    defaultTemplateKey: "journey_asset_v1",
    defaultPlacementKeys: ["journey_node"],
    defaultJourneyNodeContexts: ["message", "decision", "fallback"],
    keyPrefix: "JOURNEY_ASSET"
  },
  bundle: {
    assetType: "bundle",
    label: "Bundle",
    pluralLabel: "Bundles",
    category: "composite",
    creationTarget: "bundle",
    creationGroup: "Existing governed objects",
    description: "Reusable package for governed offer and asset references.",
    guidance: "Creates a governed bundle draft for packaging an offer and content block with compatibility metadata.",
    defaultChannels: [],
    defaultPlacementKeys: [],
    defaultJourneyNodeContexts: [],
    keyPrefix: "BUNDLE"
  }
};

export const ACTIVATION_ASSET_CREATION_GROUPS: ActivationAssetCreationGroup[] = [
  "Primitive assets",
  "Channel assets",
  "Existing governed objects"
];

export const ACTIVATION_ASSET_PICKER_CATEGORIES: Record<ActivationAssetPickerMode, ActivationAssetCategory[]> = {
  runtime_asset: ["channel", "composite"],
  primitive_parts: ["primitive"],
  all: ["primitive", "channel", "composite"]
};

export const ACTIVATION_CHANNEL_LABELS: Record<ActivationAssetChannel, string> = {
  website_personalization: "Website personalization",
  popup_banner: "Popup banners",
  email: "Email",
  mobile_push: "Mobile push",
  whatsapp: "WhatsApp",
  journey_canvas: "Journey canvas"
};

export const ACTIVATION_CHANNEL_SHORT_LABELS: Record<ActivationAssetChannel, string> = {
  website_personalization: "Website",
  popup_banner: "Popup",
  email: "Email",
  mobile_push: "Push",
  whatsapp: "WhatsApp",
  journey_canvas: "Journey"
};

export const ACTIVATION_CHANNEL_MARKS: Record<ActivationAssetChannel, string> = {
  website_personalization: "Web",
  popup_banner: "Pop",
  email: "Mail",
  mobile_push: "Push",
  whatsapp: "WA",
  journey_canvas: "Flow"
};

export const ACTIVATION_CHANNEL_ALIASES: Record<string, ActivationAssetChannel> = {
  web: "website_personalization",
  website: "website_personalization",
  website_perso: "website_personalization",
  website_personalization: "website_personalization",
  onsite: "website_personalization",
  inapp: "popup_banner",
  in_app: "popup_banner",
  popup: "popup_banner",
  popup_banner: "popup_banner",
  email: "email",
  mail: "email",
  push: "mobile_push",
  mobile_push: "mobile_push",
  whatsapp: "whatsapp",
  wa: "whatsapp",
  journey: "journey_canvas",
  journey_canvas: "journey_canvas"
};

const normalizeToken = (value: string) => value.trim().toLowerCase().replace(/\s+/g, "_").replace(/-/g, "_");

const stableList = <T extends string>(values: Iterable<T>) =>
  [...new Set([...values].map((value) => value.trim()).filter(Boolean) as T[])].sort((a, b) => a.localeCompare(b));

export const getActivationAssetTypeDefinition = (assetType: ActivationAssetType) => ACTIVATION_ASSET_TYPE_REGISTRY[assetType];

export const activationAssetTypeLabel = (assetType: ActivationAssetType) => getActivationAssetTypeDefinition(assetType).label;

export const activationAssetTypePluralLabel = (assetType: ActivationAssetType) => getActivationAssetTypeDefinition(assetType).pluralLabel;

export const activationAssetTypeCategory = (assetType: ActivationAssetType) => getActivationAssetTypeDefinition(assetType).category;

export const activationAssetCreationTargetFor = (assetType: ActivationAssetType) => getActivationAssetTypeDefinition(assetType).creationTarget;

export const activationAssetDefaultChannels = (assetType: ActivationAssetType) => [
  ...getActivationAssetTypeDefinition(assetType).defaultChannels
];

export const activationAssetTemplateDefaults = (assetType: ActivationAssetType) => {
  const templateKey = getActivationAssetTypeDefinition(assetType).defaultTemplateKey;
  return templateKey ? [templateKey] : [];
};

export const activationAssetDefaultTemplateKey = (assetType: ActivationAssetType) =>
  getActivationAssetTypeDefinition(assetType).defaultTemplateKey ?? null;

export const activationAssetPlacementDefaults = (assetType: ActivationAssetType) => [
  ...getActivationAssetTypeDefinition(assetType).defaultPlacementKeys
];

export const activationAssetJourneyContextDefaults = (assetType: ActivationAssetType) => [
  ...getActivationAssetTypeDefinition(assetType).defaultJourneyNodeContexts
];

export const activationAssetUseCase = (assetType: ActivationAssetType) => getActivationAssetTypeDefinition(assetType).description;

export const activationAssetCreationGuidance = (assetType: ActivationAssetType) => getActivationAssetTypeDefinition(assetType).guidance;

export const activationAssetKeyPrefix = (assetType: ActivationAssetType) => getActivationAssetTypeDefinition(assetType).keyPrefix;

export const activationAssetRouteBaseForTarget = (target: ActivationAssetCreationTarget) => {
  if (target === "offer") return "/catalog/offers";
  if (target === "bundle") return "/catalog/bundles";
  return "/catalog/content";
};

export const normalizeActivationChannel = (value: unknown): ActivationAssetChannel | null => {
  if (typeof value !== "string") {
    return null;
  }
  return ACTIVATION_CHANNEL_ALIASES[normalizeToken(value)] ?? null;
};

export const activationChannelLabel = (value: ActivationAssetChannel | string, mode: "full" | "short" = "full") => {
  const channel = normalizeActivationChannel(value) ?? (value as ActivationAssetChannel);
  const labels = mode === "short" ? ACTIVATION_CHANNEL_SHORT_LABELS : ACTIVATION_CHANNEL_LABELS;
  return labels[channel] ?? value;
};

export const activationChannelMark = (value: ActivationAssetChannel | string) => {
  const channel = normalizeActivationChannel(value) ?? (value as ActivationAssetChannel);
  return ACTIVATION_CHANNEL_MARKS[channel] ?? value.slice(0, 4);
};

export const normalizeActivationAssetType = (value: unknown): ActivationAssetType | null => {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = normalizeToken(value);
  const aliases: Record<string, ActivationAssetType> = {
    copy: "copy_snippet",
    copy_snippet: "copy_snippet",
    snippet: "copy_snippet",
    text_snippet: "copy_snippet",
    image: "image",
    image_ref: "image",
    cta: "cta",
    button: "cta",
    call_to_action: "cta",
    offer: "offer",
    website_banner: "website_banner",
    web_banner: "website_banner",
    banner: "website_banner",
    hero: "website_banner",
    popup_banner: "popup_banner",
    popup: "popup_banner",
    modal: "popup_banner",
    email_block: "email_block",
    email: "email_block",
    push_message: "push_message",
    push: "push_message",
    mobile_push: "push_message",
    whatsapp_message: "whatsapp_message",
    whatsapp: "whatsapp_message",
    wa: "whatsapp_message",
    journey_asset: "journey_asset",
    journey: "journey_asset",
    journey_canvas: "journey_asset",
    bundle: "bundle"
  };
  return aliases[normalized] ?? null;
};

export const inferActivationAssetTypeFromText = (value: string): ActivationAssetType | null => {
  const normalized = normalizeActivationAssetType(value);
  if (normalized) return normalized;
  const text = value.toLowerCase();
  if (text.includes("whatsapp")) return "whatsapp_message";
  if (text.includes("push")) return "push_message";
  if (text.includes("email")) return "email_block";
  if (text.includes("journey")) return "journey_asset";
  if (text.includes("popup") || text.includes("modal")) return "popup_banner";
  if (text.includes("banner") || text.includes("hero")) return "website_banner";
  if (text.includes("image")) return "image";
  if (text.includes("copy") || text.includes("snippet")) return "copy_snippet";
  if (text.includes("cta") || text.includes("button")) return "cta";
  if (text.includes("offer")) return "offer";
  if (text.includes("bundle")) return "bundle";
  return null;
};

export const activationAssetTypeOptions: Array<{ value: ActivationAssetType; label: string }> = ACTIVATION_ASSET_TYPES.map((assetType) => ({
  value: assetType,
  label: activationAssetTypeLabel(assetType)
}));

export const activationAssetTypeFilterOptions: Array<{ value: "" | ActivationAssetType; label: string }> = [
  { value: "", label: "All types" },
  ...ACTIVATION_ASSET_TYPES.map((assetType) => ({
    value: assetType,
    label: activationAssetTypePluralLabel(assetType)
  }))
];

export const activationChannelFilterOptions: Array<{ value: "" | ActivationAssetChannel; label: string }> = [
  { value: "", label: "All channels" },
  ...Object.entries(ACTIVATION_CHANNEL_LABELS).map(([value, label]) => ({
    value: value as ActivationAssetChannel,
    label
  }))
];

export const activationAssetCreationOptions: ActivationAssetCreationOption[] = ACTIVATION_ASSET_TYPES.map((assetType) => {
  const definition = getActivationAssetTypeDefinition(assetType);
  return {
    assetType,
    label: definition.label,
    group: definition.creationGroup,
    description: definition.description,
    channels: [...definition.defaultChannels],
    templateHint: definition.defaultTemplateKey ?? `${definition.label} editor`
  };
});

export const activationAssetCreationGroups = ACTIVATION_ASSET_CREATION_GROUPS;

export const activationAssetPickerCategories = (mode: ActivationAssetPickerMode = "runtime_asset") => [
  ...ACTIVATION_ASSET_PICKER_CATEGORIES[mode]
];

export const activationAssetIsSelectableInPicker = (
  item: ActivationAssetCategoryInput,
  mode: ActivationAssetPickerMode = "runtime_asset",
  allowedCategories = activationAssetPickerCategories(mode)
) => allowedCategories.includes(item.category);

export const activationAssetBrowseTabs: ActivationAssetBrowseTab[] = [
  { id: "all", label: "All Assets", description: "Every governed activation asset in one library." },
  { id: "images", label: "Images", assetType: "image", description: "Thumbnail-forward reusable image references." },
  { id: "copy", label: "Copy", assetType: "copy_snippet", description: "Reusable snippets, tokenized copy, and fragments." },
  { id: "ctas", label: "CTAs", assetType: "cta", description: "Reusable labels, URLs, and deeplinks." },
  { id: "offers", label: "Offers", assetType: "offer", description: "Decision-ready offer objects." },
  { id: "channel", label: "Channel Assets", category: "channel", description: "Campaign-ready assets by channel and template." },
  { id: "bundles", label: "Bundles", assetType: "bundle", description: "Composed packages of governed assets." }
];

export const normalizeActivationChannels = (value: unknown): ActivationAssetChannel[] => {
  if (!Array.isArray(value)) {
    const single = normalizeActivationChannel(value);
    return single ? [single] : [];
  }
  return stableList(value.map(normalizeActivationChannel).filter((entry): entry is ActivationAssetChannel => Boolean(entry)));
};

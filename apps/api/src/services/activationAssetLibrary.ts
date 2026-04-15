import type { CatalogReadinessResult } from "./catalogChangeManagement";

export type ActivationAssetCategory = "primitive" | "channel" | "composite";
export type ActivationAssetEntityType = "offer" | "content" | "bundle";
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

export interface ActivationPrimitiveReference {
  kind: "image" | "copy_snippet" | "cta" | "offer";
  key: string;
  path: string;
  resolved: boolean;
}

export interface ActivationLibraryAssetInput {
  entityType: ActivationAssetEntityType;
  key: string;
  name: string;
  description?: string | null;
  status: string;
  version: number;
  updatedAt: Date | string;
  tags?: unknown;
  templateId?: string | null;
  offerKey?: string | null;
  contentKey?: string | null;
  templateKey?: string | null;
  placementKeys?: unknown;
  channels?: unknown;
  locales?: unknown;
  metadataJson?: unknown;
  schemaJson?: unknown;
  valueJson?: unknown;
  localesJson?: unknown;
  variants?: Array<{
    locale?: string | null;
    channel?: string | null;
    placementKey?: string | null;
    payloadJson?: unknown;
    metadataJson?: unknown;
  }>;
}

export interface ActivationLibraryItem {
  id: string;
  entityType: ActivationAssetEntityType;
  key: string;
  name: string;
  description: string | null;
  version: number;
  status: string;
  category: ActivationAssetCategory;
  assetType: ActivationAssetType;
  assetTypeLabel: string;
  compatibility: ActivationCompatibility;
  primitiveReferences: ActivationPrimitiveReference[];
  brokenPrimitiveReferences: ActivationPrimitiveReference[];
  readiness?: Pick<CatalogReadinessResult, "status" | "riskLevel" | "summary">;
  health?: "healthy" | "warning" | "critical";
  usedInCount: number;
  updatedAt: string;
  preview: {
    title: string;
    subtitle: string | null;
    thumbnailUrl: string | null;
    snippet: string | null;
  };
  runtimeRef: {
    offerKey?: string;
    contentKey?: string;
    bundleKey?: string;
  };
}

export interface ActivationLibraryFilter {
  q?: string;
  category?: ActivationAssetCategory;
  assetType?: ActivationAssetType;
  channel?: string;
  templateKey?: string;
  placementKey?: string;
  locale?: string;
  journeyNodeContext?: string;
  status?: string;
  includeUnready?: boolean;
}

export interface ActivationCompatibilityDecision {
  eligible: boolean;
  reasons: string[];
}

export type ActivationAssetCreationTarget = ActivationAssetEntityType;

export interface ActivationTypedCreationInput {
  assetType: ActivationAssetType;
  key?: string | null;
  name?: string | null;
  locale?: string | null;
  now?: Date | string;
}

export interface ActivationTypedCreationDraft {
  assetType: ActivationAssetType;
  assetTypeLabel: string;
  category: ActivationAssetCategory;
  targetEntityType: ActivationAssetCreationTarget;
  description: string;
  guidance: string;
  routePath: string;
  compatibility: ActivationCompatibility;
  body: Record<string, unknown>;
}

const CHANNEL_ALIASES: Record<string, ActivationAssetChannel> = {
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

const TYPE_LABELS: Record<ActivationAssetType, string> = {
  image: "Image",
  copy_snippet: "Copy Snippet",
  cta: "CTA",
  offer: "Offer",
  website_banner: "Website Banner",
  popup_banner: "Popup Banner",
  email_block: "Email Block",
  push_message: "Push Message",
  whatsapp_message: "WhatsApp Message",
  journey_asset: "Journey Asset",
  bundle: "Bundle"
};

const TYPE_CATEGORY: Record<ActivationAssetType, ActivationAssetCategory> = {
  image: "primitive",
  copy_snippet: "primitive",
  cta: "primitive",
  offer: "primitive",
  website_banner: "channel",
  popup_banner: "channel",
  email_block: "channel",
  push_message: "channel",
  whatsapp_message: "channel",
  journey_asset: "channel",
  bundle: "composite"
};

const TYPE_DEFAULT_CHANNELS: Record<ActivationAssetType, ActivationAssetChannel[]> = {
  image: ["website_personalization", "popup_banner", "email"],
  copy_snippet: ["website_personalization", "popup_banner", "email", "mobile_push", "whatsapp", "journey_canvas"],
  cta: ["website_personalization", "popup_banner", "email", "mobile_push", "whatsapp", "journey_canvas"],
  offer: ["website_personalization", "popup_banner", "email", "mobile_push", "whatsapp", "journey_canvas"],
  website_banner: ["website_personalization"],
  popup_banner: ["popup_banner"],
  email_block: ["email"],
  push_message: ["mobile_push"],
  whatsapp_message: ["whatsapp"],
  journey_asset: ["journey_canvas"],
  bundle: []
};

const DEFAULT_CREATION_LOCALE = "en";

const TYPE_TEMPLATE_DEFAULTS: Partial<Record<ActivationAssetType, string>> = {
  image: "image_ref_v1",
  copy_snippet: "copy_snippet_v1",
  cta: "cta_v1",
  website_banner: "banner_v1",
  popup_banner: "popup_banner_v1",
  email_block: "email_block_v1",
  push_message: "push_message_v1",
  whatsapp_message: "whatsapp_message_v1",
  journey_asset: "journey_asset_v1"
};

const TYPE_PLACEMENT_DEFAULTS: Partial<Record<ActivationAssetType, string[]>> = {
  website_banner: ["home_top"],
  popup_banner: ["modal"],
  journey_asset: ["journey_node"]
};

const TYPE_USE_CASE_DEFAULTS: Record<ActivationAssetType, string> = {
  image: "Reusable governed image reference",
  copy_snippet: "Reusable token-aware copy snippet",
  cta: "Reusable call to action",
  offer: "Decision-ready offer",
  website_banner: "Website personalization banner",
  popup_banner: "Popup banner or modal",
  email_block: "Reusable email content block",
  push_message: "Mobile push notification",
  whatsapp_message: "WhatsApp message",
  journey_asset: "Journey-compatible content asset",
  bundle: "Reusable package of governed assets"
};

const TYPE_CREATION_GUIDANCE: Record<ActivationAssetType, string> = {
  image: "Stores an image reference and descriptive metadata as a primitive content block. Binary upload and transformations stay outside this sprint.",
  copy_snippet: "Stores reusable text with token guidance as a primitive content block.",
  cta: "Stores reusable button label and target fields as a primitive content block.",
  offer: "Creates a governed offer draft with starter discount fields.",
  website_banner: "Creates a website-compatible content block with banner fields, template metadata, and a default website variant.",
  popup_banner: "Creates a popup-compatible content block with modal copy, action, and image-reference fields.",
  email_block: "Creates an email-compatible content block with headline, body, CTA, image, and footer fields.",
  push_message: "Creates a mobile-push content block with short title, body, and deeplink fields.",
  whatsapp_message: "Creates a WhatsApp-compatible content block with body, button, action, and token guidance.",
  journey_asset: "Creates a journey-compatible content block that can be selected through the existing content asset path.",
  bundle: "Creates a governed bundle draft for packaging an offer and content block with compatibility metadata."
};

const TYPE_KEY_PREFIX: Record<ActivationAssetType, string> = {
  image: "IMAGE",
  copy_snippet: "COPY",
  cta: "CTA",
  offer: "OFFER",
  website_banner: "WEB_BANNER",
  popup_banner: "POPUP",
  email_block: "EMAIL_BLOCK",
  push_message: "PUSH",
  whatsapp_message: "WHATSAPP",
  journey_asset: "JOURNEY_ASSET",
  bundle: "BUNDLE"
};

const CONTENT_TARGET_TYPES = new Set<ActivationAssetType>([
  "image",
  "copy_snippet",
  "cta",
  "website_banner",
  "popup_banner",
  "email_block",
  "push_message",
  "whatsapp_message",
  "journey_asset"
]);

const isObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const stableList = (values: Iterable<string>) =>
  [...new Set([...values].map((value) => value.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));

const normalizeStringList = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return stableList(value.filter((entry): entry is string => typeof entry === "string"));
};

export const normalizeActivationChannel = (value: unknown): ActivationAssetChannel | null => {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase().replace(/\s+/g, "_").replace(/-/g, "_");
  return CHANNEL_ALIASES[normalized] ?? null;
};

const normalizeChannels = (value: unknown): ActivationAssetChannel[] => {
  if (!Array.isArray(value)) {
    const single = normalizeActivationChannel(value);
    return single ? [single] : [];
  }
  return stableList(value.map(normalizeActivationChannel).filter((entry): entry is ActivationAssetChannel => Boolean(entry))) as ActivationAssetChannel[];
};

const metadataRecord = (asset: ActivationLibraryAssetInput): Record<string, unknown> => {
  const sources = [
    isObject(asset.metadataJson) ? asset.metadataJson : null,
    isObject(asset.schemaJson) ? asset.schemaJson : null,
    ...(asset.variants ?? []).map((variant) => (isObject(variant.metadataJson) ? variant.metadataJson : null))
  ].filter((entry): entry is Record<string, unknown> => Boolean(entry));

  const merged: Record<string, unknown> = {};
  for (const source of sources) {
    const library = isObject(source.library) ? source.library : {};
    const activationAsset = isObject(source.activationAsset) ? source.activationAsset : {};
    Object.assign(merged, source, activationAsset, library);
  }
  return merged;
};

const tagValues = (asset: ActivationLibraryAssetInput) => normalizeStringList(asset.tags);

const valuesForPrefix = (tags: string[], prefix: string) =>
  stableList(tags.filter((tag) => tag.toLowerCase().startsWith(prefix)).map((tag) => tag.slice(prefix.length)));

const stringValue = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);

const keySafe = (value: string) =>
  value
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_{2,}/g, "_")
    .toUpperCase();

const compactTimestamp = (value: Date | string | undefined) => {
  const date = value instanceof Date ? value : value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) {
    return "NEW";
  }
  return date.toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
};

const defaultNameForType = (assetType: ActivationAssetType) => `New ${TYPE_LABELS[assetType]}`;

const creationKeyFor = (input: ActivationTypedCreationInput) => {
  if (input.key?.trim()) {
    return keySafe(input.key);
  }
  if (input.name?.trim()) {
    return keySafe(`${TYPE_KEY_PREFIX[input.assetType]}_${input.name}`);
  }
  return `${TYPE_KEY_PREFIX[input.assetType]}_${compactTimestamp(input.now)}`;
};

const creationNameFor = (input: ActivationTypedCreationInput) => input.name?.trim() || defaultNameForType(input.assetType);

const schemaFromFields = (required: string[], optional: string[] = []) => ({
  type: "object",
  required,
  properties: [...required, ...optional].reduce<Record<string, { type: string }>>((acc, field) => {
    acc[field] = { type: "string" };
    return acc;
  }, {})
});

const payloadForCreationType = (assetType: ActivationAssetType, name: string) => {
  switch (assetType) {
    case "image":
      return {
        title: name,
        imageRef: "https://example.com/image.jpg",
        imageUrl: "https://example.com/image.jpg",
        description: "Describe source, rights, and intended use.",
        tags: "brand, campaign"
      };
    case "copy_snippet":
      return {
        title: name,
        text: "Hi {{profile.first_name}}, add reusable copy here.",
        tokenGuide: "Use {{profile.attribute}}, {{context.value}}, or {{derived.value}} tokens."
      };
    case "cta":
      return {
        title: name,
        ctaLabel: "Shop now",
        ctaUrl: "https://example.com",
        actionType: "open_url"
      };
    case "popup_banner":
      return {
        title: name,
        body: "Short popup copy for this audience.",
        ctaLabel: "Continue",
        ctaUrl: "https://example.com",
        imageRef: ""
      };
    case "email_block":
      return {
        headline: name,
        body: "Email body copy with {{profile.first_name}} token support.",
        ctaLabel: "Open",
        ctaUrl: "https://example.com",
        imageRef: "",
        footer: "You are receiving this because you opted in."
      };
    case "push_message":
      return {
        title: name,
        body: "Short push message.",
        deeplink: "app://home",
        action: "open_app"
      };
    case "whatsapp_message":
      return {
        title: name,
        body: "Hi {{profile.first_name}}, your update is ready.",
        buttonLabel: "Open",
        buttonAction: "https://example.com",
        variableGuide: "Use approved WhatsApp template variables where required."
      };
    case "journey_asset":
      return {
        title: name,
        body: "Journey step copy.",
        nextStep: "Continue",
        ctaLabel: "Next",
        ctaUrl: "https://example.com"
      };
    case "website_banner":
    default:
      return {
        title: name,
        subtitle: "Personalized website message for this audience.",
        cta: "Open",
        image: "image_asset_key_or_url",
        deeplink: "https://example.com"
      };
  }
};

const schemaForCreationType = (assetType: ActivationAssetType) => {
  switch (assetType) {
    case "image":
      return schemaFromFields(["title", "imageRef"], ["imageUrl", "description", "tags"]);
    case "copy_snippet":
      return schemaFromFields(["title", "text"], ["tokenGuide"]);
    case "cta":
      return schemaFromFields(["ctaLabel", "ctaUrl"], ["title", "actionType"]);
    case "popup_banner":
      return schemaFromFields(["title", "body", "ctaLabel", "ctaUrl"], ["imageRef"]);
    case "email_block":
      return schemaFromFields(["headline", "body", "ctaLabel", "ctaUrl"], ["imageRef", "footer"]);
    case "push_message":
      return schemaFromFields(["title", "body", "deeplink"], ["action"]);
    case "whatsapp_message":
      return schemaFromFields(["body"], ["title", "buttonLabel", "buttonAction", "variableGuide"]);
    case "journey_asset":
      return schemaFromFields(["title", "body"], ["nextStep", "ctaLabel", "ctaUrl"]);
    case "website_banner":
    default:
      return schemaFromFields(["title", "subtitle", "cta", "image", "deeplink"]);
  }
};

const tagDefaultsForCreationType = (assetType: ActivationAssetType, compatibility: ActivationCompatibility) =>
  stableList([
    "library:typed_create",
    `asset:${assetType}`,
    `category:${TYPE_CATEGORY[assetType]}`,
    `use_case:${TYPE_USE_CASE_DEFAULTS[assetType].toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")}`,
    ...compatibility.channels.map((channel) => `channel:${channel}`),
    ...compatibility.templateKeys.map((templateKey) => `template:${templateKey}`),
    ...compatibility.placementKeys.map((placementKey) => `placement:${placementKey}`)
  ]);

export const typedCreationTargetFor = (assetType: ActivationAssetType): ActivationAssetCreationTarget => {
  if (assetType === "offer") return "offer";
  if (assetType === "bundle") return "bundle";
  return "content";
};

export const buildTypedActivationAssetCreationDraft = (input: ActivationTypedCreationInput): ActivationTypedCreationDraft => {
  const assetType = input.assetType;
  const targetEntityType = typedCreationTargetFor(assetType);
  const assetTypeLabel = TYPE_LABELS[assetType];
  const category = TYPE_CATEGORY[assetType];
  const key = creationKeyFor(input);
  const name = creationNameFor(input);
  const locale = input.locale?.trim() || DEFAULT_CREATION_LOCALE;
  const compatibility: ActivationCompatibility = {
    channels: TYPE_DEFAULT_CHANNELS[assetType],
    templateKeys: TYPE_TEMPLATE_DEFAULTS[assetType] ? [TYPE_TEMPLATE_DEFAULTS[assetType]!] : [],
    placementKeys: TYPE_PLACEMENT_DEFAULTS[assetType] ?? [],
    locales: [locale],
    journeyNodeContexts: assetType === "journey_asset" ? ["message", "decision", "fallback"] : []
  };
  const tags = tagDefaultsForCreationType(assetType, compatibility);

  if (targetEntityType === "offer") {
    return {
      assetType,
      assetTypeLabel,
      category,
      targetEntityType,
      description: TYPE_USE_CASE_DEFAULTS[assetType],
      guidance: TYPE_CREATION_GUIDANCE[assetType],
      routePath: `/catalog/offers?key=${encodeURIComponent(key)}`,
      compatibility,
      body: {
        key,
        name,
        description: "Typed asset creation starter offer.",
        status: "DRAFT",
        tags,
        type: "discount",
        valueJson: {
          title: name,
          code: "STARTER10",
          percent: 10,
          assetType
        },
        constraints: {
          minSpend: 0
        },
        tokenBindings: {},
        variants: [
          {
            locale,
            channel: null,
            placementKey: null,
            isDefault: true,
            payloadJson: {
              title: name,
              code: "STARTER10",
              percent: 10
            },
            metadataJson: {
              activationAsset: {
                assetType,
                creationFlow: "typed_asset"
              },
              authoringMode: "structured"
            }
          }
        ]
      }
    };
  }

  if (targetEntityType === "bundle") {
    return {
      assetType,
      assetTypeLabel,
      category,
      targetEntityType,
      description: TYPE_USE_CASE_DEFAULTS[assetType],
      guidance: TYPE_CREATION_GUIDANCE[assetType],
      routePath: `/catalog/bundles?key=${encodeURIComponent(key)}`,
      compatibility,
      body: {
        key,
        name,
        description: "Typed asset creation starter bundle.",
        status: "DRAFT",
        offerKey: null,
        contentKey: null,
        templateKey: null,
        placementKeys: [],
        channels: [],
        locales: [locale],
        tags,
        useCase: TYPE_USE_CASE_DEFAULTS[assetType],
        metadataJson: {
          activationAsset: {
            assetType,
            category,
            creationFlow: "typed_asset",
            targetEntityType
          },
          library: {
            assetType,
            category,
            locales: [locale]
          }
        }
      }
    };
  }

  if (!CONTENT_TARGET_TYPES.has(assetType)) {
    throw new Error(`Unsupported typed creation asset type: ${assetType}`);
  }

  const payload = payloadForCreationType(assetType, name);
  const templateId = TYPE_TEMPLATE_DEFAULTS[assetType] ?? "content_block_v1";
  const schemaJson = {
    ...schemaForCreationType(assetType),
    activationAsset: {
      assetType,
      category,
      creationFlow: "typed_asset",
      targetEntityType
    },
    library: {
      assetType,
      category,
      channels: compatibility.channels,
      supportedChannels: compatibility.channels,
      supportedTemplates: compatibility.templateKeys,
      supportedPlacements: compatibility.placementKeys,
      locales: compatibility.locales,
      journeyNodeContexts: compatibility.journeyNodeContexts,
      authoringMode: "structured"
    }
  };

  return {
    assetType,
    assetTypeLabel,
    category,
    targetEntityType,
    description: TYPE_USE_CASE_DEFAULTS[assetType],
    guidance: TYPE_CREATION_GUIDANCE[assetType],
    routePath: `/catalog/content?key=${encodeURIComponent(key)}`,
    compatibility,
    body: {
      key,
      name,
      description: TYPE_CREATION_GUIDANCE[assetType],
      status: "DRAFT",
      tags,
      templateId,
      schemaJson,
      localesJson: {
        [locale]: payload
      },
      tokenBindings:
        assetType === "copy_snippet" || assetType === "email_block" || assetType === "whatsapp_message"
          ? { profile: "profile" }
          : {},
      variants: [
        {
          locale,
          channel: compatibility.channels[0] ?? null,
          placementKey: compatibility.placementKeys[0] ?? null,
          isDefault: true,
          payloadJson: payload,
          metadataJson: {
            activationAsset: {
              assetType,
              creationFlow: "typed_asset"
            },
            authoringMode: "structured"
          }
        }
      ]
    }
  };
};

const inferTypeFromText = (value: string): ActivationAssetType | null => {
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
  return null;
};

export const inferActivationAssetType = (asset: ActivationLibraryAssetInput): ActivationAssetType => {
  if (asset.entityType === "bundle") return "bundle";
  if (asset.entityType === "offer") return "offer";

  const metadata = metadataRecord(asset);
  const explicitType = stringValue(metadata.assetType) ?? stringValue(metadata.type) ?? stringValue(metadata.category);
  if (explicitType) {
    const normalized = explicitType.toLowerCase().replace(/\s+/g, "_").replace(/-/g, "_");
    if (normalized === "copy" || normalized === "copy_snippet") return "copy_snippet";
    if (normalized === "image") return "image";
    if (normalized === "cta" || normalized === "button") return "cta";
    if (normalized === "website_banner" || normalized === "web_banner") return "website_banner";
    if (normalized === "popup_banner" || normalized === "popup") return "popup_banner";
    if (normalized === "email_block" || normalized === "email") return "email_block";
    if (normalized === "push_message" || normalized === "mobile_push") return "push_message";
    if (normalized === "whatsapp_message" || normalized === "whatsapp") return "whatsapp_message";
    if (normalized === "journey_asset" || normalized === "journey") return "journey_asset";
  }

  const tags = tagValues(asset);
  for (const tag of tags) {
    const lowered = tag.toLowerCase();
    const explicit = lowered.startsWith("asset:") || lowered.startsWith("asset_type:") ? tag.split(":").slice(1).join(":") : tag;
    const inferred = inferTypeFromText(explicit);
    if (inferred) return inferred;
  }

  const templateInferred = inferTypeFromText(asset.templateId ?? asset.templateKey ?? "");
  if (templateInferred) return templateInferred;

  const variantChannels = normalizeChannels((asset.variants ?? []).map((variant) => variant.channel).filter(Boolean));
  if (variantChannels.includes("whatsapp")) return "whatsapp_message";
  if (variantChannels.includes("mobile_push")) return "push_message";
  if (variantChannels.includes("email")) return "email_block";
  if (variantChannels.includes("popup_banner")) return "popup_banner";
  if (variantChannels.includes("journey_canvas")) return "journey_asset";
  return "website_banner";
};

export const deriveActivationCompatibility = (asset: ActivationLibraryAssetInput, assetType = inferActivationAssetType(asset)): ActivationCompatibility => {
  const metadata = metadataRecord(asset);
  const tags = tagValues(asset);
  const variantChannels = (asset.variants ?? []).flatMap((variant) => (variant.channel ? [variant.channel] : []));
  const variantPlacements = (asset.variants ?? []).flatMap((variant) => (variant.placementKey ? [variant.placementKey] : []));
  const variantLocales = (asset.variants ?? []).flatMap((variant) => (variant.locale ? [variant.locale] : []));
  const channels = normalizeChannels([
    ...normalizeStringList(asset.channels),
    ...normalizeStringList(metadata.channels),
    ...normalizeStringList(metadata.supportedChannels),
    ...valuesForPrefix(tags, "channel:"),
    ...variantChannels
  ]);
  const templateKeys = stableList([
    ...(asset.templateId ? [asset.templateId] : []),
    ...(asset.templateKey ? [asset.templateKey] : []),
    ...normalizeStringList(metadata.templates),
    ...normalizeStringList(metadata.templateKeys),
    ...normalizeStringList(metadata.supportedTemplates),
    ...valuesForPrefix(tags, "template:")
  ]);
  const placementKeys = stableList([
    ...normalizeStringList(asset.placementKeys),
    ...normalizeStringList(metadata.placements),
    ...normalizeStringList(metadata.placementKeys),
    ...normalizeStringList(metadata.supportedPlacements),
    ...valuesForPrefix(tags, "placement:"),
    ...variantPlacements
  ]);
  const locales = stableList([
    ...normalizeStringList(asset.locales),
    ...normalizeStringList(metadata.locales),
    ...normalizeStringList(metadata.markets),
    ...valuesForPrefix(tags, "locale:"),
    ...variantLocales
  ]);
  const journeyNodeContexts = stableList([
    ...normalizeStringList(metadata.journeyNodeContexts),
    ...normalizeStringList(metadata.nodeTypes),
    ...normalizeStringList(metadata.supportedJourneyNodeContexts),
    ...valuesForPrefix(tags, "journey_node:")
  ]);

  return {
    channels: channels.length > 0 ? channels : TYPE_DEFAULT_CHANNELS[assetType],
    templateKeys,
    placementKeys,
    locales,
    journeyNodeContexts
  };
};

const isExternalImageOrUrl = (value: string) => {
  return /^(https?:\/\/|data:|\/|\{\{)/i.test(value.trim());
};

const primitiveReferenceField: Record<string, ActivationPrimitiveReference["kind"]> = {
  imageAssetKey: "image",
  image_asset_key: "image",
  copySnippetKey: "copy_snippet",
  copy_snippet_key: "copy_snippet",
  ctaAssetKey: "cta",
  cta_asset_key: "cta",
  offerKey: "offer"
};

export const collectActivationPrimitiveReferences = (
  value: unknown,
  known: Partial<Record<ActivationPrimitiveReference["kind"], Set<string>>> = {},
  path = "$"
): ActivationPrimitiveReference[] => {
  const refs: ActivationPrimitiveReference[] = [];
  const walk = (entry: unknown, currentPath: string) => {
    if (Array.isArray(entry)) {
      entry.forEach((item, index) => walk(item, `${currentPath}[${index}]`));
      return;
    }
    if (!isObject(entry)) {
      return;
    }
    for (const [field, nested] of Object.entries(entry)) {
      const nestedPath = `${currentPath}.${field}`;
      const kind = primitiveReferenceField[field];
      if (kind && typeof nested === "string" && nested.trim()) {
        const key = nested.trim();
        refs.push({
          kind,
          key,
          path: nestedPath,
          resolved: known[kind]?.has(key) ?? false
        });
      } else if (field === "imageRef" && typeof nested === "string" && nested.trim() && !isExternalImageOrUrl(nested)) {
        const key = nested.trim();
        refs.push({
          kind: "image",
          key,
          path: nestedPath,
          resolved: known.image?.has(key) ?? false
        });
      }
      walk(nested, nestedPath);
    }
  };
  walk(value, path);
  return refs;
};

const previewFromRecord = (payload: Record<string, unknown>): ActivationLibraryItem["preview"] => {
  const title = stringValue(payload.title) ?? stringValue(payload.headline) ?? stringValue(payload.subject) ?? stringValue(payload.name) ?? "Untitled asset";
  const subtitle = stringValue(payload.subtitle) ?? stringValue(payload.body) ?? stringValue(payload.copy) ?? stringValue(payload.text) ?? stringValue(payload.description);
  const thumbnailUrl = stringValue(payload.imageUrl) ?? stringValue(payload.imageRef) ?? stringValue(payload.image);
  const snippet = subtitle ?? stringValue(payload.ctaLabel) ?? stringValue(payload.promoCode);
  return {
    title,
    subtitle,
    thumbnailUrl: thumbnailUrl && isExternalImageOrUrl(thumbnailUrl) ? thumbnailUrl : null,
    snippet
  };
};

const hasPreviewSignal = (payload: Record<string, unknown>) => {
  return Boolean(
    stringValue(payload.title) ??
      stringValue(payload.headline) ??
      stringValue(payload.subject) ??
      stringValue(payload.name) ??
      stringValue(payload.subtitle) ??
      stringValue(payload.body) ??
      stringValue(payload.copy) ??
      stringValue(payload.text) ??
      stringValue(payload.description) ??
      stringValue(payload.imageUrl) ??
      stringValue(payload.imageRef) ??
      stringValue(payload.image) ??
      stringValue(payload.ctaLabel) ??
      stringValue(payload.promoCode)
  );
};

const previewFromPayload = (value: unknown): ActivationLibraryItem["preview"] => {
  const candidates: Record<string, unknown>[] = [];
  if (isObject(value)) candidates.push(value);
  if (isObject(value) && isObject(value.en)) candidates.push(value.en);
  if (isObject(value)) {
    for (const nested of Object.values(value)) {
      if (isObject(nested)) candidates.push(nested);
    }
  }
  return previewFromRecord(candidates.find(hasPreviewSignal) ?? {});
};

export const buildActivationLibraryItem = (input: {
  asset: ActivationLibraryAssetInput;
  knownPrimitiveKeys?: Partial<Record<ActivationPrimitiveReference["kind"], Set<string>>>;
  readiness?: Pick<CatalogReadinessResult, "status" | "riskLevel" | "summary">;
  health?: "healthy" | "warning" | "critical";
  usedInCount?: number;
}): ActivationLibraryItem => {
  const assetType = inferActivationAssetType(input.asset);
  const compatibility = deriveActivationCompatibility(input.asset, assetType);
  const payloadSources = [
    ...(input.asset.valueJson !== undefined && input.asset.valueJson !== null ? [{ value: input.asset.valueJson, path: "$.valueJson" }] : []),
    ...(input.asset.localesJson !== undefined && input.asset.localesJson !== null ? [{ value: input.asset.localesJson, path: "$.localesJson" }] : []),
    ...(input.asset.variants ?? []).flatMap((variant, index) =>
      variant.payloadJson !== undefined && variant.payloadJson !== null
        ? [{ value: variant.payloadJson, path: `$.variants[${index}].payloadJson` }]
        : []
    )
  ];
  const primitiveReferences = payloadSources.flatMap((payload) =>
    collectActivationPrimitiveReferences(payload.value, input.knownPrimitiveKeys, payload.path)
  );
  const preview = previewFromPayload(input.asset.valueJson ?? input.asset.localesJson ?? input.asset.variants?.[0]?.payloadJson ?? {});
  const updatedAt = input.asset.updatedAt instanceof Date ? input.asset.updatedAt.toISOString() : input.asset.updatedAt;
  return {
    id: `${input.asset.entityType}:${input.asset.key}:${input.asset.version}`,
    entityType: input.asset.entityType,
    key: input.asset.key,
    name: input.asset.name,
    description: input.asset.description ?? null,
    version: input.asset.version,
    status: input.asset.status,
    category: TYPE_CATEGORY[assetType],
    assetType,
    assetTypeLabel: TYPE_LABELS[assetType],
    compatibility,
    primitiveReferences,
    brokenPrimitiveReferences: primitiveReferences.filter((ref) => !ref.resolved),
    readiness: input.readiness,
    health: input.health,
    usedInCount: input.usedInCount ?? 0,
    updatedAt,
    preview: {
      ...preview,
      title: preview.title === "Untitled asset" ? input.asset.name : preview.title
    },
    runtimeRef:
      input.asset.entityType === "offer"
        ? { offerKey: input.asset.key }
        : input.asset.entityType === "content"
          ? { contentKey: input.asset.key }
          : { bundleKey: input.asset.key, ...(input.asset.offerKey ? { offerKey: input.asset.offerKey } : {}), ...(input.asset.contentKey ? { contentKey: input.asset.contentKey } : {}) }
  };
};

export const evaluateActivationCompatibility = (
  item: Pick<ActivationLibraryItem, "compatibility" | "readiness" | "status">,
  filter: Pick<ActivationLibraryFilter, "channel" | "templateKey" | "placementKey" | "locale" | "journeyNodeContext" | "includeUnready">
): ActivationCompatibilityDecision => {
  const reasons: string[] = [];
  const channel = normalizeActivationChannel(filter.channel);
  if (channel && item.compatibility.channels.length > 0 && !item.compatibility.channels.includes(channel)) {
    reasons.push(`Channel ${channel} is not supported.`);
  }
  if (filter.templateKey?.trim() && item.compatibility.templateKeys.length > 0 && !item.compatibility.templateKeys.includes(filter.templateKey.trim())) {
    reasons.push(`Template ${filter.templateKey.trim()} is not supported.`);
  }
  if (filter.placementKey?.trim() && item.compatibility.placementKeys.length > 0 && !item.compatibility.placementKeys.includes(filter.placementKey.trim())) {
    reasons.push(`Placement ${filter.placementKey.trim()} is not supported.`);
  }
  if (filter.locale?.trim() && item.compatibility.locales.length > 0) {
    const locale = filter.locale.trim();
    const language = locale.split("-")[0] ?? locale;
    if (!item.compatibility.locales.includes(locale) && !item.compatibility.locales.includes(language)) {
      reasons.push(`Locale ${locale} is not supported.`);
    }
  }
  if (
    filter.journeyNodeContext?.trim() &&
    item.compatibility.journeyNodeContexts.length > 0 &&
    !item.compatibility.journeyNodeContexts.includes(filter.journeyNodeContext.trim())
  ) {
    reasons.push(`Journey node context ${filter.journeyNodeContext.trim()} is not supported.`);
  }
  if (!filter.includeUnready && item.readiness?.status === "blocked") {
    reasons.push("Asset readiness is blocked.");
  }
  if (item.status === "ARCHIVED") {
    reasons.push("Asset is archived.");
  }
  return {
    eligible: reasons.length === 0,
    reasons
  };
};

export const filterActivationLibraryItems = (items: ActivationLibraryItem[], filter: ActivationLibraryFilter): ActivationLibraryItem[] => {
  const query = filter.q?.trim().toLowerCase();
  const assetType = filter.assetType;
  const category = filter.category;
  const status = filter.status?.trim();
  return items.filter((item) => {
    if (query && !`${item.key} ${item.name} ${item.assetTypeLabel} ${item.preview.snippet ?? ""}`.toLowerCase().includes(query)) {
      return false;
    }
    if (assetType && item.assetType !== assetType) {
      return false;
    }
    if (category && item.category !== category) {
      return false;
    }
    if (status && item.status !== status) {
      return false;
    }
    return evaluateActivationCompatibility(item, filter).eligible;
  });
};

export const describeActivationAssetSnapshot = (asset: ActivationLibraryAssetInput): string[] => {
  const assetType = inferActivationAssetType(asset);
  const compatibility = deriveActivationCompatibility(asset, assetType);
  const notes = [`Activation asset type: ${TYPE_LABELS[assetType]}`];
  if (compatibility.channels.length > 0) {
    notes.push(`Compatible channels: ${compatibility.channels.join(", ")}`);
  }
  if (compatibility.templateKeys.length > 0) {
    notes.push(`Compatible templates: ${compatibility.templateKeys.join(", ")}`);
  }
  if (compatibility.placementKeys.length > 0) {
    notes.push(`Compatible placements: ${compatibility.placementKeys.join(", ")}`);
  }
  return notes;
};

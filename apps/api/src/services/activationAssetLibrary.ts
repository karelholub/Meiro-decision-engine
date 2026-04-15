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

const previewFromPayload = (value: unknown): ActivationLibraryItem["preview"] => {
  const candidates: Record<string, unknown>[] = [];
  if (isObject(value)) candidates.push(value);
  if (isObject(value) && isObject(value.en)) candidates.push(value.en);
  if (isObject(value)) {
    for (const nested of Object.values(value)) {
      if (isObject(nested)) candidates.push(nested);
    }
  }
  const payload = candidates[0] ?? {};
  const title = stringValue(payload.title) ?? stringValue(payload.headline) ?? stringValue(payload.subject) ?? stringValue(payload.name) ?? "Untitled asset";
  const subtitle = stringValue(payload.subtitle) ?? stringValue(payload.body) ?? stringValue(payload.copy) ?? stringValue(payload.text);
  const thumbnailUrl = stringValue(payload.imageUrl) ?? stringValue(payload.imageRef) ?? stringValue(payload.image);
  const snippet = subtitle ?? stringValue(payload.ctaLabel) ?? stringValue(payload.promoCode);
  return {
    title,
    subtitle,
    thumbnailUrl: thumbnailUrl && isExternalImageOrUrl(thumbnailUrl) ? thumbnailUrl : null,
    snippet
  };
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
  const payloads = [input.asset.valueJson, input.asset.localesJson, ...(input.asset.variants ?? []).map((variant) => variant.payloadJson)].filter(
    (entry) => entry !== undefined && entry !== null
  );
  const primitiveReferences = payloads.flatMap((payload, index) =>
    collectActivationPrimitiveReferences(payload, input.knownPrimitiveKeys, index === 0 ? "$" : `$.variants[${index - 1}].payloadJson`)
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

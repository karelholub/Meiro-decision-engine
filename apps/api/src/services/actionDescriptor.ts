import type { Environment } from "@prisma/client";
import type { ActionDescriptorV1 } from "@decisioning/shared";

const isObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const toTags = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0))].sort((a, b) =>
    a.localeCompare(b)
  );
};

const firstString = (...candidates: unknown[]): string | undefined => {
  const found = candidates.find((candidate) => typeof candidate === "string" && candidate.trim().length > 0);
  return typeof found === "string" ? found.trim() : undefined;
};

export type RuntimeActionDescriptor = ActionDescriptorV1 & { actionKey?: string };

interface BuildActionDescriptorResult {
  actionType: string;
  payload?: Record<string, unknown>;
  tags?: string[];
  actionKey?: string;
  offerKey?: string;
  contentKey?: string;
  campaignKey?: string;
}

interface BuildActionDescriptorContext {
  environment: Environment;
  appKey?: string;
  placement?: string;
  explicitTags?: string[];
  campaignTags?: string[];
  metadata?: Record<string, unknown>;
  catalogResolver: {
    resolveOfferTags: (input: { environment: Environment; offerKey?: string | null }) => Promise<string[]>;
    resolveContentTags: (input: { environment: Environment; contentKey?: string | null }) => Promise<string[]>;
  };
}

export const buildActionDescriptor = async (
  result: BuildActionDescriptorResult,
  context: BuildActionDescriptorContext
): Promise<RuntimeActionDescriptor> => {
  const payload = isObject(result.payload) ? result.payload : {};
  const payloadRef = isObject(payload.payloadRef) ? payload.payloadRef : {};
  const tracking = isObject(payload.tracking) ? payload.tracking : {};
  const payloadOffer = isObject(payload.offer) ? payload.offer : {};
  const payloadContent = isObject(payload.content) ? payload.content : {};

  const offerKey = firstString(result.offerKey, payloadRef.offerKey, payloadOffer.key, payload.offerKey);
  const contentKey = firstString(result.contentKey, payloadRef.contentKey, payloadContent.key, payload.contentKey);
  const campaignKey = firstString(
    result.campaignKey,
    payload.campaignKey,
    payload.campaign_id,
    tracking.campaign_id,
    tracking.campaign
  );

  const offerTagsPromise = context.catalogResolver.resolveOfferTags({
    environment: context.environment,
    offerKey: offerKey ?? null
  });
  const contentTagsPromise = context.catalogResolver.resolveContentTags({
    environment: context.environment,
    contentKey: contentKey ?? null
  });
  const [offerTags, contentTags] = await Promise.all([offerTagsPromise, contentTagsPromise]);

  const tags = [
    ...new Set([
      ...toTags(payload.tags),
      ...toTags(result.tags),
      ...toTags(context.explicitTags),
      ...toTags(context.campaignTags),
      ...offerTags,
      ...contentTags
    ])
  ].sort((a, b) => a.localeCompare(b));

  const actionKey = firstString(
    result.actionKey,
    payload.actionKey,
    payload.campaignId,
    payload.campaign_id,
    payload.offerId,
    payload.offerKey,
    payload.contentId,
    payload.contentKey,
    payload.templateId,
    payload.templateKey,
    campaignKey,
    offerKey,
    contentKey
  );

  const descriptor: RuntimeActionDescriptor = {
    actionType: result.actionType,
    appKey: firstString(payload.appKey, context.appKey),
    placement: firstString(payload.placement, context.placement),
    tags,
    ...(offerKey ? { offerKey } : {}),
    ...(contentKey ? { contentKey } : {}),
    ...(campaignKey ? { campaignKey } : {}),
    ...(actionKey ? { actionKey } : {}),
    ...(context.metadata ? { metadata: context.metadata } : {})
  };

  return descriptor;
};

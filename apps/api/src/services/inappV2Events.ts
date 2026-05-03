import { createHash } from "node:crypto";
import { type InAppEventType, type Environment } from "@prisma/client";
import type { FastifyBaseLogger } from "fastify";
import type { JsonCache } from "../lib/cache";

const isObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const hashSha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

export class InAppV2EventsError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number
  ) {
    super(message);
  }
}

export interface InAppV2EventBody {
  eventType: InAppEventType;
  ts?: string;
  appKey: string;
  placement: string;
  tracking: {
    schema_version?: string;
    source_system?: string;
    campaign_id: string;
    message_id: string;
    variant_id: string;
    activation_campaign_id?: string;
    native_meiro_campaign_id?: string;
    creative_asset_id?: string;
    native_meiro_asset_id?: string;
    offer_catalog_id?: string;
    native_meiro_catalog_id?: string;
    prism_source_id?: string;
    imported_from?: string;
    decision_key?: string;
    decision_stack_key?: string;
    placement_key?: string;
    template_key?: string;
    content_block_id?: string;
    offer_id?: string;
    bundle_id?: string;
    channel?: string;
    experiment_id?: string;
    experiment_version?: number;
    is_holdout?: boolean;
    allocation_id?: string;
  };
  profileId?: string;
  lookup?: {
    attribute: string;
    value: string;
  };
  context?: Record<string, unknown>;
}

interface InAppV2EventsDeps {
  cache: JsonCache;
  streamKey: string;
  streamMaxLen: number;
  now: () => Date;
  redactSensitiveFields: (value: unknown, keyHint?: string) => unknown;
}

export const createInAppV2EventsService = (deps: InAppV2EventsDeps) => {
  const INAPP_EVENTS_CONTEXT_MAX_BYTES = 16 * 1024;

  const serializeContextForStream = (value: unknown): { json: string; truncated: boolean } => {
    if (!isObject(value)) {
      return { json: "{}", truncated: false };
    }
    const safe = deps.redactSensitiveFields(value);
    const serialized = JSON.stringify(safe);
    if (Buffer.byteLength(serialized, "utf8") <= INAPP_EVENTS_CONTEXT_MAX_BYTES) {
      return { json: serialized, truncated: false };
    }
    return { json: "{}", truncated: true };
  };

  const enqueue = async (input: {
    environment: Environment;
    body: InAppV2EventBody;
    logger: FastifyBaseLogger;
  }): Promise<{ status: "accepted"; stream: string; eventId: string; contextTruncated: boolean }> => {
    if (!deps.cache.enabled || !deps.cache.xadd) {
      throw new InAppV2EventsError("Redis stream unavailable", 503);
    }

    const timestamp = input.body.ts ? new Date(input.body.ts) : deps.now();
    if (Number.isNaN(timestamp.getTime())) {
      throw new InAppV2EventsError("Invalid ts value", 400);
    }

    const context = serializeContextForStream(input.body.context);
    if (context.truncated) {
      input.logger.warn(
        {
          appKey: input.body.appKey,
          placement: input.body.placement
        },
        "In-app event context exceeded 16KB and was dropped"
      );
    }

    const lookupValueHash = input.body.lookup ? hashSha256(input.body.lookup.value) : "";
    const eventId = await deps.cache.xadd(
      deps.streamKey,
      {
        environment: input.environment,
        eventType: input.body.eventType,
        ts: timestamp.toISOString(),
        appKey: input.body.appKey,
        placement: input.body.placement,
        schema_version: input.body.tracking.schema_version ?? "",
        source_system: input.body.tracking.source_system ?? "",
        campaign_id: input.body.tracking.campaign_id,
        message_id: input.body.tracking.message_id,
        variant_id: input.body.tracking.variant_id,
        activation_campaign_id: input.body.tracking.activation_campaign_id ?? "",
        native_meiro_campaign_id: input.body.tracking.native_meiro_campaign_id ?? "",
        creative_asset_id: input.body.tracking.creative_asset_id ?? "",
        native_meiro_asset_id: input.body.tracking.native_meiro_asset_id ?? "",
        offer_catalog_id: input.body.tracking.offer_catalog_id ?? "",
        native_meiro_catalog_id: input.body.tracking.native_meiro_catalog_id ?? "",
        prism_source_id: input.body.tracking.prism_source_id ?? "",
        imported_from: input.body.tracking.imported_from ?? "",
        decision_key: input.body.tracking.decision_key ?? "",
        decision_stack_key: input.body.tracking.decision_stack_key ?? "",
        placement_key: input.body.tracking.placement_key ?? "",
        template_key: input.body.tracking.template_key ?? "",
        content_block_id: input.body.tracking.content_block_id ?? "",
        offer_id: input.body.tracking.offer_id ?? "",
        bundle_id: input.body.tracking.bundle_id ?? "",
        channel: input.body.tracking.channel ?? "",
        experiment_id: input.body.tracking.experiment_id ?? "",
        experiment_version:
          typeof input.body.tracking.experiment_version === "number" ? String(input.body.tracking.experiment_version) : "",
        is_holdout: input.body.tracking.is_holdout ? "1" : "0",
        allocation_id: input.body.tracking.allocation_id ?? "",
        profileId: input.body.profileId ?? "",
        lookupAttribute: input.body.lookup?.attribute ?? "",
        lookupValueHash,
        context: context.json
      },
      {
        maxLen: deps.streamMaxLen
      }
    );

    if (!eventId) {
      input.logger.error(
        {
          appKey: input.body.appKey,
          placement: input.body.placement
        },
        "Failed to enqueue in-app event into Redis stream"
      );
      throw new InAppV2EventsError("Failed to enqueue event", 500);
    }

    return {
      status: "accepted",
      stream: deps.streamKey,
      eventId,
      contextTruncated: context.truncated
    };
  };

  return {
    enqueue
  };
};

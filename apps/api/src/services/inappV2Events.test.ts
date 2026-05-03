import { describe, expect, it } from "vitest";
import { InAppEventType } from "@prisma/client";
import { createInAppV2EventsService } from "./inappV2Events";
import type { JsonCache } from "../lib/cache";

describe("in-app v2 event enqueue", () => {
  it("passes activation measurement tracking fields into the stream", async () => {
    const writes: Array<{ stream: string; fields: Record<string, string>; options?: { maxLen?: number } }> = [];
    const cache = {
      enabled: true,
      xadd: async (stream: string, fields: Record<string, string>, options?: { maxLen?: number }) => {
        writes.push({ stream, fields, options });
        return "1-0";
      }
    } as Partial<JsonCache> as JsonCache;

    const service = createInAppV2EventsService({
      cache,
      streamKey: "inapp_events",
      streamMaxLen: 1000,
      now: () => new Date("2026-04-30T10:00:00.000Z"),
      redactSensitiveFields: (value) => value
    });

    await service.enqueue({
      environment: "PROD",
      logger: {
        warn: () => undefined,
        error: () => undefined
      } as any,
      body: {
        eventType: InAppEventType.IMPRESSION,
        appKey: "web",
        placement: "homepage_hero",
        tracking: {
          schema_version: "activation_measurement.v1",
          source_system: "deciEngine",
          campaign_id: "spring_hero",
          activation_campaign_id: "spring_hero",
          native_meiro_campaign_id: "meiro-native-spring",
          creative_asset_id: "meiro-creative-spring",
          native_meiro_asset_id: "meiro-asset-spring",
          offer_catalog_id: "catalog-spring",
          native_meiro_catalog_id: "meiro-catalog-spring",
          prism_source_id: "meiro-native-spring",
          imported_from: "pipes_prism_preview",
          decision_key: "homepage_offer_decision",
          decision_stack_key: "homepage_stack",
          message_id: "msg_spring_hero_default_123",
          variant_id: "default",
          placement_key: "homepage_hero",
          template_key: "hero_banner_v1",
          content_block_id: "spring_copy",
          offer_id: "spring_discount_10",
          channel: "web_inapp",
          experiment_id: "hero_test",
          experiment_version: 2,
          allocation_id: "alloc_123",
          is_holdout: false
        },
        profileId: "profile_123",
        context: { locale: "cs-CZ" }
      }
    });

    expect(writes).toHaveLength(1);
    expect(writes[0]?.fields).toMatchObject({
      environment: "PROD",
      schema_version: "activation_measurement.v1",
      source_system: "deciEngine",
      campaign_id: "spring_hero",
      activation_campaign_id: "spring_hero",
      native_meiro_campaign_id: "meiro-native-spring",
      creative_asset_id: "meiro-creative-spring",
      native_meiro_asset_id: "meiro-asset-spring",
      offer_catalog_id: "catalog-spring",
      native_meiro_catalog_id: "meiro-catalog-spring",
      prism_source_id: "meiro-native-spring",
      imported_from: "pipes_prism_preview",
      decision_key: "homepage_offer_decision",
      decision_stack_key: "homepage_stack",
      placement_key: "homepage_hero",
      template_key: "hero_banner_v1",
      content_block_id: "spring_copy",
      offer_id: "spring_discount_10",
      channel: "web_inapp",
      experiment_id: "hero_test",
      experiment_version: "2"
    });
  });
});

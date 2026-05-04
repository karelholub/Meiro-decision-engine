import { describe, expect, it } from "vitest";
import { InAppEventType } from "@prisma/client";
import { createInAppEventsWorker } from "./inappEventsWorker";
import type { JsonCache } from "../lib/cache";

describe("in-app events worker", () => {
  it("persists Prism activation join keys into event context", async () => {
    const rows: Array<Record<string, unknown>> = [];
    const acknowledged: string[] = [];
    let consumed = false;
    const cache = {
      enabled: true,
      getJson: async () => null,
      setJson: async () => undefined,
      del: async () => 0,
      lock: async () => null,
      scanKeys: async () => [],
      quit: async () => undefined,
      xgroupCreate: async () => "OK",
      xpendingRange: async () => [],
      xack: async (_stream: string, _group: string, ids: string[]) => {
        acknowledged.push(...ids);
        return ids.length;
      },
      xreadgroup: async () => {
        if (consumed) return [];
        consumed = true;
        return [
          {
            id: "1-0",
            fields: {
              environment: "PROD",
              eventType: InAppEventType.IMPRESSION,
              ts: "2026-04-30T10:00:00.000Z",
              appKey: "meiro_store",
              placement: "home_top",
              schema_version: "activation_measurement.v1",
              source_system: "deciEngine",
              campaign_id: "prism_campaign_push_store_order",
              message_id: "msg_prism_default_1",
              variant_id: "default",
              activation_campaign_id: "prism_campaign_push_store_order",
              native_meiro_campaign_id: "520d7a4d-d2bf-4d3a-9560-bb10f6477ef3",
              creative_asset_id: "prism_asset_push",
              native_meiro_asset_id: "meiro-asset-push",
              offer_catalog_id: "catalog-push",
              native_meiro_catalog_id: "meiro-catalog-push",
              prism_source_id: "520d7a4d-d2bf-4d3a-9560-bb10f6477ef3",
              imported_from: "pipes_prism_preview",
              channel: "push",
              profileId: "profile-1",
              context: JSON.stringify({ locale: "en" })
            }
          }
        ];
      }
    } satisfies Partial<JsonCache>;

    const prisma = {
      inAppEvent: {
        createMany: async (input: { data: Array<Record<string, unknown>> }) => {
          rows.push(...input.data);
          return { count: input.data.length };
        }
      }
    };

    const worker = createInAppEventsWorker({
      cache: cache as JsonCache,
      prisma: prisma as never,
      logger: {
        error: () => undefined,
        warn: () => undefined,
        info: () => undefined,
        debug: () => undefined
      } as never,
      config: {
        enabled: true,
        streamKey: "inapp_events",
        streamGroup: "inapp_events_group",
        consumerName: "test",
        batchSize: 10,
        blockMs: 0,
        pollMs: 1000,
        reclaimIdleMs: 1000,
        maxBatchesPerTick: 1,
        dedupeTtlSeconds: 60
      }
    });

    await worker.runTick();

    expect(rows).toHaveLength(1);
    expect(acknowledged).toEqual(["1-0"]);
    expect(rows[0]?.contextJson).toMatchObject({
      locale: "en",
      activationMeasurement: {
        activation_campaign_id: "prism_campaign_push_store_order",
        native_meiro_campaign_id: "520d7a4d-d2bf-4d3a-9560-bb10f6477ef3",
        creative_asset_id: "prism_asset_push",
        native_meiro_asset_id: "meiro-asset-push",
        offer_catalog_id: "catalog-push",
        native_meiro_catalog_id: "meiro-catalog-push",
        prism_source_id: "520d7a4d-d2bf-4d3a-9560-bb10f6477ef3",
        imported_from: "pipes_prism_preview",
        channel: "push"
      }
    });
  });
});

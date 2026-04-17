import { describe, expect, it } from "vitest";
import type { ActivationLibraryItem } from "../../lib/api";
import {
  assetCalendarUsageHref,
  assetCampaignPlanHref,
  assetEditorHref,
  campaignCreationHref,
  channelFilterLabel,
  createTypeForBrowseTab
} from "./activationAssetConfig";

const libraryItem = (patch: Partial<ActivationLibraryItem>): ActivationLibraryItem => ({
  id: "content:hero",
  entityType: "content",
  key: "hero",
  name: "Hero",
  description: null,
  version: 1,
  status: "ACTIVE",
  category: "channel",
  assetType: "website_banner",
  assetTypeLabel: "Website Banner",
  compatibility: {
    channels: ["website_personalization"],
    templateKeys: ["banner_v1"],
    placementKeys: ["home_top"],
    locales: ["en"],
    journeyNodeContexts: []
  },
  primitiveReferences: [],
  brokenPrimitiveReferences: [],
  usedInCount: 0,
  updatedAt: "2026-04-16T00:00:00.000Z",
  preview: {
    title: "Hero",
    subtitle: null,
    thumbnailUrl: null,
    snippet: null
  },
  runtimeRef: {
    contentKey: "hero"
  },
  ...patch
});

describe("activation asset UI config", () => {
  it("routes governed asset editors through the shared target route base", () => {
    expect(assetEditorHref(libraryItem({ entityType: "content", key: "hero banner" }))).toBe("/catalog/content?key=hero%20banner");
    expect(assetEditorHref(libraryItem({ entityType: "offer", key: "offer10" }))).toBe("/catalog/offers?key=offer10");
    expect(assetEditorHref(libraryItem({ entityType: "bundle", key: "spring_bundle" }))).toBe("/catalog/bundles?key=spring_bundle");
  });

  it("keeps tab-aware creation defaults predictable", () => {
    expect(createTypeForBrowseTab({ id: "copy", label: "Copy", assetType: "copy_snippet", description: "" })).toBe("copy_snippet");
    expect(createTypeForBrowseTab({ id: "channel", label: "Channel Assets", category: "channel", description: "" })).toBe("website_banner");
    expect(channelFilterLabel("mobile_push")).toBe("Mobile push");
  });

  it("builds campaign planning links from runtime references", () => {
    expect(assetCampaignPlanHref(libraryItem({ runtimeRef: { contentKey: "hero" } }))).toBe(
      "/engage/campaigns/new/edit?assetType=website_banner&name=Campaign+for+Hero&contentKey=hero"
    );
    expect(assetCalendarUsageHref({ key: "hero", assetType: "website_banner" })).toBe(
      "/engage/calendar?assetKey=hero&assetType=website_banner"
    );
    expect(campaignCreationHref({ assetKey: "offer10", assetType: "offer" })).toBe(
      "/engage/campaigns/new/edit?assetType=offer&offerKey=offer10"
    );
  });
});

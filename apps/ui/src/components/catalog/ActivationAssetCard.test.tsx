import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ActivationAssetCard, ActivationAssetPreview, ChannelBadges } from "./ActivationAssetCard";
import type { ActivationLibraryItem } from "../../lib/api";

const makeItem = (patch: Partial<ActivationLibraryItem>): ActivationLibraryItem => ({
  id: "content:welcome_banner:1",
  entityType: "content",
  key: "welcome_banner",
  name: "Welcome banner",
  description: "A reusable welcome banner",
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
  readiness: { status: "ready", riskLevel: "low", summary: "Ready" },
  health: "healthy",
  usedInCount: 3,
  updatedAt: "2026-04-15T10:00:00.000Z",
  preview: {
    title: "Welcome back",
    subtitle: "A useful banner",
    thumbnailUrl: null,
    snippet: "A useful banner"
  },
  runtimeRef: { contentKey: "welcome_banner" },
  ...patch
});
describe("Activation asset presentation", () => {
  it("renders type, channel, compatibility, reuse and safety cues on cards", () => {
    const html = renderToStaticMarkup(<ActivationAssetCard item={makeItem({})} />);

    expect(html).toContain("Website Banner");
    expect(html).toContain("Welcome banner");
    expect(html).toContain("Website");
    expect(html).toContain("banner_v1");
    expect(html).toContain("home_top");
    expect(html).toContain("Ready to use");
    expect(html).toContain("Used in 3");
  });

  it("uses channel-specific preview language for push and WhatsApp assets", () => {
    const pushHtml = renderToStaticMarkup(
      <ActivationAssetPreview
        item={makeItem({
          assetType: "push_message",
          assetTypeLabel: "Push Message",
          compatibility: { channels: ["mobile_push"], templateKeys: ["push_basic_v1"], placementKeys: [], locales: [], journeyNodeContexts: [] }
        })}
      />
    );
    const whatsappHtml = renderToStaticMarkup(
      <ActivationAssetPreview
        item={makeItem({
          assetType: "whatsapp_message",
          assetTypeLabel: "WhatsApp Message",
          compatibility: { channels: ["whatsapp"], templateKeys: ["whatsapp_template_v1"], placementKeys: [], locales: [], journeyNodeContexts: [] }
        })}
      />
    );

    expect(pushHtml).toContain("Meiro");
    expect(pushHtml).toContain("Welcome back");
    expect(whatsappHtml).toContain("Welcome back");
  });

  it("renders readable channel badges", () => {
    const html = renderToStaticMarkup(<ChannelBadges channels={["website_personalization", "mobile_push", "whatsapp"]} />);

    expect(html).toContain("Website");
    expect(html).toContain("Push");
    expect(html).toContain("WhatsApp");
  });
});

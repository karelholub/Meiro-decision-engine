import { describe, expect, it } from "vitest";
import {
  activationAssetCreationOptions,
  activationAssetCreationTargetFor,
  activationAssetDefaultChannels,
  activationAssetIsSelectableInPicker,
  activationAssetPickerCategories,
  activationAssetRouteBaseForTarget,
  activationAssetTemplateDefaults,
  activationAssetTypeCategory,
  activationAssetTypeOptions,
  activationChannelLabel,
  inferActivationAssetTypeFromText,
  normalizeActivationAssetType,
  normalizeActivationChannel
} from "./activationAssets";

describe("activation asset registry", () => {
  it("keeps typed creation mappings centralized", () => {
    expect(activationAssetCreationTargetFor("offer")).toBe("offer");
    expect(activationAssetCreationTargetFor("bundle")).toBe("bundle");
    expect(activationAssetCreationTargetFor("push_message")).toBe("content");
    expect(activationAssetTypeCategory("image")).toBe("primitive");
    expect(activationAssetTypeCategory("website_banner")).toBe("channel");
    expect(activationAssetTypeCategory("bundle")).toBe("composite");
  });

  it("publishes defaults used by API creation and UI menus", () => {
    expect(activationAssetDefaultChannels("whatsapp_message")).toEqual(["whatsapp"]);
    expect(activationAssetTemplateDefaults("website_banner")).toEqual(["banner_v1"]);
    expect(activationAssetRouteBaseForTarget("content")).toBe("/catalog/content");
    expect(activationAssetTypeOptions.map((option) => option.value)).toContain("copy_snippet");
    expect(activationAssetCreationOptions.find((option) => option.assetType === "push_message")).toMatchObject({
      group: "Channel assets",
      channels: ["mobile_push"],
      templateHint: "push_message_v1"
    });
  });

  it("normalizes aliases consistently across API and UI", () => {
    expect(normalizeActivationChannel("website-perso")).toBe("website_personalization");
    expect(normalizeActivationAssetType("button")).toBe("cta");
    expect(normalizeActivationAssetType("mobile push")).toBe("push_message");
    expect(inferActivationAssetTypeFromText("hero banner v2")).toBe("website_banner");
    expect(activationChannelLabel("mobile_push", "short")).toBe("Push");
  });

  it("makes picker category eligibility explicit", () => {
    expect(activationAssetPickerCategories("runtime_asset")).toEqual(["channel", "composite"]);
    expect(activationAssetPickerCategories("primitive_parts")).toEqual(["primitive"]);
    expect(activationAssetIsSelectableInPicker({ category: "channel" })).toBe(true);
    expect(activationAssetIsSelectableInPicker({ category: "primitive" })).toBe(false);
    expect(activationAssetIsSelectableInPicker({ category: "primitive" }, "primitive_parts")).toBe(true);
  });
});

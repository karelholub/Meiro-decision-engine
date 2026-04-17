import {
  activationAssetBrowseTabs,
  activationAssetCreationGroups,
  activationAssetCreationOptions,
  activationAssetTypeFilterOptions,
  activationAssetTypeOptions,
  activationChannelFilterOptions,
  activationChannelLabel,
  activationAssetRouteBaseForTarget,
  type ActivationAssetBrowseTab,
  type ActivationAssetChannel,
  type ActivationAssetCreationGroup,
  type ActivationAssetCreationOption,
  type ActivationAssetType
} from "@decisioning/shared";
import type { ActivationLibraryItem } from "../../lib/api";

export type {
  ActivationAssetBrowseTab,
  ActivationAssetCreationGroup,
  ActivationAssetCreationOption
} from "@decisioning/shared";

export {
  activationAssetBrowseTabs,
  activationAssetCreationGroups,
  activationAssetCreationOptions,
  activationAssetTypeFilterOptions,
  activationAssetTypeOptions,
  activationChannelFilterOptions
};

export const channelFilterLabel = (value: ActivationAssetChannel) => activationChannelLabel(value);

export const createTypeForBrowseTab = (tab: ActivationAssetBrowseTab): ActivationAssetType => {
  if (tab.assetType) return tab.assetType;
  if (tab.category === "channel") return "website_banner";
  return "website_banner";
};

export const assetEditorHref = (item: Pick<ActivationLibraryItem, "entityType" | "key">) => {
  return `${activationAssetRouteBaseForTarget(item.entityType)}?key=${encodeURIComponent(item.key)}`;
};

export const campaignCreationHref = (input: {
  startAt?: string | null;
  endAt?: string | null;
  appKey?: string | null;
  placementKey?: string | null;
  assetKey?: string | null;
  assetType?: ActivationAssetType | string | null;
  assetKind?: "content" | "offer" | null;
  name?: string | null;
}) => {
  const params = new URLSearchParams();
  if (input.startAt) params.set("startAt", input.startAt);
  if (input.endAt) params.set("endAt", input.endAt);
  if (input.appKey?.trim()) params.set("appKey", input.appKey.trim());
  if (input.placementKey?.trim()) params.set("placementKey", input.placementKey.trim());
  if (input.assetType?.trim()) params.set("assetType", input.assetType.trim());
  if (input.name?.trim()) params.set("name", input.name.trim());

  const assetKey = input.assetKey?.trim();
  if (assetKey) {
    const kind = input.assetKind ?? (input.assetType === "offer" ? "offer" : input.assetType === "bundle" ? null : "content");
    if (kind === "offer") {
      params.set("offerKey", assetKey);
    } else if (kind === "content") {
      params.set("contentKey", assetKey);
    }
  }

  const query = params.toString();
  return `/engage/campaigns/new/edit${query ? `?${query}` : ""}`;
};

export const assetCampaignPlanHref = (item: ActivationLibraryItem) => {
  const assetKey = item.runtimeRef.offerKey ?? item.runtimeRef.contentKey;
  if (!assetKey) {
    return null;
  }
  return campaignCreationHref({
    assetKey,
    assetKind: item.runtimeRef.offerKey ? "offer" : "content",
    assetType: item.assetType,
    name: `Campaign for ${item.name}`
  });
};

export const assetCalendarUsageHref = (item: Pick<ActivationLibraryItem, "key" | "assetType">) => {
  const params = new URLSearchParams({
    assetKey: item.key,
    assetType: item.assetType
  });
  return `/engage/calendar?${params.toString()}`;
};

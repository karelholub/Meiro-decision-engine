import type { CatalogContentBlock, ExperimentDefinition, InAppCampaign } from "@decisioning/shared";
import { parseLegacyKey, type Ref } from "@decisioning/shared";
import type { Registry } from "./registry";

export type DependencyStatus = "resolved_active" | "resolved_inactive" | "missing";

export interface DependencyItem {
  label: string;
  ref: Ref;
  status: DependencyStatus;
  detail?: string;
}

const statusFromRef = (registry: Registry, ref: Ref, label: string, detail?: string): DependencyItem => {
  const resolved = registry.get(ref);
  if (!resolved) {
    return { label, ref, status: "missing", detail };
  }
  if (resolved.status !== "ACTIVE") {
    return { label, ref, status: "resolved_inactive", detail: detail ?? `Found ${resolved.status}` };
  }
  return { label, ref, status: "resolved_active", detail };
};

export const validateContentDependencies = (registry: Registry, content: Pick<CatalogContentBlock, "templateId">): DependencyItem[] => {
  const templateRef = parseLegacyKey("template", content.templateId ?? "");
  if (!templateRef.key) {
    return [{ label: "Template", ref: templateRef, status: "missing", detail: "templateId is required" }];
  }
  return [statusFromRef(registry, templateRef, "Template")];
};

export const validateExperimentDependencies = (registry: Registry, experiment: ExperimentDefinition): DependencyItem[] => {
  const items: DependencyItem[] = [];
  for (const placement of experiment.scope.placements ?? []) {
    items.push(statusFromRef(registry, parseLegacyKey("placement", placement), "Placement"));
  }

  const weights = experiment.variants.reduce((sum, variant) => sum + (Number.isFinite(variant.weight) ? variant.weight : 0), 0);
  if (weights !== 100) {
    items.push({
      label: "Weights",
      ref: { type: "experiment", key: experiment.key },
      status: "resolved_inactive",
      detail: `Variant weights sum to ${weights}`
    });
  }

  for (const variant of experiment.variants) {
    items.push(statusFromRef(registry, parseLegacyKey("content", variant.treatment.contentKey), `Variant ${variant.id} content`));
    if (variant.treatment.offerKey) {
      items.push(statusFromRef(registry, parseLegacyKey("offer", variant.treatment.offerKey), `Variant ${variant.id} offer`));
    }
  }

  return items;
};

export const validateCampaignDependencies = (registry: Registry, campaign: Pick<InAppCampaign, "placementKey" | "templateKey" | "contentKey" | "offerKey" | "experimentKey">): DependencyItem[] => {
  const items: DependencyItem[] = [
    statusFromRef(registry, parseLegacyKey("placement", campaign.placementKey), "Placement"),
    statusFromRef(registry, parseLegacyKey("template", campaign.templateKey), "Template")
  ];

  if (campaign.contentKey) {
    items.push(statusFromRef(registry, parseLegacyKey("content", campaign.contentKey), "Content"));
  }
  if (campaign.offerKey) {
    items.push(statusFromRef(registry, parseLegacyKey("offer", campaign.offerKey), "Offer"));
  }
  if (campaign.experimentKey) {
    items.push(statusFromRef(registry, parseLegacyKey("experiment", campaign.experimentKey), "Experiment"));
  }

  return items;
};

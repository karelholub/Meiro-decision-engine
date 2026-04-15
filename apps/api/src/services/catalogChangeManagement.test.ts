import { describe, expect, it } from "vitest";
import {
  analyzeCatalogImpact,
  buildCatalogProductDiff,
  classifyArchiveConsequences,
  classifyReleaseRisk,
  evaluateCatalogReadiness
} from "./catalogChangeManagement";

const now = new Date("2026-04-15T10:00:00.000Z");

describe("catalog change management", () => {
  it("classifies publish readiness with remediation hints", () => {
    const readiness = evaluateCatalogReadiness({
      now,
      asset: {
        type: "offer",
        key: "offer_a",
        status: "DRAFT",
        variants: [
          {
            id: "v1",
            locale: "en-US",
            channel: "inapp",
            placementKey: "home_top",
            isDefault: false,
            payloadJson: { title: "Hello", ctaLabel: "Open" },
            metadataJson: { authoringMode: "structured" }
          }
        ]
      }
    });

    expect(readiness.status).toBe("ready_with_warnings");
    expect(readiness.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "DEFAULT_VARIANT_MISSING", nextAction: "Add a global or channel default variant." }),
        expect.objectContaining({ code: "STRUCTURED_CTA_INCOMPLETE" })
      ])
    );
  });

  it("detects default and scope impact for runtime-eligible variants", () => {
    const impact = analyzeCatalogImpact({
      now,
      activeReferences: { decisions: 1, campaigns: 2, experiments: 0, bundles: 1 },
      before: {
        type: "content",
        key: "content_a",
        variants: [
          { id: "default", isDefault: true, payloadJson: { title: "Old" } },
          { id: "exact", locale: "en-AU", channel: "inapp", placementKey: "home_top", payloadJson: { title: "Old AU" } }
        ]
      },
      after: {
        type: "content",
        key: "content_a",
        variants: [
          { id: "default", isDefault: false, payloadJson: { title: "Old" } },
          { id: "exact", locale: "en-AU", channel: "inapp", placementKey: "home_top", payloadJson: { title: "New AU" } }
        ]
      }
    });

    expect(impact.fallbackBehaviorChanged).toBe(true);
    expect(impact.criticalScopesAffected).toContain("en-AU / inapp / home_top");
    expect(impact.activeReferences).toEqual({ decisions: 1, campaigns: 2, experiments: 0, bundles: 1 });
    expect(impact.releaseRiskLevel).toBe("high");
  });

  it("labels product-level diffs for structured payload and bundle composition", () => {
    const diff = buildCatalogProductDiff(
      {
        type: "bundle",
        key: "bundle_a",
        offerKey: "offer_old",
        contentKey: "content_a",
        variants: [
          {
            id: "v1",
            locale: "en",
            channel: "inapp",
            isDefault: true,
            payloadJson: { ctaLabel: "Old CTA" }
          }
        ]
      },
      {
        type: "bundle",
        key: "bundle_a",
        offerKey: "offer_new",
        contentKey: "content_a",
        variants: [
          {
            id: "v1",
            locale: "en",
            channel: "inapp",
            isDefault: true,
            payloadJson: { ctaLabel: "New CTA" }
          }
        ]
      }
    );

    expect(diff.labels).toContain("Bundle now references different offer");
    expect(diff.labels).toContain("CTA label changed for en / inapp / any placement");
  });

  it("classifies archive consequences for active references and default loss", () => {
    const readiness = evaluateCatalogReadiness({
      now,
      asset: {
        type: "offer",
        key: "offer_a",
        status: "ACTIVE",
        variants: [{ id: "default", isDefault: true, payloadJson: { title: "Default" } }]
      }
    });
    const archive = classifyArchiveConsequences({
      asset: {
        type: "offer",
        key: "offer_a",
        status: "ACTIVE",
        variants: [{ id: "default", isDefault: true, payloadJson: { title: "Default" } }]
      },
      readiness,
      activeReferences: { decisions: 1, campaigns: 0, experiments: 0, bundles: 0 }
    });

    expect(archive.riskLevel).toBe("high");
    expect(archive.consequences.map((item) => item.code)).toEqual(
      expect.arrayContaining(["ARCHIVE_ACTIVE_REFERENCES", "ARCHIVE_DEFAULT_FALLBACK_LOSS"])
    );
  });

  it("classifies release risks with remediation hints", () => {
    const risk = classifyReleaseRisk({
      riskFlags: ["BUNDLE_TEMPLATE_MISSING_IN_TARGET", "EXPERIMENT_METADATA_TARGET_MISSING"]
    });

    expect(risk.riskLevel).toBe("high");
    expect(risk.remediationHints).toEqual(
      expect.arrayContaining([
        "Create or map the missing template in the target environment.",
        "Remove stale experiment metadata or promote the experiment dependency first."
      ])
    );
  });
});

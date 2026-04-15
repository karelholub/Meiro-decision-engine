import { describe, expect, it } from "vitest";
import { renderTemplateWithCatalogTokens, selectAssetVariant } from "./catalogResolver";

describe("catalog asset variant resolution", () => {
  const now = new Date("2026-04-15T10:00:00.000Z");

  it("prefers exact locale, channel, and placement match", () => {
    const selected = selectAssetVariant({
      now,
      locale: "en-US",
      channel: "inapp",
      placementKey: "home_top",
      variants: [
        { id: "global", isDefault: true, payloadJson: {} },
        { id: "channel", channel: "inapp", isDefault: true, payloadJson: {} },
        { id: "exact", locale: "en-US", channel: "inapp", placementKey: "home_top", isDefault: false, payloadJson: {} }
      ]
    });

    expect(selected.variant?.id).toBe("exact");
    expect(selected.reasonCode).toBe("VARIANT_EXACT_LOCALE_CHANNEL_PLACEMENT");
    expect(selected.selectionRule).toBe("VARIANT_EXACT_LOCALE_CHANNEL_PLACEMENT");
    expect(selected.fallbackUsed).toBe(false);
    expect(selected.candidateSummary.total).toBe(3);
    expect(selected.rejectionReasons.map((reason) => reason.variantId).sort()).toEqual(["channel", "global"]);
  });

  it("falls back through channel default to global default", () => {
    const channel = selectAssetVariant({
      now,
      locale: "cs-CZ",
      channel: "email",
      placementKey: "hero",
      variants: [
        { id: "global", isDefault: true, payloadJson: {} },
        { id: "email", channel: "email", isDefault: true, payloadJson: {} }
      ]
    });

    const global = selectAssetVariant({
      now,
      locale: "cs-CZ",
      channel: "push",
      placementKey: "hero",
      variants: [
        { id: "global", isDefault: true, payloadJson: {} },
        { id: "email", channel: "email", isDefault: true, payloadJson: {} }
      ]
    });

    expect(channel.variant?.id).toBe("email");
    expect(channel.reasonCode).toBe("VARIANT_CHANNEL_DEFAULT");
    expect(channel.fallbackUsed).toBe(true);
    expect(channel.warnings).toContain("FALLBACK_USED:VARIANT_CHANNEL_DEFAULT");
    expect(channel.warnings).toContain("PLACEMENT_FALLBACK_USED");
    expect(global.variant?.id).toBe("global");
    expect(global.reasonCode).toBe("VARIANT_GLOBAL_DEFAULT");
    expect(global.warnings).toContain("CHANNEL_FALLBACK_USED");
    expect(global.localeFallbackChain).toEqual(["cs-CZ", "cs", "default"]);
  });

  it("normalizes locale case and underscores before matching", () => {
    const selected = selectAssetVariant({
      now,
      locale: "EN_us",
      channel: "inapp",
      placementKey: "home_top",
      variants: [
        { id: "language", locale: "en", channel: "inapp", placementKey: "home_top", isDefault: false, payloadJson: {} },
        { id: "exact", locale: "en-US", channel: "inapp", placementKey: "home_top", isDefault: false, payloadJson: {} }
      ]
    });

    expect(selected.variant?.id).toBe("exact");
    expect(selected.requestedLocale).toBe("EN_us");
    expect(selected.normalizedLocale).toBe("en-US");
    expect(selected.localeFallbackChain).toEqual(["en-US", "en", "default"]);
  });

  it("reports malformed locale input without matching another region", () => {
    const selected = selectAssetVariant({
      now,
      locale: "en-US-extra",
      channel: "inapp",
      placementKey: "home_top",
      variants: [
        { id: "other-region", locale: "en-AU", channel: "inapp", placementKey: "home_top", isDefault: false, payloadJson: {} },
        { id: "language", locale: "en", channel: "inapp", placementKey: "home_top", isDefault: false, payloadJson: {} },
        { id: "default", isDefault: true, payloadJson: {} }
      ]
    });

    expect(selected.variant?.id).toBe("default");
    expect(selected.warnings).toContain("MALFORMED_LOCALE_INPUT");
    expect(selected.warnings).toContain("LOCALE_FALLBACK_USED");
    expect(selected.rejectionReasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          variantId: "other-region",
          reasonCode: "SCOPE_MISMATCH"
        }),
        expect.objectContaining({
          variantId: "language",
          reasonCode: "SCOPE_MISMATCH"
        })
      ])
    );
  });

  it("excludes variants outside validity windows", () => {
    const selected = selectAssetVariant({
      now,
      locale: "en",
      channel: "inapp",
      placementKey: "home_top",
      variants: [
        {
          id: "expired",
          locale: "en",
          channel: "inapp",
          placementKey: "home_top",
          isDefault: false,
          payloadJson: {},
          endAt: "2026-04-01T00:00:00.000Z"
        },
        { id: "fallback", isDefault: true, payloadJson: {} }
      ]
    });

    expect(selected.variant?.id).toBe("fallback");
    expect(selected.warnings).toContain("VARIANT_WINDOW_EXCLUDED:expired");
    expect(selected.rejectionReasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          variantId: "expired",
          reasonCode: "VARIANT_EXPIRED"
        })
      ])
    );
    expect(selected.candidateSummary.expired).toBe(1);
  });

  it("returns clear reason codes when no variant can be served", () => {
    const selected = selectAssetVariant({
      now,
      locale: "en",
      channel: "inapp",
      placementKey: "home_top",
      variants: [
        {
          id: "expired",
          locale: "en",
          channel: "inapp",
          placementKey: "home_top",
          isDefault: false,
          payloadJson: {},
          endAt: "2026-04-01T00:00:00.000Z"
        },
        {
          id: "future-default",
          isDefault: true,
          payloadJson: {},
          startAt: "2026-05-01T00:00:00.000Z"
        }
      ]
    });

    expect(selected.variant).toBeNull();
    expect(selected.reasonCode).toBe("NO_VALID_VARIANT");
    expect(selected.candidateSummary.eligible).toBe(0);
    expect(selected.candidateSummary.expired).toBe(1);
    expect(selected.candidateSummary.notStarted).toBe(1);
    expect(selected.warnings).toContain("NO_RUNTIME_ELIGIBLE_VARIANT");
  });

  it("reports scope mismatch and missing default separately", () => {
    const selected = selectAssetVariant({
      now,
      locale: "de-DE",
      channel: "email",
      placementKey: "hero",
      variants: [
        { id: "app-only", locale: "cs-CZ", channel: "inapp", placementKey: "modal", isDefault: false, payloadJson: {} }
      ]
    });

    expect(selected.variant).toBeNull();
    expect(selected.reasonCode).toBe("NO_MATCHING_VARIANT");
    expect(selected.warnings).toContain("NO_DEFAULT_VARIANT");
    expect(selected.rejectionReasons).toEqual([
      expect.objectContaining({
        variantId: "app-only",
        reasonCode: "SCOPE_MISMATCH"
      })
    ]);
  });
});

describe("catalog token rendering", () => {
  it("keeps structured values and records missing tokens", () => {
    const missingTokens = new Set<string>();
    const rendered = renderTemplateWithCatalogTokens({
      value: {
        title: "Hi {{firstName}}",
        score: "{{profile.score}}",
        missing: "{{unknown}}"
      },
      profile: { score: 42 },
      context: {},
      derived: {},
      tokenBindings: { firstName: "profile.name" },
      missingTokenValue: "{{missing}}",
      missingTokens
    });

    expect(rendered).toEqual({
      title: "Hi {{missing}}",
      score: 42,
      missing: "{{missing}}"
    });
    expect([...missingTokens].sort()).toEqual(["firstName", "unknown"]);
  });

  it("treats null as unresolved but preserves empty strings and non-string full-token values", () => {
    const missingTokens = new Set<string>();
    const rendered = renderTemplateWithCatalogTokens({
      value: {
        nullValue: "{{profile.nullValue}}",
        emptyValue: "{{profile.emptyValue}}",
        boolValue: "{{profile.flag}}",
        numberInText: "Score {{profile.score}}"
      },
      profile: {
        nullValue: null,
        emptyValue: "",
        flag: false,
        score: 42
      },
      context: {},
      derived: {},
      tokenBindings: {},
      missingTokenValue: "__missing__",
      missingTokens
    });

    expect(rendered).toEqual({
      nullValue: "__missing__",
      emptyValue: "",
      boolValue: false,
      numberInText: "Score 42"
    });
    expect([...missingTokens]).toEqual(["profile.nullValue"]);
  });
});

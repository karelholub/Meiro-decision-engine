import { describe, expect, it } from "vitest";
import { makeVariantEditorRows, serializeVariantRows } from "./AssetVariantsEditor";

describe("AssetVariantsEditor serialization", () => {
  it("preserves unsupported JSON fields when structured mode is saved", () => {
    const rows = makeVariantEditorRows(
      [
        {
          id: "variant-1",
          locale: "en-US",
          channel: "inapp",
          placementKey: "home_top",
          isDefault: false,
          payloadJson: {
            title: "Current title",
            body: "Current body",
            customCard: {
              density: "compact"
            }
          },
          tokenBindings: {},
          clonedFromVariantId: null,
          experimentKey: "exp_winback",
          experimentVariantId: "candidate_1",
          experimentRole: "candidate",
          metadataJson: { authoringMode: "json" },
          startAt: null,
          endAt: null,
          createdAt: "2026-04-15T10:00:00.000Z",
          updatedAt: "2026-04-15T10:00:00.000Z"
        }
      ],
      {}
    );

    const [row] = rows;
    const serialized = serializeVariantRows([
      {
        ...row,
        authoringMode: "structured",
        structuredFields: {
          ...row.structuredFields,
          title: "Edited title"
        }
      }
    ]);

    expect(serialized[0]?.payloadJson).toEqual({
      customCard: {
        density: "compact"
      },
      title: "Edited title",
      body: "Current body"
    });
    expect(serialized[0]?.experimentKey).toBe("exp_winback");
    expect(serialized[0]?.metadataJson).toEqual({
      authoringMode: "structured",
      preservedJsonFields: ["customCard"]
    });
  });

  it("fails structured save when preserved raw JSON is invalid", () => {
    const rows = makeVariantEditorRows([], { title: "Fallback" });

    expect(() =>
      serializeVariantRows([
        {
          ...rows[0]!,
          authoringMode: "structured",
          payloadJsonText: "{broken"
        }
      ])
    ).toThrow("payload JSON is invalid");
  });
});

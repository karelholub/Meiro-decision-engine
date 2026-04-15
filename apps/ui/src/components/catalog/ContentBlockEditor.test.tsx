import React from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ContentBlockEditor } from "./ContentBlockEditor";
import type { SchemaField } from "./utils";

vi.mock("../registry/RefSelect", () => ({
  RefSelect: () => "Template selector"
}));
vi.mock("./LocaleTabsEditor", () => ({
  LocaleTabsEditor: () => "Locale editor"
}));
vi.mock("./TokenBindingsTable", () => ({
  TokenBindingsTable: () => "Token bindings"
}));

const noop = () => {};

const renderEditor = (patch?: Partial<React.ComponentProps<typeof ContentBlockEditor>>) => {
  const schemaFields: SchemaField[] = [
    { key: "title", type: "string", required: true, label: "Title", description: null },
    { key: "body", type: "string", required: true, label: "Body", description: null },
    { key: "deeplink", type: "string", required: false, label: "Deeplink", description: null },
    { key: "action", type: "string", required: false, label: "Action", description: null }
  ];

  return renderToStaticMarkup(
    <ContentBlockEditor
      value={{
        key: "PUSH_CART_REMINDER",
        name: "Cart reminder push",
        description: "Typed push message",
        status: "DRAFT",
        templateId: "push_message_v1",
        tags: ["asset:push_message", "channel:mobile_push", "template:push_message_v1"],
        startAt: "",
        endAt: "",
        schemaJsonText: JSON.stringify({
          activationAsset: { assetType: "push_message" },
          properties: {
            title: { type: "string" },
            body: { type: "string" },
            deeplink: { type: "string" },
            action: { type: "string" }
          }
        }),
        localesJsonText: "{}",
        tokenBindingsText: "{}"
      }}
      onChange={noop}
      readOnlyKey
      readOnly={false}
      availableTags={[]}
      schemaFields={schemaFields}
      schemaRequired={["title", "body"]}
      schemaOptional={["deeplink", "action"]}
      schemaFallbackInUse={false}
      localeData={{
        en: {
          title: "Cart reminder push",
          body: "Short push message.",
          deeplink: "app://home",
          action: "open_app"
        }
      }}
      activeLocale="en"
      onActiveLocaleChange={noop}
      onLocaleDataChange={noop}
      tokenBindingsRows={[]}
      onTokenBindingsRowsChange={noop}
      bindingWarnings={{ missing: [], unused: [] }}
      previewContext={{}}
      advancedOnly={false}
      advancedReasons={[]}
      showAdvanced={false}
      onToggleAdvanced={noop}
      localeOptions={["en"]}
      {...patch}
    />
  );
};

describe("ContentBlockEditor typed authoring", () => {
  it("renders guided fields and primitive selectors for typed channel assets", () => {
    const html = renderEditor();

    expect(html).toContain("Typed authoring");
    expect(html).toContain("Push Message");
    expect(html).toContain("Push title");
    expect(html).toContain("Push body");
    expect(html).toContain("Reusable parts");
    expect(html).toContain("Reusable image");
    expect(html).toContain("Reusable copy");
    expect(html).toContain("Reusable CTA");
  });

  it("renders primitive image authoring without channel reusable-part selectors", () => {
    const html = renderEditor({
      value: {
        key: "HERO_IMAGE",
        name: "Hero image",
        description: "Reusable image",
        status: "DRAFT",
        templateId: "image_ref_v1",
        tags: ["asset:image", "primitive:image"],
        startAt: "",
        endAt: "",
        schemaJsonText: JSON.stringify({
          activationAsset: { assetType: "image" },
          properties: {
            imageUrl: { type: "string" },
            imageRef: { type: "string" },
            description: { type: "string" }
          }
        }),
        localesJsonText: "{}",
        tokenBindingsText: "{}"
      },
      schemaFields: [
        { key: "imageUrl", type: "string", required: true, label: "Image URL", description: null },
        { key: "imageRef", type: "string", required: false, label: "Image reference", description: null }
      ],
      schemaRequired: ["imageUrl"],
      schemaOptional: ["imageRef", "description"],
      localeData: {
        en: {
          imageUrl: "https://example.com/hero.jpg",
          imageRef: "https://example.com/hero.jpg",
          description: "Primary homepage hero"
        }
      }
    });

    expect(html).toContain("Image URL");
    expect(html).toContain("Image reference");
    expect(html).not.toContain("Reusable parts");
  });
});

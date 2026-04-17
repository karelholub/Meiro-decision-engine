# Activation Asset Library

## Alignment Note

The Activation Asset Library is an additive browsing and compatibility layer over the governed asset model already in the repo. It reuses:

- `Offer` as the governed primitive offer asset.
- `ContentBlock` and variants as primitive assets (`Image`, `Copy Snippet`, `CTA`) and channel-ready assets (`Website Banner`, `Popup Banner`, `Email Block`, `Push Message`, `WhatsApp Message`, `Journey Asset`).
- `AssetBundle` as the composite asset object.
- Existing variant scope fields for locale, channel, and placement compatibility.
- Existing `templateId`, `templateKey`, `placementKeys`, `channels`, `locales`, tags, and JSON metadata as the compatibility metadata carrier.
- Existing readiness, impact, archive preview, health, release risk, and runtime resolver paths.

No second runtime resolver is introduced. Library-selected assets resolve through existing `offerKey`, `contentKey`, and `bundleKey` references.

## Typed Creation Alignment

Before typed creation, the objects that are truly createable are `Offer`, `ContentBlock`, and `AssetBundle`.

- Offer creation uses `/v1/catalog/offers`, stores a governed offer version, and routes through `/catalog/offers`.
- Content Block creation uses `/v1/catalog/content`, stores a governed content version with `templateId`, schema, locales, token bindings, tags, and variants, and routes through `/catalog/content`.
- Bundle creation uses `/v1/catalog/bundles`, stores a composite `AssetBundle` with optional offer/content references plus compatibility metadata, and routes through `/catalog/bundles`.
- Asset categories and types are already derived by the library service from explicit metadata, tags, template naming, variant scopes, and default fallbacks.
- Existing library views include All Assets, Images, Copy, CTAs, Offers, Channel Assets, and Bundles, with profile panels embedded in the existing Offer, Content Block, and Bundle editors.
- Template and compatibility metadata are assigned through current fields: content `templateId`, bundle `templateKey`, bundle `channels`/`placementKeys`/`locales`, tags, schema metadata, locale payloads, and variant channel/placement/locale scopes.
- Existing editors are keyed by governed object type, so typed creation should create the right underlying object and route back to `/catalog/offers`, `/catalog/content`, or `/catalog/bundles` with the new key selected.

Minimum change for typed creation is a lightweight type-to-governed-object mapping layer that creates Offer, Content Block, or Bundle records with starter payloads, tags, compatibility metadata, and variants. Primitive assets remain pragmatic content-block flavors unless a future media service is introduced.

## Asset Categories

The library classifies assets into three categories:

- `primitive`: image, copy snippet, CTA, offer.
- `channel`: website banner, popup banner, email block, push message, WhatsApp message, journey asset.
- `composite`: bundle.

Classification is deterministic and derived in this order:

1. Explicit library metadata in `schemaJson`, `metadataJson`, or variant metadata.
2. Tags such as `asset:image`, `channel:email`, `template:banner_v1`, or `placement:home_top`.
3. Template key naming conventions.
4. Variant channel metadata.
5. Safe defaults for legacy content blocks.

## Compatibility Model

Assets expose compatibility metadata for:

- channels: website personalization, popup banner, email, mobile push, WhatsApp, journey canvas
- template keys
- placement keys
- locales
- journey node contexts

The library picker filters assets by the current authoring context. If an asset has no explicit template or placement constraint, it is treated as compatible for that dimension. Blocked readiness is hidden by default in pickers but can be included for diagnostics.

## Primitive References

Channel assets can reference primitive assets through structured payload fields:

- `imageAssetKey`
- `copySnippetKey`
- `ctaAssetKey`
- `offerKey`

`imageRef` is treated as a primitive image reference only when it is not a URL, relative path, data URL, or token. Broken primitive references are surfaced as readiness blockers with `LIBRARY_PRIMITIVE_REFERENCE_MISSING`.

This is intentionally not a DAM. Image assets are governed content records or external URLs/refs, not binary-managed media objects.

Primitive references are reported with their source payload path so operators can fix the correct locale or variant. For example, locale-scoped references appear as `$.localesJson.en.imageAssetKey` and variant-scoped references appear as `$.variants[0].payloadJson.copySnippetKey`.

## Authoring Integration

The Catalog now has an `Activation Asset Library` landing page for searching and filtering all asset types. Campaign and decision authoring use the channel-aware picker to select compatible channel assets. The picker writes back to existing content, offer, and bundle references, preserving runtime behavior.

For campaign forms that do not have a native `bundleKey` field, selecting a bundle applies its content and offer components when available.

## Typed Asset Creation

The library exposes a first-class `Create asset` flow backed by `/v1/catalog/library/create`. The flow is typed at the UI layer, but the created records stay inside the existing governed model.

The type registry now lives in `@decisioning/shared` so API creation, API classification, UI menus, browse tabs, picker labels, and channel labels all read from the same product contract. Route helpers and editor-specific actions remain in the UI layer; governed object creation remains in the API layer.

| User-facing type | Governed object created | Starter defaults |
| --- | --- | --- |
| Image | `ContentBlock` | `image_ref_v1`, image reference/source fields, description/tags, website/popup/email compatibility |
| Copy Snippet | `ContentBlock` | `copy_snippet_v1`, reusable text, token guidance, broad channel compatibility |
| CTA | `ContentBlock` | `cta_v1`, label, target URL/action, broad channel compatibility |
| Website Banner | `ContentBlock` | `banner_v1`, title/subtitle/CTA/image/deeplink, website personalization channel, `home_top` placement hint |
| Popup Banner | `ContentBlock` | `popup_banner_v1`, title/body/CTA/URL/image reference, popup channel, modal placement hint |
| Email Block | `ContentBlock` | `email_block_v1`, headline/body/CTA/image/footer, email channel |
| Push Message | `ContentBlock` | `push_message_v1`, title/body/deeplink/action, mobile push channel |
| WhatsApp Message | `ContentBlock` | `whatsapp_message_v1`, body/button/action/variable guidance, WhatsApp channel |
| Journey Asset | `ContentBlock` | `journey_asset_v1`, journey copy/action fields, journey canvas channel and node-context hints |
| Offer | `Offer` | governed offer draft with starter discount payload |
| Bundle | `AssetBundle` | governed bundle draft with locale/use-case metadata and empty offer/content slots |

Typed creation assigns `asset:<type>`, `category:<category>`, `channel:<channel>`, `template:<template>`, and `library:typed_create` tags where applicable. Content-block typed assets also store library metadata in `schemaJson` and create a default variant with locale/channel/placement scope so the Library Profile and picker immediately show the intended type and compatibility.

After creation, users are routed to the existing editor with `?key=<created key>`:

- `/catalog/content` for primitive and channel content-block flavors
- `/catalog/offers` for offers
- `/catalog/bundles` for bundles

Those pages select the newest version for the routed key and continue to use the existing edit, preview, validation, activation, archive, readiness, and impact flows.

## Typed Editor Maturity

Typed-created content blocks now open in the existing Content Block editor with a guided `Typed authoring` section above the raw schema/locale editors. The panel is selected from the typed creation metadata, `asset:<type>` tags, or template naming conventions.

Primitive assets get type-specific fields:

- Image: image URL/reference, description, and tags.
- Copy Snippet: title, reusable copy, and token guidance.
- CTA: label, target URL/deeplink, and action type.

Channel assets get type-specific fields plus `Reusable parts` selectors for Image, Copy Snippet, and CTA primitives. Selecting a reusable part writes `imageAssetKey`, `copySnippetKey`, or `ctaAssetKey` into the active locale payload, keeping the reference visible to readiness checks and the Library Profile without changing runtime resolution.

## Runtime Integration

Runtime remains unchanged:

- offers resolve through existing offer resolution
- content blocks resolve through existing content resolution
- bundles resolve through existing bundle composition
- primitive references are authoring/readiness concerns unless the payload/template already knows how to render them

This keeps preview/runtime parity tied to the current governed resolver.

## Release And Safety

Release plans now include activation asset notes such as asset type and compatibility metadata for governed offers, content blocks, and bundles. Missing compatibility metadata is treated as a review risk, not a hard block.

Readiness checks include broken primitive references, so invalid composed channel assets are visible before activation or release.

## Known Limitations

- No binary upload, transformation, or media lifecycle.
- No automatic multi-channel transformation.
- No generic visual page builder.
- No full journey canvas redesign.
- Primitive assets are represented as lightweight content-block flavors; runtime materialization depends on existing payload/template behavior.
- Primitive references are validated and displayed, but not every downstream renderer consumes primitive content blocks directly yet.
- Compatibility metadata remains convention-based unless explicitly provided in existing JSON metadata or tags.

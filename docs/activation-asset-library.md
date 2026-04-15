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

## Authoring Integration

The Catalog now has an `Activation Asset Library` landing page for searching and filtering all asset types. Campaign and decision authoring use the channel-aware picker to select compatible channel assets. The picker writes back to existing content, offer, and bundle references, preserving runtime behavior.

For campaign forms that do not have a native `bundleKey` field, selecting a bundle applies its content and offer components when available.

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
- Primitive references are validated and displayed, but runtime materialization depends on existing payload/template behavior.
- Compatibility metadata remains convention-based unless explicitly provided in existing JSON metadata or tags.

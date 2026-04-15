# Activation Asset Library UI Polish

## Alignment Note

The first library implementation exposed the right objects and filters, but the UI still read like a technical registry:

- asset cards used the same layout regardless of asset type
- previews were mostly plain text snippets
- primitive assets did not feel like reusable building blocks
- picker results did not clearly explain why an asset fit the current channel/template context
- detail pages remained form-first, with safety and dependency information separated from the asset profile

This polish pass keeps the existing Catalog navigation and runtime model. The highest-value surfaces to make more library-like first are:

1. Catalog → All Assets
2. ActivationAssetPicker in campaign and decision authoring
3. Offer, Content Block, and Bundle detail pages

The visual hierarchy changes are additive: shared cards, previews, badges, typed browsing tabs, stronger empty states, and a profile summary panel above existing forms. No runtime resolver, approval workflow, or DAM-style media workflow is introduced.

## UX Model

The library now presents assets as reusable activation objects first, with governance signals kept visible but compact.

Cards and picker rows emphasize:

- asset type
- channel-specific preview
- “Works in” channel badges
- compatible templates and placements
- readiness and health badges
- used-in count
- reusable parts and missing parts

## Typed Browsing

Catalog → All Assets includes quick browse tabs:

- All Assets
- Images
- Copy
- CTAs
- Offers
- Channel Assets
- Bundles

These are pre-filtered views over the same library endpoint, not separate persistence or runtime concepts.

## Preview Styles

Preview rendering is intentionally lightweight and deterministic:

- images are thumbnail-forward
- CTAs render as compact buttons
- copy snippets highlight token markers
- push messages render like compact notifications
- WhatsApp messages render as chat-style bubbles
- email blocks render with a compact email section
- bundles render grouped offer/content components
- channel banners render as small activation cards

If no preview image or snippet exists, the UI uses an explicit no-preview message instead of leaving the card visually empty.

## Picker Behavior

The picker shows assets that match the current channel, template, placement, and readiness context. Each result shows what will actually be referenced underneath, such as content, offer, or bundle keys.

Empty states explain likely causes:

- no assets for this template
- placement filter too strict
- blocked assets hidden
- missing compatibility metadata

## Detail Pages

Existing Offer, Content Block, and Bundle pages now include a library profile panel above the editing form. This panel keeps the current governance/editing workflow intact while making the asset easier to understand as a reusable activation object.

## Deferred

- no image upload/editing/transformation
- no visual page builder
- no full journey canvas redesign
- no new runtime resolver
- no warehouse-grade asset analytics
- no automatic generation of channel-specific versions

## Final Polish Note

The final demo-readiness pass focused on the places that still felt placeholder-heavy after the first UI polish sprint.

Polish targets identified:

- Bundle authoring still looked like a raw form because offer/content membership was only visible as select fields.
- Bundle preview exposed resolver output as raw JSON, including null/empty states that felt debug-oriented.
- Previews were channel-aware, but several fallback states still looked like blank cards instead of intentional unavailable states.
- “Used in” and reusable-part counts were visible but not actionable enough to explain reuse value.
- Detail pages had a profile panel, but reusable parts and compatibility needed clearer grouping.
- Dense library rows needed better preview and usage hierarchy for scanning during demos.

Implemented presentation adjustments:

- shared previews now render richer, asset-type-specific frames for offer, channel, primitive, and bundle assets
- preview fallbacks explain what is incomplete instead of showing blank placeholders
- bundle pages now show component cards for the selected offer and content block, including missing-component states
- bundle previews summarize composition, resolved payload fields, and resolver warnings without dumping raw JSON
- reusable parts render as small resolved/missing tiles in the profile panel
- usage copy now distinguishes “no active usage recorded” from assets used in one or more places
- All Assets dense list now includes compact previews and clearer usage summaries

These are UI-only refinements over the existing library endpoint, resolver, readiness, impact, and release safety model.

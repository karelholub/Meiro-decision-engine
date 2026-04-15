# Campaign Calendar

The Campaign Calendar is an additive planning view over existing governed campaigns and activation assets. It does not introduce a new workflow engine or runtime resolver.

## Model

Calendar events are derived from `InAppCampaign` records:

- `startAt` and `endAt` define the visible campaign window.
- `status` defines lifecycle state: draft, pending approval, active, archived.
- `submittedAt`, `activatedAt`, and `lastReviewComment` provide approval context.
- `appKey`, `placementKey`, `templateKey`, and `priority` provide planning and conflict context.
- `contentKey` and `offerKey` link campaigns to governed activation assets.

The API endpoint is:

- `GET /v1/inapp/campaign-calendar`

Supported filters:

- `from` / `to`
- `status`
- `appKey`
- `placementKey`
- `assetKey`
- `assetType`
- `includeArchived`

## UI

The calendar is available at `/engage/calendar`.

It provides:

- Month, week, and list views.
- Campaign bars spanning scheduled windows.
- A planning bucket for campaigns missing `startAt` or `endAt`.
- Status, app, placement, asset key, and asset type filters.
- Linked asset chips that route to the existing catalog editors.
- A create-campaign action that carries the current calendar window and compatible filters into the existing campaign editor.
- Schedule editing for existing campaigns without replacing the full campaign authoring form.
- Summary cards for total, scheduled, unscheduled, and conflict counts.
- Planning warning summaries.

Asset profiles also expose planning links:

- `Plan campaign with this asset` opens the existing campaign editor with the selected content or offer reference prefilled.
- `View calendar usage` opens the calendar filtered to that asset type and key.

Schedule edits use `PATCH /v1/inapp/campaigns/:id/schedule`. The endpoint only updates `startAt` and `endAt`, records a campaign version snapshot, and writes an audit event. It does not bypass the governed campaign model.

## Warnings

The calendar computes advisory planning warnings:

- missing start or end dates
- drafts or pending approval campaigns starting soon
- active campaigns ending soon
- missing linked content or offer assets
- linked assets that are not active
- linked assets ending before the campaign
- overlapping campaigns on the same app and placement

These warnings are product planning signals. Runtime selection behavior remains governed by the existing in-app runtime.

## Intentional Limits

- No standalone calendar-event table.
- No new approval workflow.
- No external calendar sync.
- No resource/capacity planning.
- No runtime campaign resolver changes.
- Bundle planning remains indirect until campaigns have a native bundle reference. If a bundle resolves to content or offer, the campaign editor can plan that underlying governed object.

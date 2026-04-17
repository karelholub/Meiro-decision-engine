# Campaign Calendar

The Campaign Calendar is an additive planning view over existing governed campaigns and activation assets. It does not introduce a new workflow engine or runtime resolver.

## Repo Verification Note

This MVP was implemented after verifying the existing product model and reusing the current in-app, catalog, governance, and orchestration concepts.

### Existing Domain Objects

Already present and reused:

- `InAppCampaign`: campaign-like operational object with `status`, `appKey`, `placementKey`, `templateKey`, `contentKey`, `offerKey`, `experimentKey`, `priority`, `startAt`, `endAt`, `capsPerProfilePerDay`, `capsPerProfilePerWeek`, `eligibilityAudiencesAny`, `submittedAt`, `activatedAt`, and review comments.
- `InAppApplication`, `InAppPlacement`, and `InAppTemplate`: source context for app, placement, and template compatibility.
- `ContentBlock`, `Offer`, and `AssetBundle`: Activation Asset Library objects. Calendar events directly link content and offer assets from campaign references. Bundle usage remains indirect unless a bundle resolves to a campaign content or offer reference.
- `ExperimentVersion`: experiments have status and schedule fields, and campaigns can reference `experimentKey`. There is no standalone experiment calendar event in this MVP because experiment scheduling is not yet a campaign-like activation surface in the calendar route.
- `Release`: release plans and risk semantics exist separately in release routes. Release events are not included in the calendar MVP because the existing calendar source is campaign activation planning.
- `OrchestrationPolicy` and `OrchestrationEvent`: existing policy documents support frequency caps, mutex groups, and cooldowns. The MVP surfaces campaign priority and campaign-level caps; it does not evaluate per-profile orchestration policies in the calendar.
- `Decision`, `DecisionStack`, and decision logs/results: decisioned placements exist, but they are not currently schedulable campaign objects, so they are documented as future calendar sources rather than duplicated.
- Readiness, risk, and health concepts exist in catalog change management and activation asset library readiness/health, plus in-app governance status. The calendar maps these into planning readiness without replacing source semantics.

Not found as directly schedulable calendar sources:

- Native email campaign, mobile push campaign, WhatsApp campaign, or journey-send tables.
- Native owner fields on campaigns.
- Native campaign bundle reference.
- Warehouse-grade audience overlap or pressure scoring.

### Existing Endpoints And Services

Already present and reused:

- `GET /v1/inapp/campaign-calendar`: lists calendar events built from in-app campaigns.
- `GET /v1/inapp/campaign-calendar/export.ics`: exports scheduled calendar events.
- `GET|POST|PUT|DELETE /v1/inapp/campaign-calendar/views`: persisted calendar views.
- `GET|POST /v1/inapp/campaign-calendar/review-packs`: immutable review snapshots.
- `GET|POST /v1/inapp/campaign-calendar/export-audit`: export audit trail.
- `POST /v1/inapp/campaigns/:id/schedule-preview`: deterministic schedule preview.
- `PATCH /v1/inapp/campaigns/:id/schedule`: audited schedule updates.
- Existing campaign detail/edit, catalog content, catalog offer, activation preview, approval, reject, archive, placement, template, experiment, release, catalog readiness, impact, health, and audit routes.
- `buildCampaignCalendar`, `buildCampaignCalendarContentAsset`, `buildCampaignCalendarOfferAsset`, `buildCampaignSchedulePreview`, `buildCampaignCalendarIcs`, and `buildCampaignCalendarReviewPackSnapshot`.
- Activation asset library helpers for asset type, channel compatibility, route targets, and labels.

### Existing Principles Encoded

Already present and surfaced:

- Governed lifecycle: draft, pending approval, active, archived.
- Approval handoff: submit, approve/activate, reject, archive, audit comments.
- Priority: `InAppCampaign.priority`, used by runtime ordering and surfaced in calendar.
- Campaign-level pressure caps: per-profile daily and weekly caps surfaced as orchestration markers.
- Placement compatibility and conflict context: app, placement, and template keys.
- Asset governance: linked content/offer status and validity windows.
- Readiness/risk: deterministic calendar checks for schedule, approval, asset linkage, active assets, asset validity, placement conflicts, and launch timing.
- Basic conflict warnings: placement overlap, channel overlap, audience reference overlap, shared content/offer reuse, and not-ready asset windows.
- Orchestration policy concepts: frequency caps, mutex groups, and cooldowns exist in `OrchestrationPolicy`, but the calendar does not run per-profile policy simulation.

### Reuse Strategy

The initial unified event model is `CampaignCalendarItem`, assembled by `buildCampaignCalendar` from existing `InAppCampaign` rows plus linked latest content and offer assets. This model now carries explicit source, channel, audience, asset, approval, priority/cap, warning, and drilldown fields so future sources can be added without changing the UI contract.

Reused surfaces:

- `/engage/calendar` for the operational calendar.
- Existing campaign inventory/detail/editor routes for campaign drilldown.
- Existing catalog content and offer pages for asset drilldown.
- Existing in-app governance actions for approval and activation.
- Existing asset library metadata for channel and asset typing.
- Existing orchestration concepts are surfaced as markers, not reimplemented.

Represented for future phases but intentionally not fully implemented:

- Native email, push, WhatsApp, and journey sends as first-class source objects.
- Direct bundle-to-campaign calendar events.
- Decision stack calendar events.
- Per-profile pressure scoring, audience overlap intelligence, mutex/cooldown simulation, arbitration, and what-if planning.

## Model

Calendar events are derived from `InAppCampaign` records and normalized into a unified `CampaignCalendarItem` shape:

- `startAt` and `endAt` define the visible campaign window.
- `status` defines lifecycle state: draft, pending approval, active, archived.
- `submittedAt`, `activatedAt`, and `lastReviewComment` provide approval context.
- `appKey`, `placementKey`, `templateKey`, and `priority` provide planning and conflict context.
- `contentKey` and `offerKey` link campaigns to governed activation assets.
- `sourceType`, `sourceId`, and `sourceKey` make the event source explicit.
- `channel` and `channels` are derived from linked asset compatibility and known app/placement aliases.
- `audienceKeys` and `audienceSummary` are derived from `eligibilityAudiencesAny` when present.
- `capsPerProfilePerDay`, `capsPerProfilePerWeek`, and `orchestrationMarkers` surface existing pressure-control hints.
- `linkedAssets`, `assetSummary`, and asset drilldown targets connect to the Activation Asset Library.
- `drilldownTargets` link back to existing campaign and asset pages.

The API endpoint is:

- `GET /v1/inapp/campaign-calendar`

Supported filters:

- `from` / `to`
- `status`
- `appKey`
- `placementKey`
- `assetKey`
- `assetType`
- `channel`
- `readiness`
- `sourceType`
- `audienceKey`
- `includeArchived`

## UI

The calendar is available at `/engage/calendar`.

It provides:

- Month, week, and list views.
- Campaign bars spanning scheduled windows.
- A planning bucket for campaigns missing `startAt` or `endAt`.
- Status, readiness, source type, channel, app, placement, audience, asset key, and asset type filters.
- Swimlanes by readiness, planning state, channel, placement, app, asset, audience, source type, and status.
- Linked asset chips that route to the existing catalog editors.
- A detail drawer with source, channel, schedule, audience, placement, template, readiness, warnings, conflicts, priority/cap markers, and quick links.
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
- overlapping scheduled campaigns on the same derived channel
- overlapping scheduled campaigns with the same explicit audience reference
- overlapping scheduled campaigns that reuse the same content or offer asset

These warnings are product planning signals. Runtime selection behavior remains governed by the existing in-app runtime.

## Intentional Limits

- No standalone calendar-event table.
- No new approval workflow.
- No external calendar sync.
- No resource/capacity planning.
- No runtime campaign resolver changes.
- Bundle planning remains indirect until campaigns have a native bundle reference. If a bundle resolves to content or offer, the campaign editor can plan that underlying governed object.
- No native email, push, WhatsApp, journey, release, experiment, or decision-stack event creation unless those objects are already represented by existing in-app campaign schedules.
- No audience overlap intelligence beyond exact shared audience keys already stored on campaigns.
- No mutex, cooldown, frequency-cap, or arbitration simulation in the calendar.

## Phase 2 Verification Note

Phase 2 was implemented after verifying the existing overlap, audience, cap, journey, orchestration, placement, and asset capabilities already present in the repo.

### Existing Audience And Segmentation References

Already present and reused:

- `InAppCampaign.eligibilityAudiencesAny` stores explicit audience keys as a JSON string array.
- Campaign create/update schemas validate `eligibilityAudiencesAny` as string arrays.
- The in-app runtime uses these exact audience keys when deciding profile eligibility.
- Decision-builder objects also support `audiencesAny`, `audiencesAll`, `audiencesNone`, and global suppress audience settings, but decision definitions are not currently schedulable calendar event sources.
- WBS settings include segment parameter configuration for profile lookup contexts.

Not present as calendar-grade data:

- Segment size or reachability totals.
- Warehouse-grade audience overlap calculations.
- Customer-level pressure history in the calendar aggregation path.
- Campaign-level suppression/exclusion references beyond the exact inclusion audience keys.

Therefore Phase 2 treats audience overlap as exact-reference overlap only. It does not infer overlap from free-text names and does not estimate suppressed profile counts.

### Existing Cap, Cooldown, And Pressure Concepts

Already present and reused:

- `InAppCampaign.capsPerProfilePerDay`.
- `InAppCampaign.capsPerProfilePerWeek`.
- `InAppCampaign.priority`.
- Runtime orchestration policy documents with `frequency_cap`, `mutex_group`, and `cooldown` rule types.
- Runtime orchestration service support for frequency, mutex, and cooldown markers.

Calendar Phase 2 surfaces campaign-level day/week caps directly. It does not run the runtime orchestration service or simulate profile-level mutex/cooldown outcomes, because the calendar event source does not currently carry enough profile-level state to do that honestly.

### Existing Journey And Always-On Source Availability

Already present:

- Activation Asset Library channel and asset types for `journey_canvas` and `journey_asset`.
- Experiments with schedules and campaign `experimentKey` references.
- Decision stacks and placement decisioning surfaces.

Not present as direct calendar sources:

- Native journey-send records.
- Native always-on journey campaign rows.
- Native email, push, or WhatsApp campaign tables outside the in-app campaign model.
- Decisioned placement schedules that can be safely normalized as calendar events.

Phase 2 therefore keeps the source model unchanged: pressure intelligence is computed over existing calendar events, currently in-app campaigns with linked governed assets.

### Existing Asset And Placement Reuse Visibility

Already present and reused:

- `appKey`, `placementKey`, and `templateKey` on in-app campaigns.
- Existing placement-overlap conflict logic.
- Linked governed content and offer references through `contentKey` and `offerKey`.
- Activation Asset Library metadata for asset type, channel compatibility, status, validity windows, and detail routes.
- Phase 1 asset and offer reuse warnings for overlapping campaigns.

Phase 2 extends this from pairwise warnings into concentration summaries: same placement density, same content/offer reuse density, channel density, and hotspot lists.

### Existing Principles Encoded

Already present and surfaced:

- Priority markers.
- Campaign-level day/week caps.
- Draft, pending approval, active, archived lifecycle.
- Ready, at-risk, and blocked planning readiness.
- Asset active/validity health.
- Placement collision warnings.
- Release and approval semantics outside the calendar aggregation path.
- Runtime orchestration concepts for frequency caps, mutex groups, and cooldowns.

Not directly available on calendar events:

- Protected campaign flags.
- Campaign-level mutex group fields.
- Campaign-level cooldown fields.
- Exact suppression groups or exclusion audiences.
- Customer-level fatigue or quiet-period state.

### Phase 2 Reuse Strategy

Extended existing surfaces:

- `buildCampaignCalendar` now enriches existing `CampaignCalendarItem` records with overlap and pressure intelligence.
- `GET /v1/inapp/campaign-calendar` and `GET /v1/inapp/campaign-calendar/export.ics` support overlap and pressure filters.
- Calendar saved views and review packs persist the new filters.
- `/engage/calendar` shows pressure summaries, hotspots, risk filters, card badges, and drawer explanations.

Computed truthfully now:

- Exact audience-reference overlap.
- Same-day and same-week schedule density.
- Same placement concentration.
- Same content/offer reuse concentration.
- Same derived channel density.
- Cap pressure cues when exact audience keys and campaign caps are both present.

Deferred:

- Audience size, exact reachability, suppression counts, and true overlap percentage.
- Runtime arbitration, winner/loser resolution, and what-if simulation.
- Profile-level mutex/cooldown/cap evaluation.
- Native journey, email, push, WhatsApp, release, experiment, and decision-stack calendar source expansion.

## Phase 2 Overlap And Pressure Intelligence

Phase 2 adds operational guidance fields to each calendar item:

- `overlapRiskLevel`: `none`, `low`, `medium`, `high`, or `critical`.
- `pressureRiskLevel`: `none`, `low`, `medium`, `high`, or `critical`.
- `overlapSummary`: overlap counts, same-day and same-week collision counts, shared audience, placement, and asset refs, plus nearby flagged campaigns.
- `pressureSummary`: pressure and cap signals, channel/audience/placement/asset density, reachability notes, and future extension slots for exclusions and always-on context.
- `pressureSignals`: deterministic non-cap pressure cues.
- `capSignals`: day/week cap cues where exact audience references exist.
- `sharedAudienceRefs`, `sharedPlacementRefs`, and `sharedAssetRefs`.
- `channelDensity`, `weeklyDensity`, `sameDayCollisionCount`, and `sameWeekCollisionCount`.
- `reachabilityNotes`: cautious operational notes that explain likely reduced reach or repeated exposure without claiming exact counts.

Calendar summaries now include:

- `overlapRisk` counts by risk level.
- `pressureRisk` counts by risk level.
- `needsAttention`: campaigns that are not ready or have medium-or-higher overlap or pressure risk.
- `hotspots`: highest-signal day, channel, audience, placement, asset, and cap pressure clusters.

## Phase 2 Risk Logic

The logic is deterministic and explainable:

- Exact audience overlap is only computed from shared `eligibilityAudiencesAny` keys.
- Same-day pressure means two or more campaign windows include at least one same UTC day.
- Same-week pressure means campaign windows share at least one UTC week starting Monday.
- Placement pressure uses exact `appKey` plus `placementKey`.
- Asset pressure uses exact linked `contentKey` or `offerKey`.
- Channel pressure uses derived calendar channels from linked asset compatibility and app/placement aliases.
- Cap pressure is emitted only when a campaign has exact audience keys plus `capsPerProfilePerDay` or `capsPerProfilePerWeek`.

Risk labels are guidance:

- `low`: minor shared channel, asset, or week context.
- `medium`: repeated exact references or moderate placement/asset/channel concentration.
- `high`: strong exact audience pressure, cap exceedance, or high concentration.
- `critical`: overlapping same-placement blockers or larger cap exceedance.

The calendar intentionally phrases reachability effects as likely or operational guidance. It does not claim exact unreachable users, exact suppression counts, or guaranteed runtime outcomes.

## Phase 2 UI And Filters

The calendar UI now includes:

- Summary cards for needs-attention counts.
- An overlap and pressure summary panel.
- A hotspot panel for high-pressure days, audiences, placements, channels, assets, and cap pressure.
- Event-card badges for overlap and pressure risk.
- Detail drawer sections explaining densities, shared references, pressure signals, cap signals, reachability notes, and nearby flagged campaigns.
- Saved view support for new filters.
- Review packs freeze overlap/pressure risk distributions, needs-attention counts, hotspots, and per-campaign pressure context for approval handoff.

New filters:

- `overlapRisk`
- `pressureRisk`
- `pressureSignal`
- `needsAttentionOnly`

New swimlanes:

- `overlap_risk`
- `pressure_risk`

## Phase 2 Intentional Limits

- No new orchestration engine.
- No runtime decisioning redesign.
- No profile-level reachability model.
- No synthetic journey or always-on campaign objects.
- No full arbitration or prioritization cockpit.
- No winner/loser recommendations.
- No ML scoring.
- No inferred audience overlap from free-text labels.
- No precise pressure, suppression, or reach loss claims without source data.

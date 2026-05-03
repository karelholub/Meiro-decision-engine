# Governed Activation System - Functional Product Description

## Purpose

This document describes the system from a functional and product-management point of view. It is intended for product gap analysis against an existing platform and for later product-scope definition.

The product is a governed activation and decisioning platform. It lets teams define customer decisions, reusable activation assets, in-app campaigns, experiments, orchestration rules, release packages, and operational controls around a Meiro CDP-centered activation workflow.

At a high level, the system answers four product questions:

1. What should this customer see or receive now?
2. Which governed asset, offer, content block, or campaign is allowed to be used?
3. How do product, marketing, and operations teams review, promote, monitor, and troubleshoot that activation?
4. How does the platform integrate with Meiro CDP, WBS lookup, Pipes callbacks, SDKs, and downstream clients?

## Product Positioning

The system is not just a rules engine. It combines these product areas:

- Decision authoring and runtime evaluation.
- Decision stacks for multi-step next-best-action flows.
- Governed activation asset management.
- In-app campaign lifecycle management.
- Experiment assignment and measurement support.
- Campaign planning calendar and pressure visibility.
- Release promotion across environments.
- Runtime reliability, cache, precompute, DLQ, and monitoring operations.
- Meiro CDP integration for metadata, customer profile lookup, native campaign visibility, and WBS-based runtime hydration.

The product is centered on governed activation: business users can author and operate activation logic, while product/ops teams retain lifecycle, audit, environment, reliability, and release controls.

## Primary User Groups

### Product Managers

Product managers use the platform to understand the activation portfolio, compare capabilities against current tools, define reusable product objects, review readiness, and plan scope across decisioning, campaign orchestration, assets, experimentation, and operations.

### Marketers And Campaign Managers

Campaign operators create and manage in-app campaigns, choose assets, review campaign schedules, inspect placement conflicts, and monitor campaign performance.

### Decision Builders

Decision builders author rules, eligibility, holdout, caps, payload references, and decision stacks. They validate definitions, simulate profiles, and prepare changes for activation or release.

### Content And Offer Managers

Asset owners manage reusable offers, content blocks, variants, localization, compatibility metadata, token bindings, bundles, readiness, and archive consequences.

### Approvers And Publishers

Approvers review pending activation requests, approve or reject campaigns and assets, activate versions, archive entities, and promote release packages across environments.

### Operators

Operators monitor runtime health, logs, cache behavior, precompute runs, DLQ messages, event ingestion, retention, fallback behavior, and dependency degradation.

### Administrators

Administrators manage users, roles, permissions, app settings, WBS settings, WBS mapping, Pipes integration, Meiro MCP settings, webhook rules, and runtime defaults.

## Core Product Concepts

### Environment Scope

Most governed objects are environment-scoped: `DEV`, `STAGE`, and `PROD`. Users can switch environment context in the UI. Release functionality promotes selected objects between environments.

### Versioned Governed Objects

Decisions, decision stacks, offers, content blocks, bundles, experiments, campaigns, policies, templates, placements, and apps follow versioned or lifecycle-controlled patterns. Common lifecycle states include draft, pending approval, active, paused, archived, and environment-specific promotion states.

### Decision Runtime

The runtime evaluates a profile and context against an active decision definition or decision stack. It returns an action, payload, reasons, debug trace, and optional resolved asset content. Runtime supports realtime decisions, precomputed decision results, and in-app delivery.

### Governed Assets

Activation assets are reusable product objects used by decisions and campaigns. The asset model covers offers, content blocks, typed primitive assets, channel-ready assets, and bundles.

### Campaigns

The current first-class campaign object is the in-app campaign. It connects app, placement, template, content, offer, eligibility, variants, holdout, caps, schedule, approval state, and reporting.

### Experiments

Experiments define deterministic assignments across A/B and weighted multivariate variants. Campaigns and assets can reference experiment keys and expose assignment and performance metadata.

### Orchestration

Global orchestration policies apply cross-channel governance such as frequency caps, mutex groups, cooldowns, and fail-safe fallback behavior across decision and in-app runtime surfaces.

### Release Packages

Releases are promotion plans across environments. A release contains selected governed entities, dependency expansion, diffs, risk flags, approval, and apply behavior.

## Application Navigation And Functional Areas

The UI is organized into five major product sections:

- Observe: operational heartbeat, logs, activation map, asset health, cache, orchestration, DLQ, precompute, decision results, and releases.
- Build: use cases, decisions, decision stacks, and simulator.
- Catalog: activation asset library, offers, reusable assets, and bundles.
- Engage: Meiro workbench, campaign calendar, campaign inventory, Meiro campaign control, experiments, apps, placements, templates, reports, events, and tools.
- Configure: webhook rules, Meiro MCP, Pipes integration, Pipes callback, WBS settings, WBS mapping, app settings, users, and help documentation.

## Build: Decision Authoring

### Decisions

The Decisions area supports search, filtering, creation, editing, validation, activation, archive, and version management for decision definitions.

Decision definitions can include:

- Eligibility based on audiences, attributes, and consent.
- Rule flow with first-match behavior and conditional branching.
- Output actions such as messages, no-op responses, or payload-bearing actions.
- Payload references to governed offers, content blocks, and bundles.
- Holdout logic.
- Daily and weekly profile caps.
- Required profile attributes for optimized lookup.
- Reliability defaults such as timeouts, cache policies, stale behavior, and fallback output.
- Optional writeback configuration for decision outcomes.

### Decision Builder Experience

The product includes guided decision authoring for non-JSON users while retaining advanced JSON editing for power users. Builder workflows include validation, formatting, test-and-activate support, authoring evidence, scenario tests, dependency visibility, and readiness checks.

### Decision Activation

Decisions move through draft and active versions. Activation promotes a validated draft version to active for the selected environment. Archive removes a decision from active use while preserving history and logs.

### Decision Reporting

Decision logs and reports show outcomes, action distribution, holdout versus treatment behavior, latency, payloads, traces, and replay inputs. Conversion ingestion supports proxy uplift and conversion reporting around decision outcomes.

## Build: Decision Stacks

Decision stacks chain multiple decisions into a deterministic next-best-action flow. A stack references decision keys, evaluates steps in order, records step-level behavior, and returns a final action.

Functional capabilities include:

- Stack list, creation, editing, activation, and archive.
- Multi-step deterministic evaluation.
- Runtime endpoint alias for next-best-action behavior.
- Stack simulation.
- Stack logs with step evidence and final output.
- Dependency analysis against referenced decisions and assets.
- Precompute support for bulk activations.

Decision stacks are useful when a product needs ordered prioritization or multiple decision layers rather than a single standalone rule set.

## Build: Simulator

The Simulator supports decision, stack, and in-app runtime preview in the selected environment.

Capabilities include:

- Simulate a decision with selected profile attributes, audiences, consents, and context.
- Simulate a decision stack and inspect each step.
- Preview in-app campaign decisions by app, placement, profile, and context.
- Import Meiro WBS profiles for realistic test data.
- Inspect dependencies and resolved payloads.
- View debug traces, reason codes, asset resolution metadata, fallback behavior, and runtime evidence.

The simulator is a product safety surface: it helps users understand what will happen before activation or release.

## Catalog: Activation Asset Library

The Activation Asset Library is a unified browse and picker layer over governed offers, content blocks, and bundles. It does not introduce a separate runtime. Selected assets resolve through the same runtime resolver used by decisions, simulations, and in-app decisions.

### Asset Categories

The library classifies assets into:

- Primitive assets: images, copy snippets, CTAs, and offers.
- Channel assets: website banners, popup banners, email blocks, push messages, WhatsApp messages, and journey assets.
- Composite assets: bundles.

### Asset Browsing

Users can browse and filter assets by:

- Category.
- User-facing asset type.
- Channel.
- Template key.
- Placement key.
- Locale.
- Status.
- Readiness and health state.
- Search query.

Library cards and profiles expose compatibility, readiness, status, linked variants, and routes back to governed editors.

### Typed Asset Creation

The system provides a typed `Create asset` flow. User-facing types map to governed objects:

- Image, copy snippet, CTA, website banner, popup banner, email block, push message, WhatsApp message, and journey asset create content blocks.
- Offer creates a governed offer.
- Bundle creates an asset bundle.

Typed creation adds starter payloads, tags, compatibility metadata, and default variants where appropriate.

## Catalog: Offers

Offers are governed, versioned assets that represent commercial or activation value.

Offer capabilities include:

- Create and edit offers with form-first fields and advanced JSON support.
- Configure offer type, value payload, constraints, tags, status, and validity windows.
- Manage variants scoped by locale, channel, and placement.
- Configure default variants and runtime fallbacks.
- Token bindings for dynamic value insertion.
- Preview, validate, activate, archive, and inspect readiness.
- View dependencies, impact, product diffs, archive consequences, and release risk.

Offer types currently include discount, free shipping, bonus, and content-only patterns.

## Catalog: Reusable Assets

Reusable assets are content blocks with template, schema, locale payloads, token bindings, and variants.

Functional capabilities include:

- Guided authoring for primitive and channel asset types.
- Locale editing.
- Template and schema association.
- Token diagnostics and safe token substitution.
- Variant cloning.
- Experiment metadata on variants.
- Channel, locale, and placement compatibility.
- Primitive references such as reusable image, copy, CTA, and offer references.
- Preview, readiness, impact, health, activate, archive, and release support.

Reusable assets can serve website, popup, email, push, WhatsApp, and journey use cases through convention-based compatibility metadata.

## Catalog: Bundles

Asset bundles package governed objects and compatibility metadata for reuse.

A bundle can include:

- Offer reference.
- Content block reference.
- Template key.
- Placement keys.
- Channels.
- Locales.
- Tags.
- Use-case metadata.

Runtime expands bundle references into their offer and content components and resolves those components through the existing resolver. Bundles are useful for reusable activation packages that should travel together through authoring, picking, and release planning.

## Catalog: Readiness, Impact, And Health

The catalog includes deterministic change-management support:

- Readiness checks classify assets as ready, ready with warnings, or blocked.
- Impact analysis compares current and previous versions and summarizes likely consequences.
- Product diffs label changes such as CTA changes, variant scope changes, fallback changes, validity changes, experiment metadata changes, and bundle dependency changes.
- Archive preview explains active references and runtime consequences.
- Asset health reports warnings and critical issues across offers, content, variants, and bundles.
- Operator task lists prioritize deterministic remediation work.

These checks are operational guidance, not business performance scoring.

## Engage: In-App Campaign Management

The in-app campaign module manages app-based placements, templates, campaigns, variants, events, reports, and runtime decisioning.

### Campaign Inventory

Campaign Inventory supports browsing and operating campaigns at scale. Campaign records include:

- Key, name, and description.
- App key.
- Placement key.
- Template key.
- Content key.
- Offer key.
- Experiment key.
- Priority.
- TTL.
- Schedule window.
- Holdout settings.
- Per-profile daily and weekly caps.
- Eligibility audiences.
- Token bindings.
- Approval state and review comments.
- Variants and weights.

### Campaign Lifecycle

Campaigns support governed lifecycle actions:

- Draft creation and editing.
- Submit for approval.
- Approve and activate.
- Reject to draft.
- Archive.
- Rollback to prior campaign version.
- Promote across environments.
- View versions and audit log.

### Campaign Runtime

The in-app runtime endpoint decides whether to show a campaign for a given app, placement, profile, and context. It evaluates eligibility, schedule, caps, priority, holdout, deterministic varianting, experiments, asset resolution, cache behavior, timeout fallback, and orchestration policy outcomes.

Runtime responses include show/no-show behavior, payload, tracking metadata, TTL, reason codes, and optional debug information.

### Campaign Events

The platform ingests in-app lifecycle events:

- Impression.
- Click.
- Dismiss.

Events carry app, placement, campaign, variant, experiment, message, identity, context, and idempotency information. Event ingestion supports async processing through stream and worker behavior.

### Campaign Reports

Engage reporting provides overview metrics, campaign-level reports, variant performance, daily series, and export support. Metrics are based on in-app decision logs and events.

## Engage: Campaign Calendar

The Campaign Calendar is a planning and review surface over existing governed campaigns and activation assets. It does not create a separate calendar-event model or runtime resolver.

Calendar capabilities include:

- Month, week, and list views.
- Scheduled campaign bars.
- Unscheduled planning bucket.
- Filters by status, app, placement, asset, asset type, channel, readiness, source type, audience, and archived state.
- Swimlanes by readiness, planning state, channel, placement, app, asset, audience, source type, and status.
- Detail drawer with source, schedule, audience, placement, template, assets, readiness, warnings, conflicts, priority, cap markers, and links.
- Schedule preview and audited schedule updates.
- Saved calendar views.
- ICS export.
- Export audit trail.
- Review packs as immutable planning snapshots.

### Planning Warnings

The calendar computes advisory warnings for:

- Missing start or end dates.
- Draft or pending campaigns starting soon.
- Active campaigns ending soon.
- Missing linked assets.
- Linked assets not active.
- Linked assets ending before campaign end.
- Overlap on the same app and placement.
- Overlap on the same derived channel.
- Overlap on the same explicit audience reference.
- Reuse of the same content or offer asset.

### Arbitration And Pressure Visibility

The calendar surfaces scan-level risk and pressure indicators:

- Overlap risk.
- Pressure risk.
- Blocking conflicts.
- Needs-arbitration state.
- Priority and cap markers.
- Shared placement, audience, and asset references.
- Top drivers and suggested next actions.

This is a planning signal. It does not simulate customer-level fatigue or runtime arbitration beyond grounded campaign fields.

## Engage: Experiments

Experiments support versioned A/B and weighted multivariate testing.

Functional capabilities include:

- Experiment inventory with browse, filter, and management.
- Draft, active, paused, and archived states.
- Weighted treatment definitions.
- Deterministic sticky assignment by profile, anonymous ID, stitching ID, or configured unit.
- Optional assignment TTL or time-bucket behavior.
- Holdout behavior for lift measurement.
- Campaign integration through `experimentKey`.
- Exposure tracking.
- Variant metadata in campaign events and decision responses.
- Experiment preview and playground surfaces.
- Experiment-linked asset variants and manual promotion of winning variants to default.

Experiments do not automatically choose winners. The product exposes candidates and metadata; operators decide promotion.

## Engage: App, Placement, And Template Inventory

The system manages the runtime context required for in-app delivery:

- Apps define application keys and platform metadata.
- Placements define placement keys, template allow-lists, descriptions, and TTL defaults.
- Templates define schema requirements for campaign content validation.

These objects help ensure that campaigns and assets are compatible with the surfaces where they will render.

## Engage: Meiro Workbench And Campaign Control

The Meiro workbench connects product workflows to Meiro CDP data.

Capabilities include:

- Meiro MCP status and metadata access.
- Segment, attribute, event, funnel, and customer search wrappers.
- Customer profile import into simulator workflows.
- Audience filter support for campaign calendar using Meiro segment IDs.
- Decision Builder field registry enrichment from Meiro attributes.

Meiro Campaign Control reads native Meiro email, push, and WhatsApp campaigns through the direct CDP API and normalizes them for product visibility.

Campaign Control capabilities include:

- Channel selection for email, push, and WhatsApp.
- Listing native campaigns, including optional deleted/trash views.
- Reading schedule, campaign type, frequency cap, segment references, and operational metadata where available.
- Mapping native campaigns into calendar-compatible planning records.
- Controlled campaign operations where implemented by the Meiro API integration.

The platform is conservative when Meiro schedule data is incomplete: it does not infer send dates from partial schedule payloads.

## Engage: Tools

Engage Tools include:

- Decide Debugger for live v2 in-app decision checks.
- Events Monitor for stream lag and worker health.
- Experiment Playground for live assignment checks and website-like preview of variant content.

These tools support debugging, validation, and operational triage around in-app delivery.

## Observe: Operational Heartbeat

The Operational Heartbeat is the top-level runtime status view. It summarizes system status, delivery reliability, and recent activation activity for the selected environment.

It is intended as a first stop for operators and product owners who need to understand whether the activation platform is healthy.

## Observe: Logs

Logs provide decision and in-app runtime visibility with replay support.

Log capabilities include:

- Decision log list and details.
- In-app decision log visibility.
- Request IDs and correlation IDs.
- Payload and trace inspection.
- Replay inputs.
- Runtime latency fields.
- Outcome, reason, action, and fallback visibility.
- Export support where permissioned.

Logs are central for troubleshooting why a customer received or did not receive an activation.

## Observe: Activation Map

The Activation Map traces dependencies, dependents, and production impact for governed activation entities.

It helps answer:

- What does this entity depend on?
- What depends on this entity?
- How many active downstream objects may be affected?
- What is the impact and risk level of a change?

Typical entities include decisions, stacks, offers, content blocks, bundles, experiments, campaigns, policies, templates, placements, and apps.

## Observe: Asset Health

Asset Health provides operational health for governed offers, reusable assets, variants, and bundles.

It reports:

- Healthy, warning, and critical states.
- Missing defaults.
- No runtime-eligible variants.
- Duplicate scopes.
- Broken primitive references.
- Expired or not-yet-valid assets.
- Missing template or placement metadata.
- Stale experiment metadata.
- Broken bundle components.
- Orphaned assets.
- Active references and release-related risks.

## Observe: Realtime Cache

The Realtime Cache surface exposes cache status and invalidation operations.

Runtime caching supports:

- Profile cache.
- Realtime decision cache.
- In-app decision cache.
- Stale-if-error behavior.
- Stale-while-revalidate behavior.
- Manual invalidation.
- Cache effectiveness monitoring.

## Observe: Orchestration Policies

The orchestration UI is a contact governance surface for runtime pressure controls.

Policy capabilities include:

- Create, validate, edit, activate, and archive policies.
- Configure frequency caps.
- Configure mutex groups.
- Configure cooldown windows.
- Configure fail-open or fail-closed behavior.
- Configure fallback actions.
- Inspect policy outcomes in debug traces.

Policies apply to realtime decisions, decision stacks, in-app decisions, and precompute output.

## Observe: Dead Letter Queue

The DLQ stores failed async events and replayable tasks.

DLQ capabilities include:

- View messages by topic, status, and error.
- Inspect message details.
- Retry now.
- Quarantine.
- Resolve.
- Run retry-due processing.
- Monitor pending, retrying, quarantined, and resolved states.

Supported topics include Pipes webhooks, precompute tasks, tracking events, export tasks, and Pipes callback delivery.

## Observe: Precompute Runs And Decision Results

Precompute generates decision or stack results in batch for high-volume activation use cases.

Capabilities include:

- Start precompute runs.
- Track queued, running, done, failed, and canceled states.
- Inspect totals, successes, suppressed, no-op, and errors.
- View run results.
- Lookup latest ready precomputed result by identity and key.
- Cleanup expired or old results.

Precompute is useful when activations need low-latency lookup or bulk preparation outside the hot runtime path.

## Observe: Releases

Releases create governed promotion plans across environments.

Release capabilities include:

- Select entities to promote.
- Expand dependencies.
- Compare source and target versions.
- Show diffs and product-readable change notes.
- Identify risk flags and remediation hints.
- Create release plans.
- Approve release plans.
- Apply release plans.
- Copy as draft or copy and activate in target environment.
- Inspect release detail and action history.

Supported release entities include decisions, stacks, offers, content blocks, bundles, experiments, campaigns, policies, templates, placements, and apps.

## Configure: Integrations And Runtime Settings

### WBS Settings

WBS settings configure the profile lookup endpoint used to hydrate runtime and simulator profiles.

Capabilities include:

- Base URL configuration.
- Attribute, value, and segment parameter names.
- Optional segment parameter behavior.
- Timeout configuration.
- Active instance selection.
- Test connection.
- History.

### WBS Mapping

WBS Mapping controls how WBS returned attributes become the internal profile model.

Mapping capabilities include:

- Map returned attributes to profile attributes.
- Map returned values to audiences.
- Map returned values to consents.
- Configure profile ID strategy.
- Validate mapping.
- Test mapping against sample WBS responses.
- Inspect raw and mapped output.
- Track mapping history.

### Meiro MCP

Meiro MCP settings expose non-secret status and diagnostics for the Meiro MCP stdio integration. Product features use typed wrappers for segments, attributes, events, funnels, and customer search rather than raw tool calls.

The MCP integration is not used in the runtime hot path. It supports authoring, planning, debugging, and enrichment.

### Pipes Integration

Pipes integration supports:

- Connection checks.
- Requirement lookup.
- Inline evaluate debug.
- Requirements hash pinning.
- Safe debug output.
- Integration-time tester skeletons.

### Pipes Callback

Pipes Callback settings configure Governed Activation callback delivery.

Capabilities include:

- Enable or disable callback delivery.
- Configure callback URL.
- Configure auth type and secret behavior.
- Configure callback mode.
- Configure timeout and max attempts.
- Include or exclude debug and profile summary fields.
- Configure PII allow-listing.
- View recent callback deliveries.
- Route failed callback delivery through DLQ.

### Webhook Rules

Webhook rules map inbound event types to cache invalidation and optional targeted recompute behavior.

### App Settings

App settings include personal UI preferences and environment-scoped runtime defaults, including enum/configuration values used across the authoring experience.

### Users And RBAC

The system has role and permission-based access control. Default role patterns include:

- Viewer: read-only access to most product surfaces plus simulator and audit visibility.
- Builder: create and edit decisions, stacks, catalog assets, campaigns, and experiments.
- Publisher: activate, archive, and promote governed objects.
- Operator: logs, cache, DLQ, precompute, results, and audit operations.
- Admin: full access.

Permissions are granular across decisions, stacks, catalog, engagement objects, experiments, logs, cache, DLQ, precompute, settings, releases, audit, users, roles, and simulator.

## Runtime And Delivery Channels

### Realtime Decision API

The realtime decision API evaluates active decisions for a profile or lookup identity. It supports environment selection, profile hydration, consent/policy enforcement, caching, fallback, asset resolution, debug tracing, logging, and optional writeback.

### Decision Stack API

The stack runtime evaluates ordered decision steps and returns the final action. It supports the same governance and observability concepts as single decisions.

### In-App Delivery API

The in-app delivery API decides whether a placement should show a message. It handles app, placement, profile, context, campaign eligibility, schedule, caps, holdout, experiments, varianting, payload rendering, tracking metadata, and TTL.

### Event Ingestion API

The event API captures impressions, clicks, and dismissals. It supports idempotency and async worker processing.

### Client SDKs

The repository contains lightweight client SDK scaffolding for:

- Web TypeScript.
- Android Kotlin.
- iOS Swift.

SDK responsibilities include:

- Configure base URL, auth, environment, app key, and default context.
- Set profile ID, anonymous ID, or lookup identity.
- Call decide.
- Track impression, click, and dismiss.
- Flush queued events on mobile.
- Apply client-side timeout, retry, cache, stale-if-error, and event idempotency behavior.

SDKs do not render UI. Client applications own payload rendering.

## Reliability And Operations

The product includes operational controls intended for production use:

- API/UI/Postgres/Redis deployment topology.
- Separate serve and worker runtime roles.
- Health endpoint.
- Redis-backed caches and streams.
- DLQ and retry policy.
- Retention worker.
- Precompute runner.
- In-app events worker.
- Orchestration events worker.
- Timeout budgets.
- Retry and stale-cache modes.
- Fallback outputs.
- Cache invalidation.
- Event idempotency.
- PII redaction for failure payloads.

Recommended monitoring focuses on:

- Decision and in-app latency.
- Cache hit, stale serve, and fallback ratios.
- WBS latency and timeout/error ratios.
- DLQ backlog.
- Async event ingest health.
- Precompute throughput and errors.
- Retention worker health.
- Table growth.

Initial SLO examples in the repo include low p95 latency for in-app decisions, low fallback ratio, high cache hit ratio for hot placements, DLQ drain expectations, and low event ingest failure ratio.

## Product Data Model Summary

Key product objects include:

- Decision.
- Decision version.
- Decision stack.
- Decision logs and stack logs.
- Decision authoring evidence.
- Decision scenario tests.
- Conversion.
- WBS instance.
- WBS mapping.
- In-app application.
- In-app placement.
- In-app template.
- In-app campaign.
- In-app campaign variant.
- In-app campaign version.
- In-app audit log.
- In-app decision log.
- In-app event.
- In-app decision cache.
- Offer.
- Offer variant.
- Content block.
- Content block variant.
- Asset bundle.
- Catalog audit log.
- Campaign calendar saved view.
- Campaign calendar review pack.
- Experiment version.
- Experiment assignment.
- Experiment exposure.
- Precompute run.
- Decision result.
- Orchestration policy.
- Orchestration event.
- App setting.
- Pipes callback config.
- Dead letter message.
- DLQ config.
- Release.
- Release item.
- User and role/permission data.

## End-To-End Product Workflows

### Author And Activate A Decision

1. Builder creates or edits a decision in DEV.
2. Builder defines eligibility, rules, caps, payload references, and reliability defaults.
3. Builder validates the decision and runs simulator checks.
4. Builder reviews dependencies and readiness.
5. Publisher activates the decision or includes it in a release plan.
6. Runtime serves the decision and logs outcomes.
7. Product and ops users inspect reports, logs, conversions, and health.

### Build A Decision Stack

1. Builder creates a stack of ordered decision steps.
2. Builder references existing decision keys.
3. Simulator verifies step-by-step behavior.
4. Publisher activates the stack.
5. Runtime evaluates the stack and records step evidence.
6. Precompute can generate stack results for bulk activation.

### Create And Use A Reusable Asset

1. Asset owner creates a typed asset in the Activation Asset Library.
2. Asset owner edits content, locale payloads, variants, tokens, and compatibility metadata.
3. Readiness checks identify missing defaults, invalid variants, broken references, or metadata gaps.
4. Publisher activates the asset.
5. Decision or campaign author selects the asset through compatible picker flows.
6. Runtime resolves the active asset and selected variant.
7. Asset Health and Activation Map show usage, dependencies, and impact.

### Launch An In-App Campaign

1. Campaign manager configures app, placement, template, content, offer, eligibility, schedule, caps, priority, holdout, and variants.
2. Campaign manager previews runtime behavior in the simulator or decide debugger.
3. Calendar shows schedule, placement conflicts, audience overlap by exact reference, asset reuse, readiness, and pressure markers.
4. Campaign is submitted for approval.
5. Approver approves and activates or rejects to draft.
6. Runtime serves eligible placements and emits tracking metadata.
7. Client SDK tracks impressions, clicks, and dismissals.
8. Reports show campaign and variant performance.

### Plan Campaign Pressure

1. Product or campaign manager opens Campaign Calendar.
2. User filters by date, channel, placement, app, audience, asset, source, or readiness.
3. Calendar shows scheduled and unscheduled campaigns.
4. User reviews overlap, pressure, blocking conflicts, and needs-arbitration states.
5. User adjusts schedule or opens campaign editor.
6. User creates review pack or exports calendar data for planning handoff.

### Promote A Release

1. Publisher selects source and target environments.
2. Publisher selects entities to promote.
3. System expands dependencies and creates a release plan.
4. System computes diffs, change notes, risk flags, and remediation hints.
5. Approver approves the release plan.
6. Publisher applies the release.
7. Target environment receives draft or active versions according to selected mode.

### Troubleshoot Runtime Behavior

1. Operator or builder searches logs by request, profile, decision, stack, campaign, or correlation ID.
2. User inspects outcome, reasons, payload, trace, latency, fallback, and replay input.
3. User checks cache stats, WBS status, DLQ, event monitor, and orchestration traces.
4. User retries or resolves DLQ messages if async delivery failed.
5. User uses simulator or debugger to reproduce behavior.

## Integrations

### Meiro CDP

The system integrates with Meiro in two ways:

- Meiro MCP for metadata and exploration, including segments, attributes, events, funnels, customer search, and customer attributes.
- Direct Meiro CDP API for operational runtime data, campaign APIs, and WBS audience lookup.

Product uses include:

- Field registry enrichment.
- Simulator profile import.
- Campaign calendar audience filters.
- Native Meiro campaign visibility.
- WBS-based profile hydration.

### WBS

WBS lookup hydrates profile attributes, audience membership, and consent data for runtime and simulation. The mapping layer normalizes returned fields into the decision engine profile model.

### Pipes

Pipes integration supports requirement lookup, inline evaluation diagnostics, webhook-driven invalidation, targeted recompute, and callback delivery.

### Client Applications

Client apps integrate through SDKs or direct API calls for in-app decide and event tracking. They remain responsible for rendering returned payloads.

## Governance, Audit, And Safety

Governance is applied through:

- Environment separation.
- Versioning.
- Lifecycle states.
- RBAC permissions.
- Activation and archive permissions.
- Campaign approval workflow.
- Catalog audit logs.
- In-app audit logs.
- Release approval and apply flow.
- Readiness checks.
- Impact analysis.
- Archive consequences.
- Product-readable diffs.
- Dependency graphs.
- Runtime reason codes and logs.

The system favors soft warnings and explicit review over hard blocking in several areas, especially catalog archive safety and planning risks. Hard blocks are used where runtime eligibility or validation would be invalid.

## Deliberate Current Limits

The following limits are explicit in the current product shape:

- The asset library is not a digital asset management system.
- There is no binary upload, media transformation, rights management, or AI media generation workflow.
- Primitive assets are represented as governed content-block flavors, not a separate media service.
- Asset compatibility metadata is convention-based unless explicitly configured.
- Locale fallback is deterministic and convention-based, not a full market inheritance model.
- Campaign Calendar is a planning view, not a separate workflow engine.
- Calendar pressure is based on exact known references and campaign metadata; it does not estimate warehouse-grade audience overlap or customer-level fatigue.
- Native email, push, WhatsApp, journey, release, experiment, and decision-stack calendar events are not first-class calendar sources unless represented by existing campaign records or imported Meiro campaign data.
- Experiments do not automatically promote winners.
- Asset health is operational and deterministic, not attribution-grade analytics.
- Release risk is a practical rule set, not a complete environment diff engine.
- SDKs do not render UI.
- Meiro MCP is not used in the runtime hot path.
- Destructive or bulk Meiro campaign operations require additional governance before broad product exposure.

## Gap Analysis Checklist

Use this checklist to compare the system against an existing platform:

- Does the existing platform support environment-scoped governed objects?
- Does it separate authoring, activation, release, and runtime operations?
- Does it support versioned decisions and decision stacks?
- Does it support deterministic runtime evaluation with reason codes and replayable logs?
- Does it support reusable governed assets across decisions and campaigns?
- Does it support variants by locale, channel, and placement?
- Does it support asset readiness, impact, dependency, archive preview, and release risk?
- Does it support in-app campaign lifecycle with approval, rollback, audit, and measurement?
- Does it support deterministic experiment assignment and exposure tracking?
- Does it support campaign calendar planning with readiness, overlap, pressure, review packs, and ICS export?
- Does it support cross-channel frequency, mutex, and cooldown policies?
- Does it support realtime, precompute, cache, stale fallback, and DLQ operations?
- Does it support Meiro CDP metadata, WBS profile lookup, and native campaign visibility?
- Does it support SDK-based in-app delivery and event tracking?
- Does it provide product-facing observability across runtime decisions, assets, campaigns, events, and releases?
- Does it provide granular RBAC across builder, publisher, operator, viewer, and admin personas?

## Source Basis

This description was derived from repository documentation, UI navigation and page surfaces, API route modules, Prisma product objects, and existing feature documentation in this workspace.

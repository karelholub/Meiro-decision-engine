# Meiro CDP API Integration

## Verified Live Capabilities

The app now supports two Meiro integration paths:

- **Meiro MCP** for analyst metadata and exploration: segments, attributes, events, funnels, customer search, and customer attributes.
- **Meiro CDP API** for operational runtime data: authenticated campaign APIs and WBS audience lookups.

The direct CDP API was verified against the configured Meiro domain with the app credentials. The verified login flow is:

- `POST /api/users/login`
- JSON body: `email`, `password`
- response includes a bearer-style session token used as `X-Access-Token` and `Authorization`.

Verified campaign listing endpoints:

- `GET /api/emails`
- `GET /api/push_notifications`
- `GET /api/whatsapp_campaigns`
- `GET /api/emails/trash`
- `GET /api/push_notifications/trash`
- `GET /api/whatsapp_campaigns/trash`

Verified WBS audience endpoints:

- `GET /wbs?attribute=...&value=...&category_id=...`
- `GET /wbs/segments?attribute=...&value=...`

WBS identity attributes are controlled by the Meiro instance. The verified working example used `stitching_meiro_id`; other profile attributes may be rejected by Meiro as not allowed for WBS lookup.

## New App Surfaces

API routes:

- `GET /v1/meiro/api/status`
- `POST /v1/meiro/api/check-login`
- `GET /v1/meiro/audience/profile`
- `GET /v1/meiro/audience/segments`
- `GET /v1/meiro/native-campaigns`
- `GET /v1/meiro/native-campaigns/:channel/:id`
- write-capable native campaign control routes under `/v1/meiro/native-campaigns/:channel/:id/*`

UI surfaces:

- Meiro Campaign Control now reads live email, push, and WhatsApp campaigns from the native CDP API.
- Simulator can import a live Meiro WBS profile into saved simulation profiles, including returned attributes and exact segment memberships.
- Campaign Calendar includes live native Meiro email, push, and WhatsApp campaigns as `meiro_campaign` events.

## Campaign Calendar Mapping

Native Meiro campaigns are normalized into the existing Campaign Calendar model rather than a separate calendar.

Mapped fields:

- source type: `meiro_campaign`
- channel: `email`, `mobile_push`, or `whatsapp`
- audience references: exact Meiro `segment_ids`, represented as `meiro_segment:<id>`
- cap signals: Meiro `frequency_cap.max_count` and `frequency_cap.period`
- status: non-deleted campaigns map to active calendar items; deleted campaigns map to archived items when archived campaigns are included
- drilldown: `/engage/meiro-campaigns?channel=...&campaignId=...`

Schedule precision is intentionally conservative. If the native campaign API returns concrete schedule datetimes, they become calendar windows. If the API exposes only schedule objects or segment IDs without concrete datetimes, the campaign appears in the calendar's unscheduled/planning lane with missing schedule warnings. The app does not infer send dates from incomplete schedule payloads.

## Usage Principles

Use MCP for discovery and metadata because it exposes CDP semantic tools such as segment and attribute listing.

Use the direct CDP API for:

- campaign inventory and campaign details
- controlled campaign operations
- WBS profile hydration for simulator and runtime validation
- exact segment memberships for a known WBS identity

Do not use WBS profile responses to claim customer-level reach or audience overlap beyond what Meiro returns. Segment membership is exact for the looked-up identity, but campaign reach and overlap still require campaign/audience contracts or warehouse support.

## Deferred

- full campaign calendar import from native Meiro campaign schedules
- audience size and overlap estimation beyond exact segment IDs
- customer-level pressure calculations from Meiro behavioral history
- write-back of Decision Engine outcomes into Meiro profile labels or attributes
- destructive or bulk campaign operations without a dedicated governance workflow

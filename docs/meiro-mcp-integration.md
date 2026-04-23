# Meiro MCP integration

The app can connect to Meiro CDP through the official Meiro MCP server. The Meiro documentation describes the server as a stdio MCP process launched with `uvx meiro-mcp` and configured with `MEIRO_DOMAIN`, `MEIRO_USERNAME`, and `MEIRO_PASSWORD`.

## What is implemented

- API configuration for launching the Meiro MCP stdio server.
- A lightweight MCP client that initializes the session, lists available tools, and calls a selected tool.
- API routes under `/v1/meiro/mcp`.
- A settings UI at `/settings/integrations/meiro-mcp`.
- Docker runtime support for `uvx` in the API container.
- Typed read-only data wrappers for Meiro segments, attributes, events, funnels, customer search, and customer attributes.
- Product integrations that use typed wrappers instead of raw tool calls:
  - Campaign Calendar audience filter can pick exact Meiro segment IDs.
  - Decision Builder field registry can merge Meiro CDP attributes for schema-aware conditions.
  - Simulator can search a Meiro customer and import profile attributes into a saved simulation profile.

The integration intentionally does not hardcode credentials or store passwords in the database.

## Required API environment variables

```bash
MEIRO_MCP_ENABLED=true
MEIRO_DOMAIN=https://cdp.store.demo.meiro.io
MEIRO_USERNAME=your-user@example.com
MEIRO_PASSWORD=your-password
```

Optional overrides:

```bash
MEIRO_MCP_COMMAND=uvx
MEIRO_MCP_ARGS=meiro-mcp
MEIRO_MCP_TIMEOUT_MS=15000
```

For Docker Compose, export these values in the shell or place them in a local `.env` file that is not committed:

```bash
export MEIRO_MCP_ENABLED=true
export MEIRO_DOMAIN=https://cdp.store.demo.meiro.io
export MEIRO_USERNAME=your-user@example.com
export MEIRO_PASSWORD=your-password
docker compose up --build -d api ui
```

## API routes

### Raw MCP administration

- `GET /v1/meiro/mcp/status`
  - Returns non-secret configuration status.
- `POST /v1/meiro/mcp/check`
  - Starts the MCP server, initializes it, lists tools, then closes the process.
- `GET /v1/meiro/mcp/tools`
  - Lists tools from the configured Meiro MCP server.
- `POST /v1/meiro/mcp/tools/:name/call`
  - Calls a specific tool with a JSON object body:

```json
{
  "arguments": {
    "limit": 10
  }
}
```

These raw routes are intended for diagnostics and admin validation. Product features should prefer the typed data routes below.

### Typed product data routes

- `GET /v1/meiro/mcp/data/segments`
  - Calls `list_segments`, normalizes IDs/names/customer counts, and caches the result briefly.
- `GET /v1/meiro/mcp/data/segments/:id`
  - Calls `get_segment_details` for an integer Meiro segment ID.
- `GET /v1/meiro/mcp/data/attributes`
  - Calls `list_attributes`, normalizes attribute IDs, labels, data types, and compound sub-attributes, and caches the result briefly.
- `GET /v1/meiro/mcp/data/events`
  - Calls `list_events`, normalizes event IDs, labels, descriptions, and examples, and caches the result briefly.
- `GET /v1/meiro/mcp/data/funnels`
  - Calls `list_funnels`, normalizes funnel groups and nested funnels, and caches the result briefly.
- `GET /v1/meiro/mcp/data/funnels/:id/groups?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&segmentId=...`
  - Calls `get_funnel_group_data` for an explicit date range and optional segment.
- `GET /v1/meiro/mcp/data/customers/search?q=...&limit=...`
  - Calls `search_customers`; this is for simulator/debug workflows, not broad customer browsing.
- `GET /v1/meiro/mcp/data/customers/:id/attributes`
  - Calls `get_customer_attributes`; the response is used to hydrate simulator profiles.

## Operational behavior

The API starts a short-lived MCP stdio process per check/list/call request. This keeps runtime behavior deterministic and avoids long-lived child process lifecycle concerns. Tool names and schemas come directly from the installed `meiro-mcp` package, so the admin UI can present them dynamically.

Typed metadata routes add a small in-memory cache for read-heavy lists. Customer search and customer attribute lookups are not cached by default because they can contain sensitive profile data.

The MCP connection is not used in the runtime decision path. It is used for authoring, planning, debugging, enrichment, and governed future writeback flows.

## Security notes

- Do not commit `MEIRO_PASSWORD`.
- Rotate credentials that have been pasted into chats, logs, or local history.
- The settings UI displays only non-secret status: command, args, domain, username, timeout, and missing env keys.
- MCP tool calls may access customer data depending on the Meiro user permissions; keep routes behind the existing API auth key and UI permissions.
- Customer profile search and attribute import are intended for simulator/debug use. Keep PII redaction, permissions, and audit requirements in mind before widening access.

## Deferred

- `create_segment` is intentionally not exposed as a casual raw product action yet. A production writeback flow should add approval, preview, naming rules, audit logging, and release gating before creating Meiro CDP segments.
- Funnel data is available as a typed route, but it is not yet wired into arbitration or pressure scoring.
- Calendar overlap should only claim exact audience overlap when using stable Meiro segment IDs or other explicit references.

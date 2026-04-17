# UI Density Guidance

The platform supports three density levels for shared UI primitives:

- `default`: reading, editing, setup flows, drawers, and form-heavy pages.
- `compact`: operational dashboards, calendars, inventories, queues, logs, and monitoring pages.
- `dense`: high-volume rows, small cards, chips, and scan-only metadata inside operational screens.

## Principles

Use spacing to support comprehension, not to make every surface feel roomy. Operational pages should let users scan more records, statuses, risks, and actions without forcing inner values to wrap.

Use compact density when the page is primarily about:

- filtering and scanning a list
- triaging status or health
- comparing operational counts
- reviewing calendar, queue, log, or inventory items

Keep default density when the page is primarily about:

- composing or editing configuration
- reading documentation
- understanding a detail drawer
- entering complex forms

Reserve dense density for:

- table rows
- event cards
- compact metric cards
- signal chips
- repeated metadata badges

## Shared Primitives

Prefer these primitives instead of local spacing rules:

- `PageHeader density="compact"` for operational headers.
- `FilterPanel density="compact"` for dense filter bars.
- `PagePanel density="compact"` for operational panels.
- `MetricCard` for summary counters.
- `SignalChip` for compact operational metadata.
- `OperationalTableShell` and table class constants for compact tables.

Cards and tables should show scan-level information only. Put explanations, full labels, and longer rationale in drawers or detail pages.

## Avoid

- Applying compact density globally to every page.
- Shrinking editor forms and documentation pages.
- Showing every badge or warning on compact cards.
- Recreating local table, metric, and chip classes when a shared primitive exists.

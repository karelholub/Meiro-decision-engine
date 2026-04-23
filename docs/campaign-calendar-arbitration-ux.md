# Campaign Calendar Arbitration and Pressure UX

## Scope

This spec defines interaction hierarchy and visual cues for overlap/arbitration and pressure visibility in `/engage/calendar`, using existing API/UI contracts only.

Goals:

- Make high-risk overlap and pressure states obvious at scan speed.
- Clarify when a planner should take action versus monitor.
- Keep implementation within the current `CampaignCalendarItem` shape and existing endpoints.

Non-goals:

- Runtime arbitration simulation.
- New backend risk fields or schema changes.
- New campaign workflow states.

## Existing Data Contract (No Schema Churn)

Use existing fields already returned by `GET /v1/inapp/campaign-calendar`:

- Risk: `overlapRiskLevel`, `pressureRiskLevel`
- Overlap detail: `overlapSummary`, `sameDayCollisionCount`, `conflicts`
- Pressure detail: `pressureSummary`, `pressureSignals`, `capSignals`, `reachabilityNotes`
- Shared references: `sharedAudienceRefs`, `sharedPlacementRefs`, `sharedAssetRefs`
- Action context: `status`, `approvalState`, `planningReadiness`, `priority`, `orchestrationMarkers`

## UX Hierarchy

1. Global pressure/arbitration strip (calendar-level)
2. Campaign card risk chips (scan-level)
3. Drawer arbitration module (decision-level)
4. Existing governed actions and schedule editor (execution-level)

The key change is explicit prioritization: users should see "what needs arbitration now" before browsing raw metrics.

## Wireframes

### A. Calendar-level strip (above grid/list)

```text
+----------------------------------------------------------------------------------+
| Arbitration & Pressure                                                           |
| Needs arbitration: 6   Blocking conflicts: 2   Cap pressure: 4   Hotspots: 3    |
| [Filter needs arbitration] [Filter blocking] [Filter cap pressure] [View all]    |
| Top drivers: Placement overlap (2), Audience pressure (3), Asset reuse (2)      |
+----------------------------------------------------------------------------------+
```

Mapping:

- `Needs arbitration` = items with `overlapRiskLevel >= medium` OR `pressureRiskLevel >= medium`
- `Blocking conflicts` = `conflicts` entries with `severity = blocking`
- `Cap pressure` = items with `capSignals.length > 0`
- `Top drivers` = aggregate of `pressureSignals.code` and overlap conflict types already present

### B. Campaign card (month/week/list)

```text
+----------------------------------------------------------+
| Campaign Name                                   [ACTIVE] |
| key_123                                                   |
| [Ready · 82] [P2] [O High] [P Medium] [Needs arbitration]|
| Placement: appA / checkout                                |
| Audience: vip_users                                        |
| Driver: Exact audience pressure +2                         |
+----------------------------------------------------------+
```

Behavior:

- Add a single intent chip: `Needs arbitration` or `Monitor`.
- Keep existing O/P risk chips, but promote one "driver" text line using highest-risk signal.
- On compact cards, show only one driver plus `+N`.

### C. Drawer arbitration module (directly under risk summary)

```text
+----------------------------------------------------------------------------------+
| Arbitration summary                                                              |
| Outcome: Needs arbitration          Confidence: Medium                            |
| Why:                                                                               |
| - Same placement overlaps: appA / checkout                                        |
| - Exact audience pressure: vip_users                                              |
| What to do now:                                                                   |
| 1) Re-time this campaign (open schedule editor)                                  |
| 2) Lower cap or priority in campaign editor                                       |
| 3) Keep as-is and submit reviewer note                                             |
| Nearby campaigns: [CMP-402] [CMP-188] [CMP-233]                                  |
+----------------------------------------------------------------------------------+
```

Behavior:

- "Outcome" is derived, not persisted:
  - `blocking` if conflict severity includes blocking
  - `needs_arbitration` if medium/high risk without blocking
  - `monitor` otherwise
- "Why" pulls from existing signal/conflict details.
- "What to do now" links to existing actions (`Edit schedule`, `Open editor`, governed actions).

## Interaction Rules

1. Default state (low/no risk):
- Cards show risk chips only when risk is not `none`.
- Drawer outcome displays `Monitor`.

2. Needs-arbitration state (medium/high risk, not blocking):
- Card shows `Needs arbitration` chip.
- Calendar strip increments `Needs arbitration`.
- Drawer shows top 2-3 reasons and suggested next actions.

3. Blocking state:
- Card shows `Blocking` instead of `Needs arbitration`.
- Drawer outcome is `Blocking`.
- Conflict list remains source of truth; no new backend validation path added.

4. Signal scarcity:
- If no pressure/cap signals, show existing "No grounded pressure cues" copy.
- Arbitration module should degrade to overlap/conflict-only reasoning.

## Acceptance Criteria

1. Calendar-level arbitration strip renders without new API calls and can be computed from currently loaded `calendar.items` + `calendar.summary`.
2. Each campaign card shows one explicit intent chip (`Blocking`, `Needs arbitration`, or `Monitor`) derived from existing risk/conflict fields.
3. Card-level "driver" label is always sourced from existing `capSignals`, `pressureSignals`, or `conflicts` and never requires new backend text fields.
4. Drawer includes an "Arbitration summary" module with:
   - derived outcome
   - top reasons
   - actionable next steps linked to existing controls
5. "Needs arbitration" and "Blocking conflicts" quick filters are implemented as client-side toggles over existing loaded items (or mapped to current server filters where already available).
6. No new backend schema, API response fields, or endpoint contracts are introduced.
7. Existing governed actions and schedule update flow remain unchanged and continue to be the only execution paths.
8. Empty-state behavior is explicit and non-alarming when pressure signals are absent.

## Engineering Handoff Notes

- Primary file: `apps/ui/src/app/engage/calendar/page.tsx`
- Reuse helpers from `apps/ui/src/app/engage/calendar/calendar-utils.ts` for risk labels and grouping.
- Prefer additive components (`CalendarArbitrationStrip`, `ArbitrationSummaryPanel`) over large rewrites.
- Keep badges/colors aligned with existing `calendarRiskClassName` and readiness classes.


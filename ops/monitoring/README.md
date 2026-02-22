# Monitoring Wiring (Golden Signals)

This folder contains deployable dashboard and alert artifacts derived from `docs/observability-golden-signals.md`.

## Files

- `ops/monitoring/grafana/dashboards/decision-engine-golden-signals.json`
- `ops/monitoring/grafana/alerts/decision-engine-alerts.yaml`

## Prerequisites

1. Grafana with Loki datasource available.
2. API logs shipped with label `app="decisioning-api"`.
3. Structured JSON log fields preserved (e.g. `totalMs`, `cacheHit`, `servedStale`, `fallbackReason`, `wbsMs`).

## Import Dashboard

1. Open Grafana -> Dashboards -> Import.
2. Upload `decision-engine-golden-signals.json`.
3. Bind datasource variable `DS_LOKI` to your Loki datasource.

## Import Alerts

1. Open Grafana -> Alerting -> Alert rules.
2. Import/provision `decision-engine-alerts.yaml`.
3. Route `severity=critical` to paging channel and `severity=warning` to ops channel.

## Post-import Validation

1. Generate sample traffic with `pnpm --filter @decisioning/api smoke:inapp`.
2. Confirm panel movement:
   - In-app latency p95/p99
   - Cache hit/stale/fallback ratios
   - WBS timeout ratio
3. Temporarily lower thresholds to force one alert and verify notification routing.

# Observability Golden Signals (Release 1)

This document defines the minimum dashboard and alerting requirements for production go-live.

## Dashboard Requirements

Create a single dashboard with environment filter (`DEV`/`STAGE`/`PROD`) and 5-minute refresh.

Include these panels:

1. Decide latency
- `decision_runtime.totalLatencyMs` p50/p95/p99
- `inapp_v2_runtime.totalMs` p50/p95/p99
- split by endpoint (`/v1/decide`, `/v2/inapp/decide`)

2. Cache effectiveness
- realtime cache hit ratio (`realtime_cache status=hit/miss`)
- stale served ratio (`servedStale=true`)
- fallback ratio (`fallbackReason` present)

3. Upstream health
- WBS latency (`wbsLatencyMs`, `wbsMs`) p50/p95
- timeout ratio (`fallbackReason=WBS_TIMEOUT`)
- upstream error ratio (`fallbackReason=WBS_ERROR`)

4. Async pipeline health
- in-app stream processed/failed/deduped (`inAppEventsWorker` status)
- DLQ due now / pending / quarantined (`/v1/dlq/metrics`)
- precompute run throughput and error ratio

5. Data lifecycle health
- retention worker last run time and deleted counts (`/v1/maintenance/retention/status`)
- table growth trends for `decision_logs`, `inapp_events`, `decision_results`

## SLO Targets (Initial)

1. `/v2/inapp/decide` p95 latency < 120ms (steady state)
2. `/v2/inapp/decide` fallback ratio < 1% over 15m
3. cache hit ratio for hot placements > 70%
4. DLQ due now backlog drains to zero within 10 minutes after incident ends
5. in-app event ingest worker failure ratio < 0.1% over 15m

## Alert Rules (Minimum)

1. Critical: `/v2/inapp/decide` p95 > 200ms for 10m
2. Critical: fallback ratio > 5% for 10m
3. Warning: DLQ `PENDING` + `RETRYING` increasing for 15m
4. Warning: retention worker has not run for 2x configured poll interval
5. Warning: in-app stream lag grows continuously for 10m

## Data Sources

1. Structured API logs (`decision_runtime`, `inapp_v2_runtime`, `realtime_cache`, `retention_cleanup`)
2. API status endpoints:
- `/health`
- `/v1/inapp/events/status`
- `/v1/dlq/metrics`
- `/v1/maintenance/retention/status`

## Rollout Checklist

1. Dashboard panels created for all metrics above
2. Alert thresholds configured in paging system
3. On-call tested with synthetic timeout/failure drills
4. Link runbook: `docs/runbooks/dependency-degradation.md`

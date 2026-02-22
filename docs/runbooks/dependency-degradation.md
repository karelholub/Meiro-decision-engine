# Dependency Degradation Runbook

This runbook describes how to operate the Decision Engine when core dependencies degrade.

## 1) WBS / Meiro slow or failing

Symptoms:
- `fallbackReason=WBS_TIMEOUT` or `fallbackReason=WBS_ERROR` rises
- `/v2/inapp/decide` latency and fallback ratio alerts fire

Immediate actions:
1. Confirm scope by environment and placement.
2. Reduce blast radius:
- lower `INAPP_V2_WBS_TIMEOUT_MS` (for faster fail-open)
- verify fallback behavior on critical decisions
3. Increase cache protection:
- verify stale responses are being served (`servedStale=true`)
4. Contact WBS/CDP owner with request IDs and timeframe.

Recovery checks:
1. timeout/error ratios return to baseline
2. fallback ratio drops below SLO threshold
3. no sustained DLQ growth from webhook/precompute flows

## 2) Redis unavailable or unstable

Symptoms:
- cache hit ratio drops to near zero
- in-app event stream ingestion pauses/fails
- lock-based protections stop helping (stampede risk)

Immediate actions:
1. Verify Redis health and network from API pods.
2. Scale API conservatively to prevent hot-path overload.
3. Temporarily reduce high-volume in-app traffic if needed.
4. Keep `API_RUNTIME_ROLE=serve` for API-only nodes and isolate worker pressure.

Recovery checks:
1. cache hit and stale-serve behavior recover
2. event worker catches up (pending/lag drops)
3. no prolonged DLQ growth for `TRACKING_EVENT`

## 3) Postgres saturation or partial outage

Symptoms:
- higher API error rate for write endpoints
- worker retries and DLQ growth
- elevated query latency on logs/results pages

Immediate actions:
1. Confirm connection pool and DB CPU/IO saturation.
2. Reduce non-critical writes:
- pause heavy backfills/precompute batches
- prioritize realtime decide traffic
3. Use maintenance retention run to trim oversized tables when DB stabilizes.
4. If needed, temporarily run API in `serve` role and pause worker-only tasks.

Recovery checks:
1. DB latency returns to normal
2. retries and DLQ backlog trend down
3. retention and export tasks resume without elevated errors

## 4) DLQ backlog increasing

Symptoms:
- `/v1/dlq/metrics` due-now and pending counts increase continuously
- repeated retries for same topic

Immediate actions:
1. Filter by topic to locate failing subsystem (`PIPES_WEBHOOK`, `PRECOMPUTE_TASK`, `TRACKING_EVENT`, `EXPORT_TASK`).
2. Fix root cause first (upstream endpoint, DB, auth, mapping).
3. Trigger controlled replay:
- `POST /v1/dlq/retry-due`
- use per-message retry from UI for sensitive payloads

Recovery checks:
1. due-now count drains
2. quarantine growth stops
3. replay success ratio stable for 15+ minutes

## 5) Safe fallback posture

During partial outages, prefer:
1. stale/cache-backed responses over hard failures on in-app decide
2. asynchronous buffering (stream + DLQ) over synchronous write failures
3. controlled replay after stabilization, not during active incident spikes

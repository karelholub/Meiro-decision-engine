# Incident Drill Report - 2026-02-22

## Drill Scope

Runbook: `docs/runbooks/dependency-degradation.md`

Simulated scenarios:
1. WBS timeout on in-app decide path
2. Redis hiccup on in-app decide cache path

## Command

```bash
pnpm --filter @decisioning/api drill:dependency
```

## Result

Overall: **PASS**

```json
{
  "drill": "dependency-degradation",
  "executedAt": "2026-02-22T16:51:17.369Z",
  "durationMs": 17,
  "scenarios": {
    "wbsTimeout": {
      "status": "PASS",
      "fallbackReason": "WBS_TIMEOUT",
      "show": false,
      "totalMs": 16
    },
    "redisHiccup": {
      "status": "PASS",
      "cacheHit": false,
      "servedStale": false,
      "show": true,
      "totalMs": 1
    }
  },
  "overall": "PASS"
}
```

## Interpretation

1. WBS timeout correctly failed open via fallback path (`fallbackReason=WBS_TIMEOUT`).
2. Redis cache failure did not fail the request path; runtime continued without cache.
3. This drill validates the release gate requirement for dependency degradation readiness.

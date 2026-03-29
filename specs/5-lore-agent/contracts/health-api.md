# Contract: Health API

The agent service exposes a single HTTP endpoint for health checks
and operational metrics.

## GET /healthz

Returns service health and operational status.

### Response 200

```json
{
  "status": "ok",
  "uptime_seconds": 86400,
  "tasks": {
    "processed_today": 12,
    "processed_total": 347,
    "current": null
  },
  "jobs": {
    "context_reindex": {
      "last_run": "2026-03-29T02:00:05Z",
      "status": "completed",
      "next_run": "2026-03-30T02:00:00Z"
    },
    "gap_detection": {
      "last_run": "2026-03-24T09:00:12Z",
      "status": "completed",
      "next_run": "2026-03-31T09:00:00Z"
    },
    "spec_drift": {
      "last_run": "2026-03-24T10:00:08Z",
      "status": "completed",
      "next_run": "2026-03-31T10:00:00Z"
    },
    "merge_check": {
      "last_run": "2026-03-29T18:59:30Z",
      "status": "completed",
      "next_run": "2026-03-29T19:00:30Z"
    },
    "memory_ttl": {
      "last_run": "2026-03-29T18:00:02Z",
      "status": "completed",
      "next_run": "2026-03-29T19:00:00Z"
    }
  },
  "database": {
    "connected": true
  }
}
```

### Response 503

When database is unreachable:

```json
{
  "status": "error",
  "reason": "database connection failed"
}
```

## Notes

- Used by Kubernetes liveness/readiness probes
- No authentication required (internal endpoint)
- Port configurable via `PORT` env var (default 8080)

---
service: platform-api
incident_type: database-connection-exhaustion
severity: P1
trigger: "Alert: pg_pool_available_connections < 5"
last_incident: 2025-09-15
last_updated: 2025-09-16
---

# Database Connection Exhaustion

## Symptoms

- 500 errors across all platform-api endpoints — not limited to one route.
- Logs show `connection pool exhausted` or `too many clients already`.
- Datadog shows connection count at or near max pool size.
- New requests hang for the pool timeout duration, then fail.
- Postgres itself may still be healthy — the bottleneck is the application-side pool.

## Diagnosis and Resolution

### 1. Check current connection count

```bash
kubectl exec postgres-0 -- psql -c "SELECT count(*) FROM pg_stat_activity WHERE state = 'active';"
```

If this number matches or exceeds your pool max (default: 20), you have exhaustion.

Also check total connections across all states:

```bash
kubectl exec postgres-0 -- psql -c "SELECT state, count(*) FROM pg_stat_activity GROUP BY state;"
```

Look for a high number of `idle in transaction` connections — these are holding connections without releasing them.

### 2. Find long-running queries

```bash
kubectl exec postgres-0 -- psql -c "SELECT pid, now() - pg_stat_activity.query_start AS duration, query FROM pg_stat_activity WHERE state = 'active' ORDER BY duration DESC LIMIT 10;"
```

Look for:
- Queries running for minutes (normal queries finish in milliseconds).
- Repeated identical queries — could indicate a retry loop.
- Missing indexes showing up as sequential scans on large tables.

### 3. Kill long-running queries

If you identified a specific runaway query by PID:

```bash
kubectl exec postgres-0 -- psql -c "SELECT pg_terminate_backend(PID);"
```

Replace `PID` with the actual process ID from step 2.

To kill all connections from a specific application (nuclear option):

```bash
kubectl exec postgres-0 -- psql -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = 'platform-api' AND state = 'idle in transaction' AND now() - state_change > interval '5 minutes';"
```

### 4. Restart the offending service

If connections keep leaking after killing queries, the application has a connection leak. Restart it:

```bash
kubectl rollout restart deploy/platform-api
```

Watch it come back:

```bash
kubectl rollout status deploy/platform-api
```

Then re-check connections (step 1) to confirm the count drops.

### 5. Increase pool size (temporary relief)

If the pool is too small for legitimate load (not a leak), bump it:

```bash
kubectl set env deploy/platform-api PGPOOL_MAX_SIZE=30
```

Default is 20. Max safe value is 50 — beyond that you risk hitting Postgres `max_connections` (default 100 shared across all services). Do not set above 50 without coordinating with the SRE team.

Check current Postgres max:

```bash
kubectl exec postgres-0 -- psql -c "SHOW max_connections;"
```

### 6. Verify resolution

- 500 error rate drops to baseline.
- `pg_pool_available_connections` recovers above threshold.
- Connection count in `pg_stat_activity` is stable, not climbing.

## Post-Incident

- Check recent deploys: `kubectl rollout history deploy/platform-api`. If a recent deploy correlates with the incident, review it for connection leaks.
- Common leak patterns to look for in code review:
  - Queries missing `connection.release()` in the finally block.
  - Missing `try/finally` around database calls.
  - Transactions opened but never committed or rolled back.
  - Connection acquired in middleware but not released on error paths.
- Update `last_incident` and `last_updated` dates in this file's frontmatter.
- If pool size was increased, file a ticket to evaluate whether the increase should be permanent or the load pattern needs investigation.

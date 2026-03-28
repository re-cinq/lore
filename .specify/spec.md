# Spec: MCP Server Health Check Endpoint

| Field        | Value                          |
|---|---|
| Feature      | mcp-health-check               |
| Team         | payments                       |
| Status       | draft                          |
| Created      | 2026-03-28                     |

## Problem

The MCP server (`@re-cinq/lore-mcp`) has no health check endpoint. Operators and Kubernetes liveness/readiness probes cannot verify that the server is up, connected to PostgreSQL, and has data. The existing `isAlloyDbAvailable()` helper in `db.ts` checks connectivity but is not exposed over HTTP.

## Solution

Add a `/healthz` HTTP endpoint to the MCP server that returns:

1. **Database connectivity status** — whether the PostgreSQL pool can execute a query.
2. **Chunk count** — total rows in the `org_shared.chunks` table (proves data exists, not just connectivity).

### Response Format

**Healthy (200):**
```json
{
  "status": "ok",
  "database": {
    "connected": true,
    "chunk_count": 1542
  }
}
```

**Degraded — no database configured (200):**
```json
{
  "status": "ok",
  "database": {
    "connected": false,
    "chunk_count": null,
    "reason": "no database configured (file-backed mode)"
  }
}
```

**Unhealthy — database configured but unreachable (503):**
```json
{
  "status": "error",
  "database": {
    "connected": false,
    "chunk_count": null,
    "reason": "connection failed"
  }
}
```

## Scope

### In scope
- `/healthz` route in HTTP transport mode.
- Database connectivity check via pool query (`SELECT 1`).
- Chunk count query (`SELECT count(*) FROM org_shared.chunks`).
- Works in both stdio (no-op) and HTTP mode.

### Out of scope
- Authentication on the health endpoint (health checks must be unauthenticated for K8s probes).
- Per-team schema health checks.
- Embedding service health (Vertex AI).
- Latency metrics on the health endpoint itself.

## Technical Approach

1. Add a `getHealthStatus()` function to `db.ts` that runs the connectivity + count queries.
2. In `index.ts`, register a `/healthz` route on the HTTP server (alongside the existing `/mcp` route).
3. Return appropriate status codes (200 for ok/degraded, 503 for error).

## Acceptance Criteria

- [ ] `GET /healthz` returns 200 with `"status": "ok"` when database is connected.
- [ ] `GET /healthz` returns 200 with `"connected": false` when no database is configured.
- [ ] `GET /healthz` returns 503 when database is configured but unreachable.
- [ ] Response includes `chunk_count` as an integer when database is connected.
- [ ] Endpoint is unauthenticated (no JWT required).
- [ ] No regression on existing MCP tools.

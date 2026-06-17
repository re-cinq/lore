/**
 * Shared dependency surface passed to every registerXTools(server, deps).
 *
 * The DB pool is created in main() AFTER tool registration, so tools must
 * read it lazily via getPool() rather than capturing a snapshot.
 */
import { trackToolCall } from "../../platform/session-tracker.js";
import { traceTool } from "../../platform/otel.js";
import {
  isCacheEnabled,
  readFresh,
  readAny,
  store,
  markFresh,
  markStale,
  type ReadCachePolicy,
} from "../../platform/proxy-cache.js";

export interface ToolDeps {
  /** Lazy accessor for the pg pool (null until main() initializes it). */
  getPool: () => any;
}

// --- Latency tracking helper (shared by tools that opt into it) ---
export function makeTrackLatency(getPool: () => any) {
  return async function trackLatency(tool: string, fn: () => Promise<any>): Promise<any> {
    const start = Date.now();
    let success = true;
    try {
      const result = await fn();
      return result;
    } catch (err) {
      success = false;
      throw err;
    } finally {
      const latencyMs = Date.now() - start;
      trackToolCall(tool, latencyMs, success);
      traceTool(tool, latencyMs, success);
      const pool = getPool();
      if (pool) {
        pool.query(
          `INSERT INTO memory.audit_log (agent_id, operation, metadata) VALUES ($1, $2, $3)`,
          ['system', tool, JSON.stringify({ latency_ms: latencyMs })],
        ).catch(() => {});
      }
    }
  };
}

// --- API proxy helpers (for local mode without DB) ---

// Shape lets callers distinguish "no proxy configured" (fall through to
// file mode is fine) from "proxy configured but unreachable" (loud
// failure — silently writing to a local file would lose org-wide
// shared state, which is what bit us on 2026-04-29 when GKE Autopilot
// was bouncing pods every few minutes).
export type ProxyResult =
  | { ok: true; body: string }
  | { ok: false; reason: "not_configured" }
  | { ok: false; reason: "unreachable"; detail: string };

export const PROXY_RETRY_DELAYS_MS = [200, 600, 1800]; // ~2.6s total budget before giving up

function isRetriableStatus(status: number): boolean {
  // 502 bad-gateway / 503 unavailable / 504 timeout — exactly the
  // codes you get from a load-balancer mid-Autopilot-eviction. 408
  // (request timeout) and 429 (throttle) are also retry-safe.
  return status === 408 || status === 429 || (status >= 500 && status < 600);
}

export async function proxyToApi(endpoint: string, body: Record<string, any>): Promise<ProxyResult> {
  const apiUrl = process.env.LORE_API_URL;
  const apiToken = process.env.LORE_INGEST_TOKEN;
  if (!apiUrl || !apiToken) return { ok: false, reason: "not_configured" };

  let lastDetail = "no attempts made";
  for (let attempt = 0; attempt <= PROXY_RETRY_DELAYS_MS.length; attempt++) {
    try {
      const res = await fetch(`${apiUrl}${endpoint}`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${apiToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) {
        return { ok: true, body: JSON.stringify(await res.json()) };
      }
      lastDetail = `HTTP ${res.status} ${res.statusText}`;
      if (!isRetriableStatus(res.status)) {
        // 4xx (auth, validation) — retrying won't help.
        console.error(`[lore-mcp] proxy ${endpoint} failed (${lastDetail}); not retrying`);
        return { ok: false, reason: "unreachable", detail: lastDetail };
      }
    } catch (err: any) {
      lastDetail = err?.name === "TimeoutError" ? "request timed out (15s)" : (err?.message || String(err));
    }
    if (attempt < PROXY_RETRY_DELAYS_MS.length) {
      const delay = PROXY_RETRY_DELAYS_MS[attempt];
      console.error(`[lore-mcp] proxy ${endpoint} attempt ${attempt + 1} failed (${lastDetail}); retrying in ${delay}ms`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  console.error(`[lore-mcp] proxy ${endpoint} exhausted ${PROXY_RETRY_DELAYS_MS.length + 1} attempts; last error: ${lastDetail}`);
  return { ok: false, reason: "unreachable", detail: lastDetail };
}

export function proxyMemory(action: string, params: Record<string, any>): Promise<ProxyResult> {
  return proxyToApi("/api/memory", { action, ...params });
}

// Read-through cache wrapper for proxied reads. Fresh hit short-circuits the
// network; on `ok` the response is stored; on `unreachable` a stale entry (if
// any) is served instead of erroring. `label` prepends a cache marker (skip it
// when the body is parsed downstream); `cacheIf` gates storage (e.g. logs only
// when complete). See proxy-cache.ts.
export async function withReadCache(
  policy: ReadCachePolicy | undefined,
  doProxy: () => Promise<ProxyResult>,
  opts: { label?: boolean; cacheIf?: (body: string) => boolean } = {},
): Promise<ProxyResult> {
  if (!policy || !isCacheEnabled()) return doProxy();
  const label = opts.label ?? true;

  const fresh = readFresh(policy);
  if (fresh) return { ok: true, body: label ? markFresh(fresh.body, fresh.ageSeconds) : fresh.body };

  const result = await doProxy();
  if (result.ok) {
    if (!opts.cacheIf || opts.cacheIf(result.body)) store(policy, result.body);
    return result;
  }
  if (result.reason === "unreachable") {
    const stale = readAny(policy);
    if (stale) return { ok: true, body: label ? markStale(stale.body, stale.ageSeconds) : stale.body };
  }
  return result;
}

// GET sibling of proxyToApi for read-only routes (e.g. /trace/*). Same
// config gate, retry budget, and ProxyResult shape; no request body.
export async function proxyGetApi(path: string): Promise<ProxyResult> {
  const apiUrl = process.env.LORE_API_URL;
  const apiToken = process.env.LORE_INGEST_TOKEN;
  if (!apiUrl || !apiToken) return { ok: false, reason: "not_configured" };

  let lastDetail = "no attempts made";
  for (let attempt = 0; attempt <= PROXY_RETRY_DELAYS_MS.length; attempt++) {
    try {
      const res = await fetch(`${apiUrl}${path}`, {
        method: "GET",
        headers: { "Authorization": `Bearer ${apiToken}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) {
        return { ok: true, body: JSON.stringify(await res.json()) };
      }
      lastDetail = `HTTP ${res.status} ${res.statusText}`;
      if (!isRetriableStatus(res.status)) {
        console.error(`[lore-mcp] proxy GET ${path} failed (${lastDetail}); not retrying`);
        return { ok: false, reason: "unreachable", detail: lastDetail };
      }
    } catch (err: any) {
      lastDetail = err?.name === "TimeoutError" ? "request timed out (15s)" : (err?.message || String(err));
    }
    if (attempt < PROXY_RETRY_DELAYS_MS.length) {
      const delay = PROXY_RETRY_DELAYS_MS[attempt];
      console.error(`[lore-mcp] proxy GET ${path} attempt ${attempt + 1} failed (${lastDetail}); retrying in ${delay}ms`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  console.error(`[lore-mcp] proxy GET ${path} exhausted ${PROXY_RETRY_DELAYS_MS.length + 1} attempts; last error: ${lastDetail}`);
  return { ok: false, reason: "unreachable", detail: lastDetail };
}

// Format an MCP error for an unreachable proxy. Surfaces the failure
// to the caller instead of silently writing to a local file (which
// would never sync to the org-wide DB).
export function unreachableError(op: string, detail: string): { content: [{ type: "text"; text: string }] } {
  return {
    content: [{
      type: "text" as const,
      text: `Lore API unreachable for ${op} after ${PROXY_RETRY_DELAYS_MS.length + 1} attempts: ${detail}. ` +
        `Refusing local-file fallback to prevent silent divergence from the org-wide DB. ` +
        `Check the GKE service (lore-mcp pods) and retry.`,
    }],
  };
}

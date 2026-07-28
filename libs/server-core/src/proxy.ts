/**
 * API proxy client for local mode (MCP adapter without a direct DB). Shared
 * infra: the local tools proxy their reads/writes to the remote Lore API
 * through these helpers. Lives in server-core so the proxy surface and the
 * `ProxyResult` shape have one home; `mcp/tools/deps.ts` re-exports it for the
 * tool modules.
 */
import {
  isCacheEnabled,
  readFresh,
  readAny,
  store,
  markFresh,
  markStale,
  type ReadCachePolicy,
} from "./platform/proxy-cache.js";

// Shape lets callers distinguish "no proxy configured" (fall through to
// file mode is fine) from "proxy configured but unreachable" (loud
// failure — silently writing to a local file would lose org-wide
// shared state, which is what bit us on 2026-04-29 when GKE Autopilot
// was bouncing pods every few minutes).
// `denied` (401/403) is kept distinct from `unreachable` on purpose: an
// authoritative "you may not read this" must NOT trigger a stale-cache serve
// (that would disclose data the caller has lost access to), whereas a true
// outage may fall back to a stale copy. See withReadCache.
export type ProxyResult =
  | { ok: true; body: string }
  | { ok: false; reason: "not_configured" }
  | {
      ok: false;
      reason: "unreachable";
      detail: string;
      /** Set only for a non-retriable HTTP response, so a caller can tell an
       *  authoritative refusal (e.g. a 409 conflict) from a real outage. */
      status?: number;
      /** That response's raw body, when it had one. */
      body?: string;
    }
  | { ok: false; reason: "denied"; detail: string };

export const PROXY_RETRY_DELAYS_MS = [200, 600, 1800]; // ~2.6s total budget before giving up

function isRetriableStatus(status: number): boolean {
  // 502 bad-gateway / 503 unavailable / 504 timeout — exactly the
  // codes you get from a load-balancer mid-Autopilot-eviction. 408
  // (request timeout) and 429 (throttle) are also retry-safe.
  return status === 408 || status === 429 || (status >= 500 && status < 600);
}

// 401 (unauthenticated) / 403 (unauthorized) are authoritative access denials,
// not outages — never serve a stale cached copy past one.
function isAuthDenial(status: number): boolean {
  return status === 401 || status === 403;
}

// Read an error response body without ever throwing: a missing/throwing
// `text()` (or a rejected read) must NOT escape and flip a non-retriable 4xx
// into the retry path. `try` (not `.catch`) so a synchronous throw is caught too.
async function readErrorBody(res: {
  text?: () => Promise<string>;
}): Promise<string> {
  try {
    return res.text ? await res.text() : "";
  } catch {
    return "";
  }
}

// Fold the server's error message into the detail for non-retriable (4xx)
// responses so callers surface the cause (e.g. "GitHub not configured")
// instead of a bare status line. Best-effort: tolerates non-JSON bodies.
function errorBodyDetail(
  status: number,
  statusText: string,
  body: string,
): string {
  const base = `HTTP ${status} ${statusText}`;

  if (!body) {
    return base;
  }

  try {
    const parsed = JSON.parse(body) as { error?: unknown };

    return typeof parsed.error === "string"
      ? `${base}: ${parsed.error}`
      : `${base}: ${body}`;
  } catch {
    return `${base}: ${body}`;
  }
}

export async function proxyToApi(
  endpoint: string,
  body: Record<string, unknown>,
): Promise<ProxyResult> {
  const apiUrl = process.env.LORE_API_URL;
  const apiToken = process.env.LORE_INGEST_TOKEN;

  if (!apiUrl || !apiToken) {
    return { ok: false, reason: "not_configured" };
  }

  let lastDetail = "no attempts made";

  for (let attempt = 0; attempt <= PROXY_RETRY_DELAYS_MS.length; attempt++) {
    try {
      const res = await fetch(`${apiUrl}${endpoint}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });

      if (res.ok) {
        return { ok: true, body: JSON.stringify(await res.json()) };
      }
      lastDetail = `HTTP ${res.status} ${res.statusText}`;

      if (isAuthDenial(res.status)) {
        console.error(`[lore-mcp] proxy ${endpoint} denied (${lastDetail})`);

        return { ok: false, reason: "denied", detail: lastDetail };
      }

      if (!isRetriableStatus(res.status)) {
        // 4xx (validation / config gap) — retrying won't help. Surface the
        // server's message so the caller sees the cause, not just the status,
        // and carry the status + body so a caller can recognise an
        // authoritative refusal instead of reporting it as an outage.
        const errorBody = await readErrorBody(res);
        const detail = errorBodyDetail(res.status, res.statusText, errorBody);

        console.error(
          `[lore-mcp] proxy ${endpoint} failed (${detail}); not retrying`,
        );

        return {
          ok: false,
          reason: "unreachable",
          detail,
          status: res.status,
          body: errorBody,
        };
      }
    } catch (err) {
      lastDetail =
        (err as { name?: string })?.name === "TimeoutError"
          ? "request timed out (15s)"
          : (err as { message?: string })?.message || String(err);
    }

    if (attempt < PROXY_RETRY_DELAYS_MS.length) {
      const delay = PROXY_RETRY_DELAYS_MS[attempt];

      console.error(
        `[lore-mcp] proxy ${endpoint} attempt ${attempt + 1} failed (${lastDetail}); retrying in ${delay}ms`,
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  console.error(
    `[lore-mcp] proxy ${endpoint} exhausted ${PROXY_RETRY_DELAYS_MS.length + 1} attempts; last error: ${lastDetail}`,
  );

  return { ok: false, reason: "unreachable", detail: lastDetail };
}

export function proxyMemory(
  action: string,
  params: Record<string, unknown>,
): Promise<ProxyResult> {
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
  if (!policy || !isCacheEnabled()) {
    return doProxy();
  }
  const label = opts.label ?? true;

  const fresh = readFresh(policy);

  if (fresh) {
    return {
      ok: true,
      body: label ? markFresh(fresh.body, fresh.ageSeconds) : fresh.body,
    };
  }

  const result = await doProxy();

  if (result.ok) {
    if (!opts.cacheIf || opts.cacheIf(result.body)) {
      store(policy, result.body);
    }

    return result;
  }

  if (result.reason === "unreachable") {
    const stale = readAny(policy);

    if (stale) {
      return {
        ok: true,
        body: label ? markStale(stale.body, stale.ageSeconds) : stale.body,
      };
    }
  }

  return result;
}

// GET sibling of proxyToApi for read-only routes (e.g. /trace/*). Same
// config gate, retry budget, and ProxyResult shape; no request body.
export async function proxyGetApi(path: string): Promise<ProxyResult> {
  const apiUrl = process.env.LORE_API_URL;
  const apiToken = process.env.LORE_INGEST_TOKEN;

  if (!apiUrl || !apiToken) {
    return { ok: false, reason: "not_configured" };
  }

  let lastDetail = "no attempts made";

  for (let attempt = 0; attempt <= PROXY_RETRY_DELAYS_MS.length; attempt++) {
    try {
      const res = await fetch(`${apiUrl}${path}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${apiToken}` },
        signal: AbortSignal.timeout(15_000),
      });

      if (res.ok) {
        return { ok: true, body: JSON.stringify(await res.json()) };
      }
      lastDetail = `HTTP ${res.status} ${res.statusText}`;

      if (isAuthDenial(res.status)) {
        console.error(`[lore-mcp] proxy GET ${path} denied (${lastDetail})`);

        return { ok: false, reason: "denied", detail: lastDetail };
      }

      if (!isRetriableStatus(res.status)) {
        // 4xx (validation / config gap) — retrying won't help. Surface the
        // server's message so the caller sees the cause, not just the status.
        const detail = errorBodyDetail(
          res.status,
          res.statusText,
          await readErrorBody(res),
        );

        console.error(
          `[lore-mcp] proxy GET ${path} failed (${detail}); not retrying`,
        );

        return { ok: false, reason: "unreachable", detail };
      }
    } catch (err) {
      lastDetail =
        (err as { name?: string })?.name === "TimeoutError"
          ? "request timed out (15s)"
          : (err as { message?: string })?.message || String(err);
    }

    if (attempt < PROXY_RETRY_DELAYS_MS.length) {
      const delay = PROXY_RETRY_DELAYS_MS[attempt];

      console.error(
        `[lore-mcp] proxy GET ${path} attempt ${attempt + 1} failed (${lastDetail}); retrying in ${delay}ms`,
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  console.error(
    `[lore-mcp] proxy GET ${path} exhausted ${PROXY_RETRY_DELAYS_MS.length + 1} attempts; last error: ${lastDetail}`,
  );

  return { ok: false, reason: "unreachable", detail: lastDetail };
}

// Format an MCP error for an unreachable proxy. Surfaces the failure
// to the caller instead of silently writing to a local file (which
// would never sync to the org-wide DB).
export function unreachableError(
  op: string,
  detail: string,
): { content: [{ type: "text"; text: string }] } {
  return {
    content: [
      {
        type: "text" as const,
        text:
          `Lore API unreachable for ${op} after ${PROXY_RETRY_DELAYS_MS.length + 1} attempts: ${detail}. ` +
          `Refusing local-file fallback to prevent silent divergence from the org-wide DB. ` +
          `Check the GKE service (lore-api pods) and retry.`,
      },
    ],
  };
}

// Format an MCP error for a proxy access denial (401/403). Surfaces the
// denial instead of serving a stale cached copy or falling back to local
// state — the backend has authoritatively refused this read.
export function deniedError(
  op: string,
  detail: string,
): { content: [{ type: "text"; text: string }] } {
  return {
    content: [
      {
        type: "text" as const,
        text:
          `Lore API denied access for ${op}: ${detail}. ` +
          `Your token may be revoked, expired, or lack the required scope. ` +
          `Not serving a cached copy for a denied request. Re-authenticate and retry.`,
      },
    ],
  };
}

// Format an MCP error for a proxy call that cannot run because the API
// endpoint/token are not configured. Distinct from unreachable (env is set
// but the network failed) so the developer knows to configure rather than
// debug connectivity.
export function notConfiguredError(op: string): {
  content: [{ type: "text"; text: string }];
} {
  return {
    content: [
      {
        type: "text" as const,
        text:
          `Lore API not configured for ${op}: set LORE_API_URL + LORE_INGEST_TOKEN. ` +
          `Run install.sh or export them manually, then retry.`,
      },
    ],
  };
}

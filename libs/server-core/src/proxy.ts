/** API proxy client for local mode; tools proxy reads/writes to remote Lore API. */
import {
  isCacheEnabled,
  readFresh,
  readAny,
  store,
  markFresh,
  markStale,
  type ReadCachePolicy,
} from "./platform/proxy-cache.js";

// ProxyResult distinguishes not_configured/unreachable; denied (401/403) prevents stale-cache serve.
export type ProxyResult =
  | { ok: true; body: string }
  | { ok: false; reason: "not_configured" }
  | {
      ok: false;
      reason: "unreachable";
      detail: string;
      /** Set only for non-retriable HTTP to distinguish authoritative refusal from outage. */
      status?: number;
      /** That response's raw body, when it had one. */
      body?: string;
    }
  | { ok: false; reason: "denied"; detail: string };

export const PROXY_RETRY_DELAYS_MS = [200, 600, 1800]; // ~2.6s total budget before giving up

function isRetriableStatus(status: number): boolean {
  // 5xx + 408/429 are retriable; 4xx are not (4xx = config gap, not outage).
  return status === 408 || status === 429 || (status >= 500 && status < 600);
}

// 401/403 are authoritative denials, not outages; never serve stale copy past one.
function isAuthDenial(status: number): boolean {
  return status === 401 || status === 403;
}

// Reads error body without throwing; never flips non-retriable 4xx to retry path.
async function readErrorBody(res: {
  text?: () => Promise<string>;
}): Promise<string> {
  try {
    return res.text ? await res.text() : "";
  } catch {
    return "";
  }
}

// Folds server's error message into detail for non-retriable (4xx) responses; best-effort.
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

// A thrown fetch error (network failure, abort timeout) reduced to a retry detail string.
function describeFetchError(err: unknown): string {
  if ((err as { name?: string })?.name === "TimeoutError") {
    return "request timed out (15s)";
  }

  return (err as { message?: string })?.message || String(err);
}

type RequestOutcome =
  { done: true; result: ProxyResult } | { done: false; detail: string };

// One fetch attempt: ok body, an authoritative denial, a non-retriable refusal, or a retry signal.
async function attemptRequest(
  makeRequest: () => Promise<Response>,
  label: string,
  buildNonRetriableResult: (
    status: number,
    detail: string,
    errorBody: string,
  ) => ProxyResult,
): Promise<RequestOutcome> {
  try {
    const res = await makeRequest();

    if (res.ok) {
      return {
        done: true,
        result: { ok: true, body: JSON.stringify(await res.json()) },
      };
    }
    const statusDetail = `HTTP ${res.status} ${res.statusText}`;

    if (isAuthDenial(res.status)) {
      console.error(`[lore-mcp] ${label} denied (${statusDetail})`);

      return {
        done: true,
        result: { ok: false, reason: "denied", detail: statusDetail },
      };
    }

    if (isRetriableStatus(res.status)) {
      return { done: false, detail: statusDetail };
    }
    const errorBody = await readErrorBody(res);
    const detail = errorBodyDetail(res.status, res.statusText, errorBody);

    console.error(`[lore-mcp] ${label} failed (${detail}); not retrying`);

    return {
      done: true,
      result: buildNonRetriableResult(res.status, detail, errorBody),
    };
  } catch (err) {
    return { done: false, detail: describeFetchError(err) };
  }
}

// Shared retry loop behind proxyToApi/proxyGetApi: only the request + non-retriable-4xx shape differ.
async function requestWithRetry(
  makeRequest: () => Promise<Response>,
  label: string,
  buildNonRetriableResult: (
    status: number,
    detail: string,
    errorBody: string,
  ) => ProxyResult,
): Promise<ProxyResult> {
  let lastDetail = "no attempts made";

  for (let attempt = 0; attempt <= PROXY_RETRY_DELAYS_MS.length; attempt++) {
    const outcome = await attemptRequest(
      makeRequest,
      label,
      buildNonRetriableResult,
    );

    if (outcome.done) {
      return outcome.result;
    }
    lastDetail = outcome.detail;

    if (attempt < PROXY_RETRY_DELAYS_MS.length) {
      const delay = PROXY_RETRY_DELAYS_MS[attempt];

      console.error(
        `[lore-mcp] ${label} attempt ${attempt + 1} failed (${lastDetail}); retrying in ${delay}ms`,
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  console.error(
    `[lore-mcp] ${label} exhausted ${PROXY_RETRY_DELAYS_MS.length + 1} attempts; last error: ${lastDetail}`,
  );

  return { ok: false, reason: "unreachable", detail: lastDetail };
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

  return requestWithRetry(
    () =>
      fetch(`${apiUrl}${endpoint}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      }),
    `proxy ${endpoint}`,
    // Non-retriable 4xx: surface server message + status/body so caller recognizes refusal.
    (status, detail, errorBody) => ({
      ok: false,
      reason: "unreachable",
      detail,
      status,
      body: errorBody,
    }),
  );
}

export function proxyMemory(
  action: string,
  params: Record<string, unknown>,
): Promise<ProxyResult> {
  return proxyToApi("/api/memory", { action, ...params });
}

function storeWhenCacheable(
  policy: ReadCachePolicy,
  body: string,
  cacheIf?: (body: string) => boolean,
): void {
  if (cacheIf && !cacheIf(body)) {
    return;
  }
  store(policy, body);
}

function serveFresh(
  fresh: { body: string; ageSeconds: number },
  label: boolean,
): ProxyResult {
  return {
    ok: true,
    body: label ? markFresh(fresh.body, fresh.ageSeconds) : fresh.body,
  };
}

function readFreshHit(
  policy: ReadCachePolicy,
  label: boolean,
): ProxyResult | null {
  const fresh = readFresh(policy);

  return fresh ? serveFresh(fresh, label) : null;
}

type ReadCacheOpts = { label?: boolean; cacheIf?: (body: string) => boolean };

function resolveReadCacheOpts(
  opts: ReadCacheOpts | undefined,
): Required<Pick<ReadCacheOpts, "label">> & Pick<ReadCacheOpts, "cacheIf"> {
  return { label: opts?.label !== false, cacheIf: opts?.cacheIf };
}

// Falls back to a stale cached copy only for a genuine "unreachable" outcome; denials pass through.
function serveStaleFallback(
  policy: ReadCachePolicy,
  result: Extract<ProxyResult, { ok: false }>,
  label: boolean,
): ProxyResult {
  if (result.reason !== "unreachable") {
    return result;
  }
  const stale = readAny(policy);

  if (!stale) {
    return result;
  }

  return {
    ok: true,
    body: label ? markStale(stale.body, stale.ageSeconds) : stale.body,
  };
}

// Cache wrapper for proxied reads; fresh hit short-circuits network; stale on unreachable.
export async function withReadCache(
  policy: ReadCachePolicy | undefined,
  doProxy: () => Promise<ProxyResult>,
  opts?: ReadCacheOpts,
): Promise<ProxyResult> {
  if (!policy || !isCacheEnabled()) {
    return doProxy();
  }
  const { label, cacheIf } = resolveReadCacheOpts(opts);
  const hit = readFreshHit(policy, label);

  if (hit) {
    return hit;
  }

  const result = await doProxy();

  if (result.ok) {
    storeWhenCacheable(policy, result.body, cacheIf);

    return result;
  }

  return serveStaleFallback(policy, result, label);
}

// GET sibling of proxyToApi for read-only routes; same gate/budget/shape, no body.
export async function proxyGetApi(path: string): Promise<ProxyResult> {
  const apiUrl = process.env.LORE_API_URL;
  const apiToken = process.env.LORE_INGEST_TOKEN;

  if (!apiUrl || !apiToken) {
    return { ok: false, reason: "not_configured" };
  }

  return requestWithRetry(
    () =>
      fetch(`${apiUrl}${path}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${apiToken}` },
        signal: AbortSignal.timeout(15_000),
      }),
    `proxy GET ${path}`,
    // Non-retriable 4xx: surface server's message to caller (no status/body carried for GET).
    (_status, detail) => ({ ok: false, reason: "unreachable", detail }),
  );
}

// Format MCP error for unreachable proxy; surfaces failure instead of silent fallback.
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

// Format MCP error for proxy access denial (401/403); surfaces refusal instead of stale/local fallback.
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

/** The MCP content envelope every tool answers in. One place to build it, so a tool returns text rather than assembling a protocol shape. */
export function textResult(text: string): {
  content: [{ type: "text"; text: string }];
} {
  return { content: [{ type: "text" as const, text }] };
}

// Format MCP error for unconfigured API endpoint/token; distinct from unreachable.
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

/** The HTTP retry engine behind proxy.ts's proxyToApi/proxyGetApi: classifies a response as ok/denied/non-retriable/retriable and drives the backoff loop. */
import type { ProxyResult } from "./proxy.js";

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
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- err is unknown; `as` trusts the shape unconditionally, but a thrown value can genuinely be null/undefined
  if ((err as { name?: string })?.name === "TimeoutError") {
    return "request timed out (15s)";
  }

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- err is unknown; `as` trusts the shape unconditionally, but a thrown value can genuinely be null/undefined
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
export async function requestWithRetry(
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

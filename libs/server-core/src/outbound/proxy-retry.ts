/** The HTTP retry engine behind proxy.ts's proxyToApi/proxyGetApi: classifies a response as ok/denied/non-retriable/retriable and drives the backoff loop. */
import type { ProxyResult } from "./proxy.js";

export const PROXY_RETRY_DELAYS_MS = [200, 600, 1800]; // ~2.6s total budget before giving up

type RequestOutcome =
  { done: true; result: ProxyResult } | { done: false; detail: string };

/** A request and how to describe it when it fails — one shape, because attempt/classify/retry all need the same three. */
interface Attempt {
  makeRequest: () => Promise<Response>;
  label: string;
  buildNonRetriableResult: (
    status: number,
    detail: string,
    errorBody: string,
  ) => ProxyResult;
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
  const attempt: Attempt = { makeRequest, label, buildNonRetriableResult };
  const outcome = await retryLoop(attempt);

  return outcome.done ? outcome.result : exhausted(label, outcome.detail);
}

// Attempts until one settles or the delays run out. The backoff sits BETWEEN attempts, never after the last — waiting once more before reporting exhaustion would delay the answer without buying another try.
async function retryLoop(attempt: Attempt): Promise<RequestOutcome> {
  let lastDetail = "no attempts made";

  for (let n = 0; n <= PROXY_RETRY_DELAYS_MS.length; n++) {
    const outcome = await attemptRequest(attempt);

    if (outcome.done) {
      return outcome;
    }
    lastDetail = outcome.detail;

    if (n < PROXY_RETRY_DELAYS_MS.length) {
      await backoff(n, attempt.label, lastDetail);
    }
  }

  return { done: false, detail: lastDetail };
}

// Every attempt is spent. Reports the LAST failure rather than the first: it is the one that was true when the caller gave up, and the earlier ones were already logged as they happened.
function exhausted(label: string, lastDetail: string): ProxyResult {
  console.error(
    `[lore-mcp] ${label} exhausted ${PROXY_RETRY_DELAYS_MS.length + 1} attempts; last error: ${lastDetail}`,
  );

  return { ok: false, reason: "unreachable", detail: lastDetail };
}

// One fetch attempt: ok body, an authoritative denial, a non-retriable refusal, or a retry signal.
async function attemptRequest(attempt: Attempt): Promise<RequestOutcome> {
  try {
    const res = await attempt.makeRequest();

    if (res.ok) {
      return {
        done: true,
        result: { ok: true, body: JSON.stringify(await res.json()) },
      };
    }

    return await classifyFailure(res, attempt);
  } catch (err) {
    // A thrown fetch is always worth another attempt: it never reached a status, so nothing has told us the request is unacceptable.
    return { done: false, detail: describeFetchError(err) };
  }
}

/** Waits out one backoff step, announcing the failure that caused it — the log line belongs here so a caller reading the loop sees only the decision. */
async function backoff(
  attempt: number,
  label: string,
  detail: string,
): Promise<void> {
  const delay = PROXY_RETRY_DELAYS_MS[attempt];

  console.error(
    `[lore-mcp] ${label} attempt ${attempt + 1} failed (${detail}); retrying in ${delay}ms`,
  );
  await new Promise((r) => setTimeout(r, delay));
}

/** A non-ok response is one of three answers, and only the middle one is worth another attempt. */
async function classifyFailure(
  res: Response,
  attempt: Attempt,
): Promise<RequestOutcome> {
  const statusDetail = `HTTP ${res.status} ${res.statusText}`;

  if (isAuthDenial(res.status)) {
    return denialOutcome(attempt.label, statusDetail);
  }

  if (isRetriableStatus(res.status)) {
    return { done: false, detail: statusDetail };
  }
  const errorBody = await readErrorBody(res);
  const detail = errorBodyDetail(res.status, res.statusText, errorBody);

  console.error(`[lore-mcp] ${attempt.label} failed (${detail}); not retrying`);

  return {
    done: true,
    result: attempt.buildNonRetriableResult(res.status, detail, errorBody),
  };
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

// 401/403 are authoritative denials, not outages; never serve stale copy past one.
function isAuthDenial(status: number): boolean {
  return status === 401 || status === 403;
}

// A credential the API will not accept. Terminal rather than retriable: the token is wrong, and trying again with the same one only spends attempts.
function denialOutcome(label: string, statusDetail: string): RequestOutcome {
  console.error(`[lore-mcp] ${label} denied (${statusDetail})`);

  return {
    done: true,
    result: { ok: false, reason: "denied", detail: statusDetail },
  };
}

function isRetriableStatus(status: number): boolean {
  // 5xx + 408/429 are retriable; 4xx are not (4xx = config gap, not outage).
  return status === 408 || status === 429 || (status >= 500 && status < 600);
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

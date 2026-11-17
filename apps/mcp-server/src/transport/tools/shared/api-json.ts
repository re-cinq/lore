import {
  deniedError,
  textResult,
  unreachableError,
  type ProxyResult,
} from "./deps.js";
import {
  type ToolText,
  isAuthDenied,
} from "../pipeline/shared/pipeline-api.js";

/** One authenticated call, classified into ok/denied/unreachable; with a body it is a POST. */
export async function fetchApiJson(
  url: string,
  apiToken: string,
  body?: unknown,
): Promise<ProxyResult> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(30_000),
    ...requestInit(apiToken, body),
  });

  if (res.ok) {
    return { ok: true, body: JSON.stringify(await res.json()) };
  }

  return body === undefined ? readFailure(res) : writeFailure(res);
}

function requestInit(apiToken: string, body: unknown): RequestInit {
  const authorization = { Authorization: `Bearer ${apiToken}` };

  if (body === undefined) {
    return { headers: authorization };
  }

  return {
    method: "POST",
    headers: { ...authorization, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

function readFailure(res: Response): ProxyResult {
  const detail = `HTTP ${res.status} ${res.statusText}`;

  if (isAuthDenied(res.status)) {
    return { ok: false, reason: "denied", detail };
  }

  return { ok: false, reason: "unreachable", detail };
}

async function writeFailure(res: Response): Promise<ProxyResult> {
  if (isAuthDenied(res.status) || res.status >= 500) {
    return readFailure(res);
  }
  const detail = `HTTP ${res.status} ${res.statusText}: ${await refusalReason(res)}`;

  return { ok: false, reason: "unreachable", detail, status: res.status };
}

// A POST the API refuses (400, 404, 409) carries its reason in the body; a GET's caller only needs the status.
async function refusalReason(res: Response): Promise<string> {
  const answer = (await res.json().catch(() => null)) as {
    message?: string;
  } | null;

  return answer?.message ?? "no reason given";
}

/** fetchApiJson never yields not_configured: callers return early on missing credentials, so it reads as unreachable here. */
export function proxiedJsonText(
  toolName: string,
  proxied: ProxyResult,
): ToolText {
  if (proxied.ok) {
    return textResult(proxied.body);
  }

  if (proxied.reason === "denied") {
    return deniedError(toolName, proxied.detail);
  }

  if (proxied.reason === "unreachable" && proxied.status) {
    return textResult(`The Lore API refused ${toolName}: ${proxied.detail}`);
  }

  return unreachableError(
    toolName,
    proxied.reason === "unreachable" ? proxied.detail : "not configured",
  );
}

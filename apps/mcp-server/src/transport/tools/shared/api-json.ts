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

/** One authenticated GET, classified into ok/denied/unreachable. */
export async function fetchApiJson(
  url: string,
  apiToken: string,
): Promise<ProxyResult> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(30_000),
    headers: { Authorization: `Bearer ${apiToken}` },
  });

  if (res.ok) {
    return { ok: true, body: JSON.stringify(await res.json()) };
  }
  const detail = `HTTP ${res.status} ${res.statusText}`;

  if (isAuthDenied(res.status)) {
    return { ok: false, reason: "denied", detail };
  }

  return { ok: false, reason: "unreachable", detail };
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

  return unreachableError(
    toolName,
    proxied.reason === "unreachable" ? proxied.detail : "not configured",
  );
}

import {
  withReadCache,
  unreachableError,
  deniedError,
  textResult,
  type ProxyResult,
} from "../../shared/deps.js";
import {
  type ToolText,
  isAuthDenied,
  resolveApiCredentials,
} from "./pipeline-api.js";

/** Both log reads are the same read: logs live server-side, so with no API there is nothing to fall back to. Cached for a DAY but only once `complete` — a still-running task's partial transcript must never be served as its final one. */
export async function cachedLogRead(read: {
  tool: string;
  missing: string;
  path: (apiUrl: string) => string;
  args: Record<string, unknown>;
}) {
  const creds = resolveApiCredentials();

  if (!creds) {
    return textResult(read.missing);
  }
  const proxied = await withReadCache(
    { tool: read.tool, args: read.args, ttlSeconds: 86400 },
    () => fetchLogsResult(read.path(creds.apiUrl), creds.token),
    { label: false, cacheIf: completeOnly },
  );

  return interpretLogsProxy(read.tool, proxied);
}

/** fetchLogsResult only ever produces ok/denied/unreachable, but the shared ProxyResult type also carries not_configured — treated the same as unreachable here since the caller already returned early on missing credentials. */
function interpretLogsProxy(toolName: string, proxied: ProxyResult): ToolText {
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

/** One fetch, classified into ok/denied/unreachable — the shape both log tools' `withReadCache` closures need. */
async function fetchLogsResult(
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

function completeOnly(body: string): boolean {
  try {
    return (JSON.parse(body) as { complete?: boolean }).complete === true;
  } catch {
    return false;
  }
}

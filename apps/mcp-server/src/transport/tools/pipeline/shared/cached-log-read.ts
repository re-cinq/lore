import { withReadCache, textResult } from "../../shared/deps.js";
import { fetchApiJson, proxiedJsonText } from "../../shared/api-json.js";
import { resolveApiCredentials } from "./pipeline-api.js";

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
    () => fetchApiJson(read.path(creds.apiUrl), creds.token),
    { label: false, cacheIf: completeOnly },
  );

  return proxiedJsonText(read.tool, proxied);
}

function completeOnly(body: string): boolean {
  try {
    return (JSON.parse(body) as { complete?: boolean }).complete === true;
  } catch {
    return false;
  }
}

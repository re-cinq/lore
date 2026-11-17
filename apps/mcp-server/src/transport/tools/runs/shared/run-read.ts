import { errorMessage } from "@re-cinq/lore-shared";
import {
  textResult,
  withReadCache,
  type ProxyResult,
} from "../../shared/deps.js";
import { fetchApiJson, proxiedJsonText } from "../../shared/api-json.js";
import {
  resolveApiCredentials,
  type ToolText,
} from "../../pipeline/shared/pipeline-api.js";

export const RUNS_NEED_API = "Assembly-line runs require LORE_API_URL.";

export type ApiGet = (path: string) => Promise<ProxyResult>;

export interface RunRead {
  tool: string;
  op: string;
  load: (get: ApiGet) => Promise<ProxyResult>;
  /** Only for content that never changes once written, such as a blob. */
  cache?: { args: Record<string, unknown>; ttlSeconds: number };
}

export async function readRun(read: RunRead): Promise<ToolText> {
  const creds = resolveApiCredentials();

  if (!creds) {
    return textResult(RUNS_NEED_API);
  }
  const get: ApiGet = (path) =>
    fetchApiJson(`${creds.apiUrl}${path}`, creds.token);

  try {
    const proxied = await withReadCache(
      read.cache && { tool: read.tool, ...read.cache },
      () => read.load(get),
      { label: false },
    );

    return proxiedJsonText(read.tool, proxied);
  } catch (err) {
    return textResult(`Error ${read.op}: ${errorMessage(err)}`);
  }
}

export function runPath(runId: string, suffix = ""): string {
  return `/api/assembly-runs/${encodeURIComponent(runId)}${suffix}`;
}

export function queryString(
  params: Record<string, string | number | undefined>,
): string {
  const present = Object.entries(params).filter(
    ([, value]) => value !== undefined,
  );

  return present.length
    ? `?${new URLSearchParams(present.map(([key, value]) => [key, String(value)]))}`
    : "";
}

export function partError(result: Extract<ProxyResult, { ok: false }>): {
  error: string;
} {
  return {
    error: result.reason === "not_configured" ? result.reason : result.detail,
  };
}

// A failed optional part becomes {error}: a run Lore's own engine walked has no DoD or bag on the floor.
export async function readParts(
  get: ApiGet,
  parts: {
    required: Record<string, string>;
    optional?: Record<string, string>;
  },
): Promise<ProxyResult> {
  const required = Object.keys(parts.required);
  const all = Object.entries({ ...parts.required, ...parts.optional });
  const results = await Promise.all(all.map(([, path]) => get(path)));
  const requiredFailure = results.find(
    (result, index) => !result.ok && index < required.length,
  );

  if (requiredFailure) {
    return requiredFailure;
  }
  const merged = all.map(([key], index) => [key, partValue(results[index])]);

  return { ok: true, body: JSON.stringify(Object.fromEntries(merged)) };
}

function partValue(result: ProxyResult): unknown {
  return result.ok ? JSON.parse(result.body) : partError(result);
}

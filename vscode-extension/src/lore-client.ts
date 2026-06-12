/**
 * Read-only HTTP client for the Lore trace API. Mirrors the bearer-auth + retry
 * shape of the MCP server's proxyGetApi (mcp-server/src/mcp/tools/deps.ts):
 * 15s timeout, retry on 408/429/5xx. The extension is the first standalone
 * consumer of this surface.
 */

import type { SpecGraph, TraceDocument } from "@re-cinq/lore-shared";

const RETRY_DELAYS_MS = [200, 600, 1800];

function isRetriable(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status < 600);
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class LoreClient {
  constructor(
    private readonly apiUrl: string,
    private readonly token: string,
  ) {}

  /** The repo's spec force-graph — the "graph request to the remote server". */
  graph(repo: string): Promise<SpecGraph> {
    return this.get<SpecGraph>(`/api/repos/${repo}/trace/graph`);
  }

  specs(repo: string): Promise<{ specs: string[] }> {
    return this.get<{ specs: string[] }>(`/api/repos/${repo}/trace/specs`);
  }

  document(repo: string, path: string): Promise<TraceDocument> {
    return this.get<TraceDocument>(`/api/repos/${repo}/trace/document?path=${encodeURIComponent(path)}`);
  }

  private async get<T>(path: string): Promise<T> {
    let lastError = "no attempts made";
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      try {
        const res = await fetch(`${this.apiUrl}${path}`, {
          headers: { Authorization: `Bearer ${this.token}` },
          signal: AbortSignal.timeout(15_000),
        });
        if (res.ok) return (await res.json()) as T;
        lastError = `HTTP ${res.status} ${res.statusText}`;
        if (!isRetriable(res.status)) break;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      }
      if (attempt < RETRY_DELAYS_MS.length) await delay(RETRY_DELAYS_MS[attempt]);
    }
    throw new Error(`Lore API GET ${path} failed: ${lastError}`);
  }
}

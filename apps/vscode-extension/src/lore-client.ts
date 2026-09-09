// Mirrors mcp-server's proxyGetApi bearer-auth+retry shape (15s timeout, retry on 408/429/5xx).

import type { SpecGraph, TraceDocument } from "@re-cinq/lore-shared";

const RETRY_DELAYS_MS = [200, 600, 1800];

function isRetriable(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status < 600);
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type AttemptResult<T> =
  { ok: true; value: T } | { ok: false; error: string; retriable: boolean };

function toNetworkErrorResult(err: unknown): AttemptResult<never> {
  return {
    ok: false,
    error: err instanceof Error ? err.message : String(err),
    retriable: true,
  };
}

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
    return this.get<TraceDocument>(
      `/api/repos/${repo}/trace/document?path=${encodeURIComponent(path)}`,
    );
  }

  private async fetchOnce<T>(path: string): Promise<AttemptResult<T>> {
    try {
      const res = await fetch(`${this.apiUrl}${path}`, {
        headers: { Authorization: `Bearer ${this.token}` },
        signal: AbortSignal.timeout(15_000),
      });

      if (res.ok) {
        return { ok: true, value: (await res.json()) as T };
      }

      return {
        ok: false,
        error: `HTTP ${res.status} ${res.statusText}`,
        retriable: isRetriable(res.status),
      };
    } catch (err) {
      return toNetworkErrorResult(err);
    }
  }

  private async get<T>(path: string): Promise<T> {
    let lastError = "no attempts made";

    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      const result = await this.fetchOnce<T>(path);

      if (result.ok) {
        return result.value;
      }
      lastError = result.error;

      if (!result.retriable) {
        break;
      }

      if (attempt < RETRY_DELAYS_MS.length) {
        await delay(RETRY_DELAYS_MS[attempt]);
      }
    }
    throw new Error(`Lore API GET ${path} failed: ${lastError}`);
  }
}

// Mirrors mcp-server's proxyGetApi bearer-auth+retry shape (15s timeout, retry on 408/429/5xx).

import type { SpecGraph, TraceDocument } from "@re-cinq/lore-shared";

const RETRY_DELAYS_MS = [200, 600, 1800];

async function toAttemptResult<T>(res: Response): Promise<AttemptResult<T>> {
  if (res.ok) {
    return { ok: true, value: (await res.json()) as T };
  }

  return {
    ok: false,
    error: `HTTP ${res.status} ${res.statusText}`,
    retriable: isRetriable(res.status),
  };
}

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

/** The selected lines of one file, as the explain route takes them. */
export interface ExplainSpan {
  path: string;
  start_line: number;
  end_line: number;
  code: string;
}

export interface Explanation {
  answer: string;
  statements: { text: string; via: "validated" | "implemented" | "covered" }[];
  model: string | null;
}

interface RequestOptions {
  init?: RequestInit;
  timeoutMs?: number;
}

export class LoreClient {
  constructor(
    private readonly apiUrl: string,
    private readonly token: string,
    private readonly retryDelaysMs: readonly number[] = RETRY_DELAYS_MS,
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

  /** What the selected code does, grounded in the spec statements linked to it; the model can take longer than a graph read. */
  explain(repo: string, span: ExplainSpan): Promise<Explanation> {
    return this.request<Explanation>(`/api/repos/${repo}/explain`, {
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(span),
      },
      timeoutMs: 60_000,
    });
  }

  private async fetchOnce<T>(
    path: string,
    { init = {}, timeoutMs = 15_000 }: RequestOptions,
  ): Promise<AttemptResult<T>> {
    try {
      const res = await fetch(`${this.apiUrl}${path}`, {
        ...init,
        headers: { ...init.headers, Authorization: `Bearer ${this.token}` },
        signal: AbortSignal.timeout(timeoutMs),
      });

      return await toAttemptResult<T>(res);
    } catch (err) {
      return toNetworkErrorResult(err);
    }
  }

  private get<T>(path: string): Promise<T> {
    return this.request<T>(path, {});
  }

  private async request<T>(path: string, options: RequestOptions): Promise<T> {
    let lastError = "no attempts made";

    for (let attempt = 0; attempt <= this.retryDelaysMs.length; attempt++) {
      const result = await this.fetchOnce<T>(path, options);

      if (result.ok) {
        return result.value;
      }
      lastError = result.error;

      if (!result.retriable) {
        break;
      }

      if (attempt < this.retryDelaysMs.length) {
        await delay(this.retryDelaysMs[attempt]);
      }
    }
    throw new Error(
      `Lore API ${methodOf(options)} ${path} failed: ${lastError}`,
    );
  }
}

function methodOf(options: RequestOptions): string {
  return options.init?.method ?? "GET";
}

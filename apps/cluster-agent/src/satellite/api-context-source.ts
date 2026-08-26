/**
 * ContextSource over the Lore API's `/api/context`, mirroring the Floor's
 * HttpContextSource request shape (repo + template + query + max_tokens, bearer
 * auth) so a claimed run starts warm exactly like a pushed one.
 *
 * Best-effort by contract: any failure returns undefined and the agent runs
 * cold — but logged, since a silently cold agent only shows up as degraded
 * output.
 *
 * Satellite limitation: this source needs LORE_INGEST_TOKEN, which never leaves
 * the central cluster (FR5). A satellite therefore wires NO ContextSource and
 * its runs launch unhydrated — agent pods still reach live context through the
 * lore-mcp gateway mid-run.
 */

import { errorMessage } from "@re-cinq/lore-shared";
import type { LoreTaskSpec } from "@re-cinq/lore-shared";
import type { ContextSource } from "@re-cinq/lore-shared/cluster/agent-backend.js";

const FETCH_TIMEOUT_MS = 15_000;

export class ApiContextSource implements ContextSource {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async assemble(spec: LoreTaskSpec): Promise<string | undefined> {
    const template = spec.taskType === "review" ? "review" : "implementation";
    const query = (spec.description ?? "").slice(0, 200);
    const url =
      `${this.baseUrl}/api/context?repo=${encodeURIComponent(spec.targetRepo)}` +
      `&template=${template}&query=${encodeURIComponent(query)}&max_tokens=8000`;

    try {
      const res = await this.fetchFn(url, {
        headers: { authorization: `Bearer ${this.token}` },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });

      if (!res.ok) {
        console.warn(
          `[cluster-agent] context assembly failed for ${spec.targetRepo} (HTTP ${res.status}); agent runs cold`,
        );

        return undefined;
      }
      const data = (await res.json()) as { text?: string };

      if (!data.text?.trim()) {
        console.warn(
          `[cluster-agent] context assembly returned no text for ${spec.targetRepo}; agent runs cold`,
        );

        return undefined;
      }

      return data.text;
    } catch (err) {
      console.warn(
        `[cluster-agent] context assembly fetch failed for ${spec.targetRepo}: ${errorMessage(err)}; agent runs cold`,
      );

      return undefined;
    }
  }
}

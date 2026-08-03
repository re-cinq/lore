// Live ContextSource (ADR-031 D5): fetches assembled Lore context from the
// context-assembly API (the same /api/context the runner used) so a dispatched
// Agent starts warm. Returns undefined (agent runs cold) on any failure or when
// the API is unconfigured, so hydration is best-effort — but failures are logged,
// since a silently cold agent only shows up as degraded output (#1026).

import { errorMessage } from "@re-cinq/lore-shared";
import type { LoreTaskSpec } from "@re-cinq/lore-shared";
import type { ContextSource } from "./agent-backend.js";

const FETCH_TIMEOUT_MS = 15_000;

export class HttpContextSource implements ContextSource {
  async assemble(spec: LoreTaskSpec): Promise<string | undefined> {
    const base = process.env.LORE_INGEST_URL;

    if (!base) {
      return undefined;
    }
    const token = process.env.LORE_INGEST_TOKEN;
    const template = spec.taskType === "review" ? "review" : "implementation";
    const query = (spec.description ?? "").slice(0, 200);
    const url =
      `${base}/api/context?repo=${encodeURIComponent(spec.targetRepo)}` +
      `&template=${template}&query=${encodeURIComponent(query)}&max_tokens=8000`;

    try {
      const res = await fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });

      if (!res.ok) {
        console.warn(
          `[floor] context assembly failed for ${spec.targetRepo} (HTTP ${res.status}); agent runs cold. query=${JSON.stringify(query)}`,
        );

        return undefined;
      }
      const data = (await res.json()) as { text?: string };

      if (!data.text) {
        console.warn(
          `[floor] context assembly returned no text for ${spec.targetRepo}; agent runs cold. query=${JSON.stringify(query)}`,
        );

        return undefined;
      }

      return data.text;
    } catch (err) {
      console.warn(
        `[floor] context assembly fetch failed for ${spec.targetRepo}: ${errorMessage(err)}; agent runs cold. query=${JSON.stringify(query)}`,
      );

      return undefined;
    }
  }
}

// Live ContextSource (ADR-031 D5): fetches assembled Lore context from the
// context-assembly API (the same /api/context the runner used) so a dispatched
// Agent starts warm. Thin IO seam — excluded from coverage; the parameter injection
// it feeds is tested in agent-backend. Returns undefined (agent runs cold) on any
// failure or when the API is unconfigured, so hydration is best-effort.

import type { LoreTaskSpec } from "@re-cinq/lore-shared";
import type { ContextSource } from "./agent-backend.js";

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
      });

      if (!res.ok) {
        return undefined;
      }
      const data = (await res.json()) as { text?: string };

      return data.text || undefined;
    } catch {
      return undefined;
    }
  }
}

import type { IncomingMessage, ServerResponse } from "node:http";
import type { Pool } from "pg";
import { createDgraphClient } from "@re-cinq/lore-shared";
import { assembleContext } from "../../features/context/context-assembly.js";
import { resolveCrossRepo } from "../../features/context/cross-repo.js";
import { json } from "./http.js";

export async function handleContext(req: IncomingMessage, res: ServerResponse, pool: Pool | null): Promise<void> {
  const url = new URL(req.url!, "http://localhost");
  const repo = url.searchParams.get("repo");
  const query = url.searchParams.get("query");
  const template = url.searchParams.get("template") || "default";
  const debug = url.searchParams.get("debug") === "1" || url.searchParams.get("debug") === "true";
  // Honor the optional knobs the MCP tool forwards. Absent/invalid max_tokens
  // keeps the documented 8000 default (the template default must not silently
  // raise it). agent_id scopes memories/facts; cross_repo falls back to the
  // repo's settings flag when not explicitly requested.
  const rawMaxTokens = Number(url.searchParams.get("max_tokens"));
  const maxTokens = Number.isFinite(rawMaxTokens) && rawMaxTokens > 0 ? rawMaxTokens : 8000;
  const agentId = url.searchParams.get("agent_id") || undefined;
  const crossRepoRequested = url.searchParams.get("cross_repo") === "true";
  try {
    if (query && pool) {
      // Fail-soft: null when LORE_DGRAPH_HTTP is unset, so the coupling source
      // degrades to an empty section.
      const dgraph = createDgraphClient(process.env);
      const crossRepo = await resolveCrossRepo(pool, repo || undefined, crossRepoRequested);
      const result = await assembleContext(pool, query, template, maxTokens, repo || undefined, agentId, crossRepo, undefined, debug, dgraph);
      json(res, 200, { text: result.text || null, sections: result.sections, trace: result.trace });
    } else {
      const parts: string[] = [];
      if (repo && pool) {
        const { rows } = await pool.query(
          `SELECT content, content_type, file_path FROM org_shared.chunks
           WHERE repo = $1 AND content_type IN ('doc', 'adr', 'spec')
           ORDER BY content_type, ingested_at DESC`,
          [repo],
        );
        for (const r of rows) parts.push(r.content);
      }
      json(res, 200, { text: parts.length > 0 ? parts.join("\n\n---\n\n") : null });
    }
  } catch (err: any) {
    json(res, 500, { error: err.message });
  }
}

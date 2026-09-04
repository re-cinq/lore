import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "../../../server/api-error.js";
import type { Pool } from "pg";
import type { ServerRoute } from "@hapi/hapi";
import { zodResponse } from "../../../server/plugins/zod-response.js";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";
import { zodValidate } from "../../../server/plugins/zod-validate.js";
import { DB_UNAVAILABLE } from "../common-schemas.js";
import {
  MemorySearchQuery,
  MemoriesQuery,
  MemorySearchSchema,
  MemoryListSchema,
} from "./memory-browse-schemas.js";

// Lexical + listing reads over memories/facts — the search-and-list half of memory browse.

export function memorySearchRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "GET",
    path: "/api/memory-search",
    options: zodResponse(
      {
        ...bearerScope("read"),
        validate: { query: zodValidate(MemorySearchQuery) },
      },
      MemorySearchSchema,
      {
        name: "MemorySearchResults",
        description: "Ranked memories and facts",
      },
    ),
    handler: async (request, h) => {
      const pool = getPool();

      enforceTrue(pool, apiError(503), DB_UNAVAILABLE);
      const { q } = request.query as unknown as MemorySearchQuery;

      // Lexical (ts_rank), not semantic — embedding search is `lore_search_memory` via POST /api/memory.
      const { rows: memories } = await pool.query(
        `SELECT key, substring(value, 1, 300) as value, agent_id,
                ts_rank(to_tsvector('english', value), plainto_tsquery($1)) as score,
                'memory' as source,
                NULL as repo
           FROM memory.memories
          WHERE is_deleted = FALSE
            AND (expires_at IS NULL OR expires_at > now())
            AND to_tsvector('english', value) @@ plainto_tsquery($1)
          ORDER BY score DESC
          LIMIT 20`,
        [q],
      );
      // Excludes invalidated facts — a superseded belief must not surface as current.
      const { rows: facts } = await pool.query(
        `SELECT COALESCE(m.key, e.source || ':' || COALESCE(e.ref, e.id::text)) as key,
                substring(f.fact_text, 1, 300) as value,
                COALESCE(m.agent_id, e.agent_id) as agent_id,
                ts_rank(to_tsvector('english', f.fact_text), plainto_tsquery($1)) as score,
                CASE WHEN f.episode_id IS NOT NULL THEN 'episode' ELSE 'fact' END as source,
                NULL as repo
           FROM memory.facts f
           LEFT JOIN memory.memories m ON m.id = f.memory_id
           LEFT JOIN memory.episodes e ON e.id = f.episode_id
          WHERE (m.id IS NULL OR (m.is_deleted = FALSE AND (m.expires_at IS NULL OR m.expires_at > now())))
            AND f.valid_to IS NULL
            AND to_tsvector('english', f.fact_text) @@ plainto_tsquery($1)
          ORDER BY score DESC
          LIMIT 20`,
        [q],
      );

      return h.response({ results: [...memories, ...facts] });
    },
  };
}

export function listMemoriesRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "GET",
    path: "/api/memories",
    options: zodResponse(
      {
        ...bearerScope("read"),
        validate: { query: zodValidate(MemoriesQuery) },
      },
      MemoryListSchema,
      {
        name: "MemoryList",
        description: "An agent's memories with versions and facts",
      },
    ),
    handler: async (request, h) => {
      const pool = getPool();

      enforceTrue(pool, apiError(503), DB_UNAVAILABLE);
      const { agent, limit } = request.query as unknown as MemoriesQuery;

      const { rows: memories } = await pool.query<{
        id: string;
        has_facts: boolean;
      }>(
        `SELECT m.id, m.key, m.value, m.version, m.created_at, m.ttl_seconds,
                EXISTS(SELECT 1 FROM memory.facts f WHERE f.memory_id = m.id) as has_facts
           FROM memory.memories m
          WHERE m.agent_id = $1 AND m.is_deleted = FALSE
            AND (m.expires_at IS NULL OR m.expires_at > now())
          ORDER BY m.created_at DESC
          LIMIT $2`,
        [agent, limit],
      );

      const detailed = [];

      for (const memory of memories) {
        const { rows: versions } = await pool.query(
          `SELECT version, value, created_at FROM memory.memory_versions
            WHERE memory_id = $1 ORDER BY version DESC`,
          [memory.id],
        );
        // `has_facts` EXISTS check skips a per-row query when there are none (100 rows = 100 round trips).
        const facts = memory.has_facts
          ? (
              await pool.query(
                `SELECT fact_text, created_at FROM memory.facts WHERE memory_id = $1`,
                [memory.id],
              )
            ).rows
          : [];

        detailed.push({ ...memory, versions, facts });
      }

      return h.response({ memories: detailed });
    },
  };
}

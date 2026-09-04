import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "../../../server/api-error.js";
import type { Pool } from "pg";
import type { ServerRoute } from "@hapi/hapi";
import { z } from "zod";
import { wireSchema } from "@re-cinq/lore-shared/lib/wire-schema.js";
import {
  SharedPoolSchema,
  SHARED_POOL_COLUMNS,
} from "@re-cinq/lore-shared/models/shared-pool.js";
import {
  MemoryEntrySchema,
  MEMORY_ENTRY_COLUMNS,
} from "@re-cinq/lore-shared/models/memory-entry.js";
import {
  EpisodeSchema,
  EPISODE_COLUMNS,
} from "@re-cinq/lore-shared/models/episode.js";
import { zodResponse } from "../../../server/plugins/zod-response.js";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";
import { zodValidate } from "../../../server/plugins/zod-validate.js";
import {
  clampedLimit,
  offsetParam,
  DB_UNAVAILABLE,
} from "../common-schemas.js";

// Memory browse reads (ADR-032), shaped per SCREEN not per table — one round trip per page.

const GraphBrowseQuery = z.object({
  entity: z.string().max(200).optional(),
  type: z.string().max(80).optional(),
  show_invalid: z.coerce.boolean().optional(),
});

type GraphBrowseQuery = z.infer<typeof GraphBrowseQuery>;

const EpisodesQuery = z.object({
  source: z.string().max(40).optional(),
  agent: z.string().max(200).optional(),
  limit: clampedLimit.default(50),
  offset: offsetParam,
});

type EpisodesQuery = z.infer<typeof EpisodesQuery>;

const MemorySearchQuery = z.object({
  q: z.string().min(1).max(500),
});

type MemorySearchQuery = z.infer<typeof MemorySearchQuery>;

const MemoriesQuery = z.object({
  agent: z.string().min(1).max(200),
  limit: clampedLimit.default(100),
});

type MemoriesQuery = z.infer<typeof MemoriesQuery>;

// Read models share stored fields with a model (renamed column can't drift) plus COMPUTED fields no table holds.
const PoolSchema = wireSchema(SharedPoolSchema, SHARED_POOL_COLUMNS);

const PoolListSchema = z.object({
  pools: z.array(
    PoolSchema.extend({
      entry_count: z.number(),
      agent_count: z.number(),
    }),
  ),
});

const PoolDetailSchema = z.object({
  pool: PoolSchema,
  entries: z.array(
    wireSchema(
      MemoryEntrySchema.pick({
        id: true,
        key: true,
        value: true,
        agentId: true,
        version: true,
        createdAt: true,
      }),
      MEMORY_ENTRY_COLUMNS,
    ),
  ),
});

const EpisodePageSchema = z.object({
  episodes: z.array(
    wireSchema(
      EpisodeSchema.pick({
        id: true,
        agentId: true,
        source: true,
        ref: true,
        createdAt: true,
      }),
      EPISODE_COLUMNS,
    ).extend({
      /** First 300 chars; not nullable — `LEFT()` of a NOT NULL column always yields a string. */
      content_preview: z.string(),
      fact_count: z.number(),
    }),
  ),
  total: z.number(),
});

// Read models, not raw rows: `edges` joins to NAMES, and stays empty unless an entity is selected (costliest query).
const GraphBrowseSchema = z.object({
  stats: z.object({
    entity_count: z.number(),
    active_edge_count: z.number(),
    invalidated_edge_count: z.number(),
  }),
  entity_types: z.array(z.object({ entity_type: z.string(), cnt: z.number() })),
  entities: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      entity_type: z.string(),
      repo: z.string().nullable(),
      updated_at: z.string(),
      edge_count: z.number(),
    }),
  ),
  edges: z.array(
    z.object({
      source_name: z.string(),
      source_type: z.string(),
      relation_type: z.string(),
      target_name: z.string(),
      target_type: z.string(),
      valid_from: z.string(),
      valid_to: z.string().nullable(),
      source_label: z.string(),
    }),
  ),
});

/** Memories and facts, ranked together — the two carry different fields. */
const MemorySearchSchema = z.object({
  results: z.array(z.record(z.unknown())),
});

/** One agent's memories, each with its version history and extracted facts. */
const MemoryListSchema = z.object({
  memories: z.array(z.record(z.unknown())),
});

export function memoryBrowseRoutes(getPool: () => Pool | null): ServerRoute[] {
  return [
    graphBrowseRoute(getPool),
    listPoolsRoute(getPool),
    poolDetailRoute(getPool),
    listEpisodesRoute(getPool),
    memorySearchRoute(getPool),
    listMemoriesRoute(getPool),
  ];
}

function graphBrowseRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "GET",
    path: "/api/graph-browse",
    options: zodResponse(
      {
        ...bearerScope("read"),
        validate: { query: zodValidate(GraphBrowseQuery) },
      },
      GraphBrowseSchema,
      {
        name: "GraphBrowse",
        description: "Entities and edges of the knowledge graph",
      },
    ),
    handler: async (request, h) => {
      const pool = getPool();

      enforceTrue(pool, apiError(503), DB_UNAVAILABLE);
      const { entity, type, show_invalid } =
        request.query as unknown as GraphBrowseQuery;

      const { rows: statRows } = await pool.query(`
        SELECT
          (SELECT count(*)::int FROM memory.entities) as entity_count,
          (SELECT count(*)::int FROM memory.edges WHERE valid_to IS NULL) as active_edge_count,
          (SELECT count(*)::int FROM memory.edges WHERE valid_to IS NOT NULL) as invalidated_edge_count
      `);
      const { rows: entityTypes } = await pool.query(`
        SELECT entity_type, count(*)::int as cnt
          FROM memory.entities
         GROUP BY entity_type
         ORDER BY cnt DESC
      `);
      const { rows: entities } = await pool.query(
        `SELECT en.id, en.name, en.entity_type, en.repo, en.updated_at,
                (SELECT count(*)::int FROM memory.edges e
                  WHERE (e.source_id = en.id OR e.target_id = en.id)
                    AND e.valid_to IS NULL) as edge_count
           FROM memory.entities en
           ${type ? "WHERE en.entity_type = $1" : ""}
          ORDER BY en.updated_at DESC
          LIMIT 50`,
        type ? [type] : [],
      );

      // Only a selected entity has edges to show — else it's the explorer's costliest query.
      const edges = entity
        ? (
            await pool.query(
              `SELECT s.name as source_name, s.entity_type as source_type,
                      e.relation_type, t.name as target_name, t.entity_type as target_type,
                      e.valid_from, e.valid_to,
                      CASE WHEN ep.id IS NOT NULL THEN 'episode' ELSE 'memory' END as source_label
                 FROM memory.edges e
                 JOIN memory.entities s ON s.id = e.source_id
                 JOIN memory.entities t ON t.id = e.target_id
                 LEFT JOIN memory.episodes ep ON ep.id = e.source_episode_id
                WHERE (LOWER(s.name) = LOWER($1) OR LOWER(t.name) = LOWER($1))
                  ${show_invalid ? "" : "AND e.valid_to IS NULL"}
                ORDER BY e.valid_from DESC
                LIMIT 50`,
              [entity],
            )
          ).rows
        : [];

      return h.response({
        stats: statRows[0] ?? {},
        entity_types: entityTypes,
        entities,
        edges,
      });
    },
  };
}

function listPoolsRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "GET",
    path: "/api/pools",
    options: zodResponse(bearerScope("read"), PoolListSchema, {
      name: "SharedPoolList",
      description: "Every shared pool, with how much it holds",
    }),
    handler: async (_request, h) => {
      const pool = getPool();

      enforceTrue(pool, apiError(503), DB_UNAVAILABLE);
      const { rows } = await pool.query(`
        SELECT sp.id, sp.name, sp.created_by, sp.created_at,
               count(m.id)::int as entry_count,
               count(DISTINCT m.agent_id)::int as agent_count
          FROM memory.shared_pools sp
          LEFT JOIN memory.memories m ON m.pool_id = sp.id AND m.is_deleted = FALSE
         GROUP BY sp.id
         ORDER BY sp.created_at DESC
      `);

      return h.response({ pools: rows });
    },
  };
}

function poolDetailRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "GET",
    path: "/api/pools/{name}",
    options: zodResponse(bearerScope("read"), PoolDetailSchema, {
      name: "SharedPoolDetail",
      description: "One pool and the live entries in it",
      errors: [404],
    }),
    handler: async (request, h) => {
      const pool = getPool();

      enforceTrue(pool, apiError(503), DB_UNAVAILABLE);
      const { rows } = await pool.query(
        `SELECT id, name, created_by, created_at
           FROM memory.shared_pools WHERE name = $1`,
        [request.params.name],
      );

      enforceTrue(rows.length !== 0, apiError(404), "Pool not found");
      const { rows: entries } = await pool.query(
        `SELECT m.id, m.key, m.value, m.agent_id, m.version, m.created_at
           FROM memory.memories m
          WHERE m.pool_id = $1
            AND m.is_deleted = FALSE
            AND (m.expires_at IS NULL OR m.expires_at > now())
          ORDER BY m.created_at DESC`,
        [rows[0].id],
      );

      return h.response({ pool: rows[0], entries });
    },
  };
}

function listEpisodesRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "GET",
    path: "/api/episodes",
    options: zodResponse(
      {
        ...bearerScope("read"),
        validate: { query: zodValidate(EpisodesQuery) },
      },
      EpisodePageSchema,
      { name: "EpisodePage", description: "A page of ingested episodes" },
    ),
    handler: async (request, h) => {
      const pool = getPool();

      enforceTrue(pool, apiError(503), DB_UNAVAILABLE);
      const { source, agent, limit, offset } =
        request.query as unknown as EpisodesQuery;

      const conditions: string[] = [];
      const params: unknown[] = [];

      if (source?.trim()) {
        params.push(source.trim());
        conditions.push(`e.source = $${params.length}`);
      }

      if (agent?.trim()) {
        params.push(agent.trim());
        conditions.push(`e.agent_id = $${params.length}`);
      }
      const where = conditions.length
        ? `WHERE ${conditions.join(" AND ")}`
        : "";

      const { rows: countRows } = await pool.query<{ count: number }>(
        `SELECT count(*)::int as count FROM memory.episodes e ${where}`,
        params,
      );
      const { rows: episodes } = await pool.query(
        `SELECT e.id, e.agent_id, e.source, e.ref,
                LEFT(e.content, 300) as content_preview,
                (SELECT count(*)::int FROM memory.facts f WHERE f.episode_id = e.id) as fact_count,
                e.created_at
           FROM memory.episodes e
           ${where}
          ORDER BY e.created_at DESC
          LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset],
      );

      return h.response({ episodes, total: countRows[0]?.count ?? 0 });
    },
  };
}

function memorySearchRoute(getPool: () => Pool | null): ServerRoute {
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

function listMemoriesRoute(getPool: () => Pool | null): ServerRoute {
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

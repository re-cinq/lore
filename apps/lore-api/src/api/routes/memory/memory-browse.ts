import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "../../../server/api-error.js";
import type { Pool } from "pg";
import type { ServerRoute } from "@hapi/hapi";
import { zodResponse } from "../../../server/plugins/zod-response.js";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";
import { zodValidate } from "../../../server/plugins/zod-validate.js";
import { DB_UNAVAILABLE } from "../common-schemas.js";
import {
  GraphBrowseQuery,
  EpisodesQuery,
  PoolListSchema,
  PoolDetailSchema,
  EpisodePageSchema,
  GraphBrowseSchema,
} from "./memory-browse-schemas.js";
import {
  memorySearchRoute,
  listMemoriesRoute,
} from "./memory-search-routes.js";

export {
  memorySearchRoute,
  listMemoriesRoute,
} from "./memory-search-routes.js";

// Memory browse reads (ADR-032), shaped per SCREEN not per table — one round trip per page.

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

function episodeFilter(source: string | undefined, agent: string | undefined) {
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

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  return { where, params };
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
      const { where, params } = episodeFilter(source, agent);

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

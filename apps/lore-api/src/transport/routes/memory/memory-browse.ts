import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import type { Pool } from "pg";
import type {
  Request,
  ResponseObject,
  ResponseToolkit,
  ServerRoute,
} from "@hapi/hapi";
import { zodResponse } from "../../http/zod-response.js";
import { bearerScope } from "../../http/bearer-scope.js";
import { zodValidate } from "../../http/zod-validate.js";
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

const GRAPH_STATS_SQL = `
        SELECT
          (SELECT count(*)::int FROM memory.entities) as entity_count,
          (SELECT count(*)::int FROM memory.edges WHERE valid_to IS NULL) as active_edge_count,
          (SELECT count(*)::int FROM memory.edges WHERE valid_to IS NOT NULL) as invalidated_edge_count
      `;

const ENTITY_TYPES_SQL = `
        SELECT entity_type, count(*)::int as cnt
          FROM memory.entities
         GROUP BY entity_type
         ORDER BY cnt DESC
      `;

function readEntities(
  pool: Pool,
  type: string | undefined,
): Promise<{ rows: Record<string, unknown>[] }> {
  return pool.query(
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
}

function edgesSql(showInvalid: boolean | undefined): string {
  return `SELECT s.name as source_name, s.entity_type as source_type,
                      e.relation_type, t.name as target_name, t.entity_type as target_type,
                      e.valid_from, e.valid_to,
                      CASE WHEN ep.id IS NOT NULL THEN 'episode' ELSE 'memory' END as source_label
                 FROM memory.edges e
                 JOIN memory.entities s ON s.id = e.source_id
                 JOIN memory.entities t ON t.id = e.target_id
                 LEFT JOIN memory.episodes ep ON ep.id = e.source_episode_id
                WHERE (LOWER(s.name) = LOWER($1) OR LOWER(t.name) = LOWER($1))
                  ${showInvalid ? "" : "AND e.valid_to IS NULL"}
                ORDER BY e.valid_from DESC
                LIMIT 50`;
}

/** Only a SELECTED entity has edges to show — unselected, this is the explorer's costliest query, so it is not run at all. */
async function readEdgesFor(
  pool: Pool,
  entity: string | undefined,
  showInvalid: boolean | undefined,
): Promise<Record<string, unknown>[]> {
  if (!entity) {
    return [];
  }
  const { rows } = await pool.query(edgesSql(showInvalid), [entity]);

  return rows;
}

/** Entities and edges of the knowledge graph, for browsing rather than querying — the whole neighbourhood, not the answer to a question. */
async function serveGraphBrowse(
  getPool: () => Pool | null,
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  const pool = getPool();

  enforceTrue(pool, apiError(503), DB_UNAVAILABLE);
  const { entity, type, show_invalid } =
    request.query as unknown as GraphBrowseQuery;

  const { rows: statRows } = await pool.query(GRAPH_STATS_SQL);
  const { rows: entityTypes } = await pool.query(ENTITY_TYPES_SQL);
  const { rows: entities } = await readEntities(pool, type);

  return h.response({
    stats: statRows[0] ?? {},
    entity_types: entityTypes,
    entities,
    edges: await readEdgesFor(pool, entity, show_invalid),
  });
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
    handler: (request, h) => serveGraphBrowse(getPool, request, h),
  };
}

const POOL_LIST_SQL = `
        SELECT sp.id, sp.name, sp.created_by, sp.created_at,
               count(m.id)::int as entry_count,
               count(DISTINCT m.agent_id)::int as agent_count
          FROM memory.shared_pools sp
          LEFT JOIN memory.memories m ON m.pool_id = sp.id AND m.is_deleted = FALSE
         GROUP BY sp.id
         ORDER BY sp.created_at DESC
      `;

async function servePoolList(
  getPool: () => Pool | null,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  const pool = getPool();

  enforceTrue(pool, apiError(503), DB_UNAVAILABLE);
  const { rows } = await pool.query(POOL_LIST_SQL);

  return h.response({ pools: rows });
}

function listPoolsRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "GET",
    path: "/api/pools",
    options: zodResponse(bearerScope("read"), PoolListSchema, {
      name: "SharedPoolList",
      description: "Every shared pool, with how much it holds",
    }),
    handler: (_request, h) => servePoolList(getPool, h),
  };
}

/** The live entries of one pool — expired and soft-deleted memories are not what it holds. */
async function readPoolEntries(pool: Pool, poolId: unknown) {
  const { rows } = await pool.query(
    `SELECT m.id, m.key, m.value, m.agent_id, m.version, m.created_at
       FROM memory.memories m
      WHERE m.pool_id = $1
        AND m.is_deleted = FALSE
        AND (m.expires_at IS NULL OR m.expires_at > now())
      ORDER BY m.created_at DESC`,
    [poolId],
  );

  return rows;
}

/** One shared pool and what it holds. Pools are how memory crosses agent boundaries, so the count is what tells a reader whether anyone is actually using it. */
async function servePoolDetail(
  getPool: () => Pool | null,
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  const pool = getPool();

  enforceTrue(pool, apiError(503), DB_UNAVAILABLE);
  const { rows } = await pool.query(
    `SELECT id, name, created_by, created_at
       FROM memory.shared_pools WHERE name = $1`,
    [request.params.name],
  );

  enforceTrue(rows.length !== 0, apiError(404), "Pool not found");

  return h.response({
    pool: rows[0],
    entries: await readPoolEntries(pool, rows[0].id),
  });
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
    handler: (request, h) => servePoolDetail(getPool, request, h),
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

async function readEpisodeCount(
  pool: Pool,
  where: string,
  params: unknown[],
): Promise<number> {
  const { rows } = await pool.query<{ count: number }>(
    `SELECT count(*)::int as count FROM memory.episodes e ${where}`,
    params,
  );

  return rows[0]?.count ?? 0;
}

function episodePageSql(where: string, paramCount: number): string {
  return `SELECT e.id, e.agent_id, e.source, e.ref,
            LEFT(e.content, 300) as content_preview,
            (SELECT count(*)::int FROM memory.facts f WHERE f.episode_id = e.id) as fact_count,
            e.created_at
       FROM memory.episodes e
       ${where}
      ORDER BY e.created_at DESC
      LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
}

/** Recent episodes — the raw text facts were extracted FROM, which is what makes an extracted fact auditable. */
async function serveEpisodeList(
  getPool: () => Pool | null,
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  const pool = getPool();

  enforceTrue(pool, apiError(503), DB_UNAVAILABLE);
  const { source, agent, limit, offset } =
    request.query as unknown as EpisodesQuery;
  const { where, params } = episodeFilter(source, agent);
  const total = await readEpisodeCount(pool, where, params);
  const { rows: episodes } = await pool.query(
    episodePageSql(where, params.length),
    [...params, limit, offset],
  );

  return h.response({ episodes, total });
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
    handler: (request, h) => serveEpisodeList(getPool, request, h),
  };
}

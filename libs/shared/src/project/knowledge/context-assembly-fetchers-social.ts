import { computeTransferScore } from "../../memory-ranking.js";
import { queryLiveGraph } from "./live-graph.js";
import { listChunkSchemas } from "../chunks/chunk-schema.js";
import type { PgPool } from "../../memory-store.js";
import type { SourceItem } from "./context-assembly-format.js";
import type { FetchResult } from "./context-assembly-types.js";
import {
  mkItem,
  toScore,
  addUniqueGraphLines,
} from "./context-assembly-items.js";
import type {
  ChunkSearchHit,
  Incident,
} from "./context-assembly-chunk-search.js";
import type { SourceFetcher } from "./context-assembly-fetchers-types.js";

/** Social/environmental context sources: the live knowledge graph, cross-repo transfer, and production incidents. */

async function fetchGraph(
  pool: PgPool,
  query: string,
  repo: string | undefined,
): Promise<FetchResult> {
  try {
    const words = query
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 3);
    const seen = new Set<string>();
    const sources: SourceItem[] = [];

    for (const word of words.slice(0, 3)) {
      const graphResults = await queryLiveGraph(pool, { entity: word, repo });

      addUniqueGraphLines(graphResults, seen, sources);
    }

    return { sources, status: sources.length > 0 ? "ok" : "empty" };
  } catch {
    return { sources: [], status: "error" };
  }
}

async function linkedReposFor(pool: PgPool, repo: string): Promise<string[]> {
  const { rows } = await pool.query<{
    settings: { cross_repo_repos?: string[] } | null;
  }>(`SELECT settings FROM lore.repos WHERE full_name = $1`, [repo]);

  return rows[0]?.settings?.cross_repo_repos || [];
}

/** Linked repos may live in any team schema, so the search spans every provisioned chunk schema plus org_shared. */
async function searchCrossRepoChunks(
  pool: PgPool,
  query: string,
  repo: string,
  { linkedRepos, schemas }: { linkedRepos: string[]; schemas: string[] },
): Promise<ChunkSearchHit[]> {
  const repoFilter = linkedRepos.length > 0 ? "repo = ANY($1)" : "repo != $1";
  const branches = schemas.map(
    (schema) =>
      `SELECT content, repo, file_path, ts_rank(search_tsv, plainto_tsquery($2)) AS score
       FROM ${schema}.chunks
       WHERE ${repoFilter} AND search_tsv @@ plainto_tsquery($2)`,
  );
  const { rows } = await pool.query<ChunkSearchHit>(
    `SELECT content, repo, file_path, score FROM (${branches.join(" UNION ALL ")}) AS matches
     ORDER BY score DESC LIMIT 5`,
    [linkedRepos.length > 0 ? linkedRepos : repo, query],
  );

  return rows;
}

/** Only portable, high-transfer-score content from other repos passes through. */
function onlyTransferable(
  rows: ChunkSearchHit[],
): (ChunkSearchHit & { transferScore: number })[] {
  return rows
    .map((r) => ({ ...r, transferScore: computeTransferScore(r.content) }))
    .filter((r) => r.transferScore >= 0.5);
}

async function fetchCrossRepo(
  pool: PgPool,
  query: string,
  repo: string,
): Promise<FetchResult> {
  const [linkedRepos, schemas] = await Promise.all([
    linkedReposFor(pool, repo),
    listChunkSchemas(pool),
  ]);
  const rows = await searchCrossRepoChunks(pool, query, repo, {
    linkedRepos,
    schemas,
  });

  if (rows.length === 0) {
    return { sources: [], status: "empty" };
  }
  const scored = onlyTransferable(rows);

  if (scored.length === 0) {
    return { sources: [], status: "empty" };
  }

  return {
    sources: scored.map((r) =>
      mkItem(r.content, {
        source_path: r.file_path,
        repo: r.repo,
        content_type: "cross_repo",
        score: toScore(r.score),
      }),
    ),
    status: "ok",
  };
}

/** The repo's incidents array, or empty when settings carry none (malformed or absent alike). */
function incidentsListFrom(
  settings: { incidents?: Incident[] } | null | undefined,
): Incident[] {
  return Array.isArray(settings?.incidents) ? settings.incidents : [];
}

async function fetchIncidents(
  pool: PgPool,
  repo: string,
): Promise<FetchResult> {
  const { rows } = await pool.query<{
    settings: { incidents?: Incident[] } | null;
  }>(`SELECT settings FROM lore.repos WHERE full_name = $1`, [repo]);
  const incidents = incidentsListFrom(rows[0]?.settings);

  if (incidents.length === 0) {
    return { sources: [], status: "empty" };
  }
  const cutoff = Date.now() - 30 * 86400000;
  const recent = incidents.filter((i) => new Date(i.date).getTime() > cutoff);

  if (recent.length === 0) {
    return { sources: [], status: "empty" };
  }

  return {
    sources: recent.map((i) =>
      mkItem(
        `- **${i.severity || "unknown"}**: ${i.title}${i.resolved ? " (resolved)" : ""} — ${i.date}${i.url ? ` [link](${i.url})` : ""}`,
        { content_type: "incident" },
      ),
    ),
    status: "ok",
  };
}

export const socialFetchers: Record<string, SourceFetcher> = {
  graph: (pool, query, repo) => fetchGraph(pool, query, repo),

  async cross_repo(pool, query, repo): Promise<FetchResult> {
    if (!repo) {
      return { sources: [], status: "empty" };
    }

    try {
      return await fetchCrossRepo(pool, query, repo);
    } catch {
      return { sources: [], status: "error" };
    }
  },

  async incidents(pool, _query, repo): Promise<FetchResult> {
    if (!repo) {
      return { sources: [], status: "empty" };
    }

    try {
      return await fetchIncidents(pool, repo);
    } catch {
      return { sources: [], status: "error" };
    }
  },
};

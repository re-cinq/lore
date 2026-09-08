import { searchMemories } from "./memory-search.js";
import { resolveChunkSchemaForRepo } from "../chunks/chunk-schema.js";
import type { PgPool } from "../../memory-store.js";
import type { FetchResult } from "./context-assembly-types.js";
import { mkItem } from "./context-assembly-items.js";
import {
  hybridChunkItems,
  type ChunkSearchHit,
} from "./context-assembly-chunk-search.js";
import type { SourceFetcher } from "./context-assembly-fetchers-types.js";
import type { SourceItem } from "./context-assembly-format.js";
import type { MemorySearchResult } from "./memory-search.js";

/** Content/knowledge context sources: repo docs+specs, source code, ADRs, agent memory, episodes, and rule files. */

const RECENT_CONFLICTS_SQL = `SELECT new_fact_id FROM memory.fact_conflicts
       WHERE new_fact_id = ANY($1) AND created_at > now() - interval '7 days'`;

async function conflictIdRows(pool: PgPool, factIds: string[]) {
  const { rows } = await pool.query<{ new_fact_id: string }>(
    RECENT_CONFLICTS_SQL,
    [factIds],
  );

  return rows;
}

async function memoriesConflictSet(
  pool: PgPool,
  factIds: string[],
): Promise<Set<string>> {
  const conflictSet = new Set<string>();

  if (factIds.length === 0) {
    return conflictSet;
  }

  try {
    for (const conflict of await conflictIdRows(pool, factIds)) {
      conflictSet.add(conflict.new_fact_id);
    }
  } catch {
    /* non-fatal */
  }

  return conflictSet;
}

function factIdsOf(results: MemorySearchResult[]): string[] {
  return results
    .filter((r) => r.id && (r.source === "fact" || r.source === "episode"))
    .map((r) => r.id!);
}

function toMemoryItem(
  result: MemorySearchResult,
  conflictSet: Set<string>,
): SourceItem {
  const tag = result.confidence ? ` [${result.confidence}]` : "";
  const conflict = result.id && conflictSet.has(result.id) ? " [CONFLICT]" : "";

  return mkItem(
    `**${result.key}** (${result.source})${tag}${conflict}: ${result.value}`,
    { source_path: result.key, content_type: result.source },
  );
}

async function fetchMemories(
  pool: PgPool,
  query: string,
  agentId: string | undefined,
): Promise<FetchResult> {
  try {
    const results = await searchMemories(pool, query, { agentId, limit: 10 });

    if (results.length === 0) {
      return { sources: [], status: "empty" };
    }
    const conflictSet = await memoriesConflictSet(pool, factIdsOf(results));
    const sources = results.map((r) => toMemoryItem(r, conflictSet));

    return { sources, status: "ok" };
  } catch {
    return { sources: [], status: "error" };
  }
}

function toEpisodeItem(result: MemorySearchResult): SourceItem {
  return mkItem(`**${result.key}**: ${result.value}`, {
    source_path: result.key,
    content_type: "episode",
  });
}

async function fetchEpisodes(
  pool: PgPool,
  query: string,
  agentId: string | undefined,
): Promise<FetchResult> {
  try {
    const results = await searchMemories(pool, query, { agentId, limit: 5 });
    const episodes = results.filter((r) => r.source === "episode");

    if (episodes.length === 0) {
      return { sources: [], status: "empty" };
    }

    return { sources: episodes.map(toEpisodeItem), status: "ok" };
  } catch {
    return { sources: [], status: "error" };
  }
}

function matchRules(rows: ChunkSearchHit[], query: string): ChunkSearchHit[] {
  const queryWords = query
    .toLowerCase()
    .split(/\s+/)
    .filter((w: string) => w.length > 2);

  return rows.filter((r) => {
    const fileName = r.file_path.replace(/.*\//, "");
    const ruleName = fileName.replace(/\.md$/, "").toLowerCase();

    return queryWords.some(
      (w: string) => ruleName.includes(w) || w.includes(ruleName),
    );
  });
}

async function ruleChunks(
  pool: PgPool,
  repo: string,
): Promise<ChunkSearchHit[]> {
  const schema = await resolveChunkSchemaForRepo(pool, repo);
  const { rows } = await pool.query<ChunkSearchHit>(
    `SELECT content, file_path FROM ${schema}.chunks
       WHERE repo = $1 AND content_type = 'rule'
       ORDER BY file_path`,
    [repo],
  );

  return rows;
}

function toRuleItem(row: ChunkSearchHit): SourceItem {
  return mkItem(row.content, {
    source_path: row.file_path,
    content_type: "rule",
  });
}

async function fetchRules(
  pool: PgPool,
  query: string,
  repo: string,
): Promise<FetchResult> {
  try {
    const rows = await ruleChunks(pool, repo);

    if (rows.length === 0) {
      return { sources: [], status: "empty" };
    }
    const matched = matchRules(rows, query);

    // No keyword match is distinct from "no rules exist" — surface it in the trace.
    if (matched.length === 0) {
      return { sources: [], status: "no-match" };
    }

    return { sources: matched.map(toRuleItem), status: "ok" };
  } catch {
    return { sources: [], status: "error" };
  }
}

async function hybridSource(
  pool: PgPool,
  query: string,
  repo: string | undefined,
  { contentTypes, limit }: { contentTypes: string[]; limit: number },
): Promise<FetchResult> {
  if (!repo) {
    return { sources: [], status: "empty" };
  }

  try {
    const sources = await hybridChunkItems(pool, query, repo, {
      contentTypes,
      limit,
    });

    return { sources, status: sources.length > 0 ? "ok" : "empty" };
  } catch {
    return { sources: [], status: "error" };
  }
}

export const contentFetchers: Record<string, SourceFetcher> = {
  // Repo conventions: docs + specs (ADRs are their own section); hybrid ranking avoids floating unrelated web-ui specs on term overlap alone.
  repo: (pool, query, repo) =>
    hybridSource(pool, query, repo, {
      contentTypes: ["doc", "spec"],
      limit: 5,
    }),

  // Source code the task touches — previously NEVER retrieved, so implementation tasks got zero of the files they edit.
  code: (pool, query, repo) =>
    hybridSource(pool, query, repo, { contentTypes: ["code"], limit: 6 }),

  // ADRs ranked by relevance (hybrid vector+keyword) to the query.
  adrs: (pool, query, repo) =>
    hybridSource(pool, query, repo, { contentTypes: ["adr"], limit: 10 }),

  memories: (pool, query, _repo, agentId) =>
    fetchMemories(pool, query, agentId),

  episodes: (pool, query, _repo, agentId) =>
    fetchEpisodes(pool, query, agentId),

  async rules(pool, query, repo): Promise<FetchResult> {
    // Load .claude/rules/*.md files whose filename keyword-matches the query.
    if (!repo) {
      return { sources: [], status: "empty" };
    }

    return fetchRules(pool, query, repo);
  },
};

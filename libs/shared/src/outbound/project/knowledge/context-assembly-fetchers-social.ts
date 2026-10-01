import { queryLiveGraph } from "./live-graph.js";
import type { PgPool } from "../../memory-store.js";
import type { SourceItem } from "./context-assembly-format.js";
import type { FetchResult } from "./context-assembly-types.js";
import {
  mkItem,
  addUniqueGraphLines,
  extractKeyTerms,
} from "./context-assembly-items.js";
import {
  hybridChunkItems,
  type Incident,
} from "./context-assembly-chunk-search.js";
import type { SourceFetcher } from "./context-assembly-fetchers-types.js";

/** Social/environmental context sources: the live knowledge graph, linked-repo search, and production incidents. */

async function fetchGraph(
  pool: PgPool,
  query: string,
  repo: string | undefined,
): Promise<FetchResult> {
  try {
    const seen = new Set<string>();
    const sources: SourceItem[] = [];

    for (const word of graphEntityCandidates(query)) {
      const graphResults = await queryLiveGraph(pool, { entity: word, repo });

      addUniqueGraphLines(graphResults, seen, sources);
    }

    return { sources, status: sources.length > 0 ? "ok" : "empty" };
  } catch {
    return { sources: [], status: "error" };
  }
}

/** The three most distinctive words of the query, lower-cased for the entity match — the first three long words were filler ("catalog sync bug: saving") more often than entities. */
function graphEntityCandidates(query: string): string[] {
  return extractKeyTerms(query, 3).map((term) => term.toLowerCase());
}

async function fetchCrossRepo(
  pool: PgPool,
  query: string,
  repo: string,
): Promise<FetchResult> {
  const linkedRepos = await linkedReposFor(pool, repo);

  if (linkedRepos.length === 0) {
    return { sources: [], status: "disabled" };
  }
  const sources = await linkedRepoSources(pool, query, linkedRepos);

  return { sources, status: sources.length > 0 ? "ok" : "empty" };
}

async function linkedRepoSources(
  pool: PgPool,
  query: string,
  linkedRepos: string[],
): Promise<SourceItem[]> {
  const perRepo = await Promise.all(
    linkedRepos.map(async (linked) =>
      (await hybridChunkItems(pool, query, linked, CROSS_REPO_SEARCH)).map(
        (hit) => toCrossRepoItem(hit, linked),
      ),
    ),
  );

  return perRepo
    .flat()
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, CROSS_REPO_SEARCH.limit);
}

const CROSS_REPO_SEARCH = { contentTypes: ["doc", "spec", "adr"], limit: 5 };

async function linkedReposFor(pool: PgPool, repo: string): Promise<string[]> {
  const { rows } = await pool.query<{
    settings: { cross_repo_repos?: string[] } | null;
  }>(`SELECT settings FROM lore.repos WHERE full_name = $1`, [repo]);

  const first = rows.at(0);

  return first?.settings?.cross_repo_repos || [];
}

/** A hit from a linked repo, tagged with that repo so the assembled block can say where it came from — context borrowed from elsewhere is worth less to the reader if they cannot tell it is borrowed. Linking is an explicit opt-in, so no transfer score filters it. */
function toCrossRepoItem(hit: SourceItem, repo: string): SourceItem {
  return { ...hit, repo };
}

async function fetchIncidents(
  pool: PgPool,
  repo: string,
): Promise<FetchResult> {
  const { rows } = await pool.query<{
    settings: { incidents?: Incident[] } | null;
  }>(`SELECT settings FROM lore.repos WHERE full_name = $1`, [repo]);
  const recent = recentIncidents(incidentsListFrom(rows[0]?.settings));

  if (recent.length === 0) {
    return { sources: [], status: "empty" };
  }

  return { sources: recent.map(toIncidentItem), status: "ok" };
}

/** The repo's incidents array, or empty when settings carry none (malformed or absent alike). */
function incidentsListFrom(
  settings: { incidents?: Incident[] } | null | undefined,
): Incident[] {
  return Array.isArray(settings?.incidents) ? settings.incidents : [];
}

/** Incidents from the last 30 days — older ones no longer describe how the system behaves today. */
function recentIncidents(incidents: Incident[]): Incident[] {
  const cutoff = Date.now() - 30 * 86400000;

  return incidents.filter((i) => new Date(i.date).getTime() > cutoff);
}

function toIncidentItem(incident: Incident): SourceItem {
  const resolved = incident.resolved ? " (resolved)" : "";
  const link = incident.url ? ` [link](${incident.url})` : "";

  return mkItem(
    `- **${incident.severity || "unknown"}**: ${incident.title}${resolved} — ${incident.date}${link}`,
    { content_type: "incident" },
  );
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

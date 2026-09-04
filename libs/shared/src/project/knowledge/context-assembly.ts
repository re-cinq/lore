// Context assembly: retrieves from all sources into a structured, token-budgeted, XML-tagged block; `debug` adds a full per-source trace (context-assembly-format.ts).

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { searchMemories } from "./memory-search.js";
import { computeTransferScore } from "../../memory-ranking.js";
import { queryLiveGraph } from "./live-graph.js";
import { getQueryEmbedding } from "../../embeddings/embedding-service.js";
import {
  fetchGraphContext,
  type GraphContextBlock,
} from "../../spec-trace/graph-context.js";
import type { DgraphClientPort, PgPool } from "../../memory-store.js";
import {
  listChunkSchemas,
  resolveChunkSchemaForRepo,
} from "../chunks/chunk-schema.js";
import {
  dedupeItems,
  serializeContext,
  type SourceItem,
  type SerializedSection,
} from "./context-assembly-format.js";

// ── Types ───────────────────────────────────────────────────────────

interface TemplateSection {
  header: string;
  source:
    | "repo"
    | "code"
    | "adrs"
    | "memories"
    | "graph"
    | "coupling"
    | "episodes"
    | "rules"
    | "cross_repo"
    | "incidents";
  priority: number;
  max_tokens?: number;
}

interface Template {
  name: string;
  description: string;
  sections: TemplateSection[];
}

export type FetchStatus = "ok" | "empty" | "error" | "no-match" | "disabled";

export interface FetchResult {
  sources: SourceItem[];
  status: FetchStatus;
}

export interface TraceSection {
  header: string;
  source: string;
  priority: number;
  status: FetchStatus;
  allocatedBudget: number;
  rawTokens: number;
  finalTokens: number;
  truncated: boolean;
  included: boolean;
  omitReason?: string;
  items: SourceItem[];
}

export interface AssemblyTrace {
  query: string;
  template: string;
  effectiveBudget: number;
  crossRepo: boolean;
  templateSections: {
    header: string;
    source: string;
    priority: number;
    max_tokens?: number;
  }[];
  sections: TraceSection[];
  budget: { total: number; used: number; leftover: number };
  freshness: { state: string; message: string };
  timingsMs: { total: number; perSource: Record<string, number> };
}

export interface AssembledResult {
  text: string;
  sections: { header: string; tokens: number; truncated: boolean }[];
  trace?: AssemblyTrace;
  context_refs?: { fact_ids: string[]; memory_ids: string[] };
}

// ── Template loading ────────────────────────────────────────────────

const templates = new Map<string, Template>();

export function loadTemplates(dir?: string): void {
  const templateDir =
    dir || join(import.meta.dirname || process.cwd(), "..", "templates");

  if (!existsSync(templateDir)) {
    console.warn(
      `[context-assembly] Templates directory not found: ${templateDir}`,
    );

    return;
  }

  const files = readdirSync(templateDir).filter(
    (f) => f.endsWith(".yaml") || f.endsWith(".yml"),
  );

  for (const file of files) {
    try {
      const raw = readFileSync(join(templateDir, file), "utf-8");
      const template = parseYaml(raw) as Template;

      if (template.name && template.sections) {
        templates.set(template.name, template);
      }
    } catch (err) {
      console.warn(`[context-assembly] Failed to load template ${file}:`, err);
    }
  }
  console.log(
    `[context-assembly] Loaded ${templates.size} templates: ${[...templates.keys()].join(", ")}`,
  );
}

function getTemplate(name: string): Template {
  return (
    templates.get(name) ||
    templates.get("default") || {
      name: "default",
      description: "Fallback template",
      sections: [
        { header: "Conventions", source: "repo" as const, priority: 1 },
        { header: "Agent Memory", source: "memories" as const, priority: 2 },
      ],
    }
  );
}

// ── Token estimation + item helpers ─────────────────────────────────

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Truncate at a paragraph boundary; no inline marker — the `truncated="true"` document attribute carries that signal instead. */
function truncateText(text: string, maxTokens: number): string {
  const maxChars = maxTokens * 4;

  if (text.length <= maxChars) {
    return text;
  }
  const cut = text.substring(0, maxChars);
  const lastParagraph = cut.lastIndexOf("\n\n");

  return lastParagraph > maxChars * 0.5 ? cut.substring(0, lastParagraph) : cut;
}

function mkItem(text: string, extra: Partial<SourceItem> = {}): SourceItem {
  return { text, tokens: estimateTokens(text), ...extra };
}

/** Append one graph item per relation line not already in `seen`. */
function addUniqueGraphLines(
  graphResults: Awaited<ReturnType<typeof queryLiveGraph>>,
  seen: Set<string>,
  sources: SourceItem[],
): void {
  for (const r of graphResults) {
    const line = `${r.entity} (${r.entity_type}) --${r.relation}--> ${r.related_entity} (${r.related_type})`;

    if (seen.has(line)) {
      continue;
    }
    seen.add(line);
    sources.push(mkItem(line, { content_type: "graph" }));
  }
}

/** Split search-result ids into memory refs and fact refs (outcome feedback). */
function collectContextRefIds(
  results: Awaited<ReturnType<typeof searchMemories>>,
  memoryIds: string[],
  factIds: string[],
): void {
  for (const r of results) {
    if (!r.id) {
      continue;
    }

    if (r.source === "memory") {
      memoryIds.push(r.id);
      continue;
    }
    factIds.push(r.id);
  }
}

function toScore(value: unknown): number | undefined {
  if (value == null) {
    return undefined;
  }
  const n = typeof value === "number" ? value : Number(value);

  return Number.isFinite(n) ? n : undefined;
}

function toIso(value: unknown): string | undefined {
  if (!value) {
    return undefined;
  }

  try {
    return new Date(value as string | number | Date).toISOString();
  } catch {
    return undefined;
  }
}

/** Pack sources into a token budget: keep whole sources, truncate the overflow source, drop the rest. `maxPerDocTokens` caps any single document so a mega-doc can't crowd out smaller ones. */
export function fitItemsToBudget(
  sources: SourceItem[],
  budgetTokens: number,
  maxPerDocTokens?: number,
): { kept: SourceItem[]; truncated: boolean } {
  const kept: SourceItem[] = [];
  let used = 0;
  let truncated = false;

  for (const it of sources) {
    const remaining = budgetTokens - used;

    if (remaining <= 0) {
      truncated = true;
      break;
    }
    const limit = Math.min(remaining, maxPerDocTokens ?? Infinity);

    if (it.tokens <= limit) {
      kept.push(it);
      used += it.tokens;
      continue;
    }
    const text = truncateText(it.text, limit);
    const tokens = estimateTokens(text);

    kept.push({ ...it, text, tokens });
    used += tokens;
    truncated = true;

    // Stop only when the BUDGET was the binding limit; a per-doc cap leaves room to keep packing.
    if (limit >= remaining) {
      break;
    }
  }

  return { kept, truncated };
}

// Common words dropped from the keyword leg so a paragraph-length query matches on its distinctive terms, not filler.
const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "to",
  "for",
  "of",
  "in",
  "on",
  "at",
  "by",
  "with",
  "from",
  "that",
  "this",
  "these",
  "those",
  "is",
  "are",
  "be",
  "as",
  "it",
  "its",
  "into",
  "via",
  "per",
  "add",
  "use",
  "using",
  "new",
  "update",
  "edit",
  "change",
  "make",
  "set",
  "get",
  "also",
  "should",
  "would",
  "can",
  "will",
  "not",
  "but",
  "so",
  "if",
  "when",
  "then",
  "than",
  "they",
  "their",
  "you",
  "your",
  "we",
  "our",
]);

/** Distinctive terms from a query: drop stopwords + ≤2-char words, de-dupe case-insensitively, preserve order, cap at `max`. */
export function extractKeyTerms(query: string, max = 12): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const raw of query.split(/[^A-Za-z0-9_.-]+/)) {
    const lower = raw.toLowerCase();

    if (lower.length <= 2 || STOPWORDS.has(lower) || seen.has(lower)) {
      continue;
    }
    seen.add(lower);
    out.push(raw);

    if (out.length >= max) {
      break;
    }
  }

  return out;
}

/** Filter out sources already emitted in an earlier section (keyed by source path, else text) — keeps a document in its highest-priority section only. */
export function dropSeen(
  sources: SourceItem[],
  seen: Set<string>,
): SourceItem[] {
  const kept: SourceItem[] = [];

  for (const it of sources) {
    const key = it.source_path || it.text;

    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    kept.push(it);
  }

  return kept;
}

/** Rescale item scores so the top result is 1.0 — RRF/ts_rank raw scores are tiny (~0.02) and unreadable as relevance. No-op with no positive score. */
function normalizeScores(sources: SourceItem[]): SourceItem[] {
  const max = Math.max(0, ...sources.map((s) => s.score ?? 0));

  if (max <= 0) {
    return sources;
  }

  return sources.map((i) =>
    i.score != null ? { ...i, score: i.score / max } : i,
  );
}

// Coupled-statement signal → relevance score, so violations/drift sort to the top.
const COUPLING_SIGNAL_SCORE: Record<string, number> = {
  violated: 1.0,
  drifted: 0.66,
  untested: 0.33,
  normal: 0.1,
};

/** Project a spec-traceability GraphContextBlock into context sources — the deterministic "what spec rules + tests govern this code" signal vector search can't produce. */
export function formatCouplingItems(block: GraphContextBlock): SourceItem[] {
  return block.statements.map((s) => {
    const head = `[${s.signal}] ${s.specPath}${s.section ? ` › ${s.section}` : ""} — ${s.statementText}`;
    const gov = s.adrs.length
      ? `\n  governed by: ${s.adrs.map((a) => a.label).join(", ")}`
      : "";
    const tests = s.testSelectors.length
      ? `\n  tested by: ${s.testSelectors.join(", ")}`
      : "";

    return mkItem(head + gov + tests, {
      source_path: s.specPath,
      content_type: "coupling",
      score: COUPLING_SIGNAL_SCORE[s.signal] ?? 0,
    });
  });
}

/** Coupling context source: reads the repo's coupled spec statements from the spec-traceability graph. Fail-soft — `disabled` when no graph client is wired (LORE_DGRAPH_HTTP unset). */
export async function fetchCouplingSource(
  dgraph: DgraphClientPort | null,
  repo?: string,
): Promise<FetchResult> {
  if (!dgraph || !repo) {
    return { sources: [], status: "disabled" };
  }

  try {
    const block = await fetchGraphContext(dgraph, repo);
    const sources = formatCouplingItems(block);

    return { sources, status: sources.length > 0 ? "ok" : "empty" };
  } catch {
    return { sources: [], status: "error" };
  }
}

/** Hybrid RRF retrieval over the repo's resolved chunk schema: pgvector cosine leg + BM25 (ts_rank) leg, same as search_context; degrades to keyword-only with no query embedding. */
/** One hybrid-search HIT, not a chunk row — `score` is a ts_rank/cosine aggregate the query computes, no column holds it (the repo had three types named ChunkRow; this is the one that never described a table). */
interface ChunkSearchHit {
  content: string;
  file_path: string;
  content_type?: string | null;
  ingested_at?: string | Date | null;
  score?: number | string | null;
  repo?: string;
}

interface Incident {
  date: string;
  severity?: string;
  title?: string;
  resolved?: boolean;
  url?: string;
}

export async function hybridChunkItems(
  pool: PgPool,
  query: string,
  repo: string,
  { contentTypes, limit }: { contentTypes: string[]; limit: number },
): Promise<SourceItem[]> {
  const [embedding, schema] = await Promise.all([
    getQueryEmbedding(query),
    resolveChunkSchemaForRepo(pool, repo),
  ]);
  // Keyword leg searches distinctive terms (OR'd) rather than the whole paragraph, which would AND every filler word.
  const keywordQuery = extractKeyTerms(query).join(" OR ") || query;
  const mapRows = (rows: ChunkSearchHit[]): SourceItem[] =>
    normalizeScores(
      rows.map((r) =>
        mkItem(r.content, {
          source_path: r.file_path,
          content_type: r.content_type ?? contentTypes[0],
          score: toScore(r.score),
          ingested_at: toIso(r.ingested_at),
        }),
      ),
    );

  if (embedding) {
    const embStr = `[${embedding.join(",")}]`;
    const { rows } = await pool.query<ChunkSearchHit>(
      `WITH vec AS (
         SELECT id, content, file_path, content_type, ingested_at,
                ROW_NUMBER() OVER (ORDER BY embedding <=> $2::vector) AS r
         FROM ${schema}.chunks
         WHERE repo = $1 AND content_type = ANY($3) AND embedding IS NOT NULL
         LIMIT 20
       ),
       kw AS (
         SELECT id, content, file_path, content_type, ingested_at,
                ROW_NUMBER() OVER (ORDER BY ts_rank(search_tsv, websearch_to_tsquery('english', $4)) DESC) AS r
         FROM ${schema}.chunks
         WHERE repo = $1 AND content_type = ANY($3)
           AND search_tsv @@ websearch_to_tsquery('english', $4)
         LIMIT 20
       )
       SELECT COALESCE(v.content, k.content) AS content,
              COALESCE(v.file_path, k.file_path) AS file_path,
              COALESCE(v.content_type, k.content_type) AS content_type,
              COALESCE(v.ingested_at, k.ingested_at) AS ingested_at,
              (COALESCE(1.0 / (60 + v.r), 0) + COALESCE(1.0 / (60 + k.r), 0)) AS score
       FROM vec v FULL OUTER JOIN kw k ON v.id = k.id
       ORDER BY score DESC LIMIT $5`,
      [repo, embStr, contentTypes, keywordQuery, limit],
    );

    return mapRows(rows);
  }

  // Keyword-only fallback (no embedding available).
  const { rows } = await pool.query<ChunkSearchHit>(
    `SELECT content, file_path, content_type, ingested_at,
            ts_rank(search_tsv, websearch_to_tsquery('english', $2)) AS score
     FROM ${schema}.chunks
     WHERE repo = $1 AND content_type = ANY($3)
     ORDER BY score DESC NULLS LAST, ingested_at DESC LIMIT $4`,
    [repo, keywordQuery, contentTypes, limit],
  );

  return mapRows(rows);
}

// ── Source fetchers ─────────────────────────────────────────────────

type SourceFetcher = (
  pool: PgPool,
  query: string,
  repo?: string,
  agentId?: string,
) => Promise<FetchResult>;

// cross_repo has no shipped template section to drive it through assembleContext, hence the direct export.
export const fetchers: Record<string, SourceFetcher> = {
  // Repo conventions: docs + specs (ADRs are their own section); hybrid ranking avoids floating unrelated web-ui specs on term overlap alone.
  async repo(pool, query, repo) {
    if (!repo) {
      return { sources: [], status: "empty" };
    }

    try {
      const sources = await hybridChunkItems(pool, query, repo, {
        contentTypes: ["doc", "spec"],
        limit: 5,
      });

      return { sources, status: sources.length > 0 ? "ok" : "empty" };
    } catch {
      return { sources: [], status: "error" };
    }
  },

  // Source code the task touches — previously NEVER retrieved, so implementation tasks got zero of the files they edit.
  async code(pool, query, repo) {
    if (!repo) {
      return { sources: [], status: "empty" };
    }

    try {
      const sources = await hybridChunkItems(pool, query, repo, {
        contentTypes: ["code"],
        limit: 6,
      });

      return { sources, status: sources.length > 0 ? "ok" : "empty" };
    } catch {
      return { sources: [], status: "error" };
    }
  },

  // ADRs ranked by relevance (hybrid vector+keyword) to the query.
  async adrs(pool, query, repo) {
    if (!repo) {
      return { sources: [], status: "empty" };
    }

    try {
      const sources = await hybridChunkItems(pool, query, repo, {
        contentTypes: ["adr"],
        limit: 10,
      });

      return { sources, status: sources.length > 0 ? "ok" : "empty" };
    } catch {
      return { sources: [], status: "error" };
    }
  },

  async memories(pool, query, _repo, agentId) {
    try {
      const results = await searchMemories(pool, query, {
        agentId,
        limit: 10,
      });

      if (results.length === 0) {
        return { sources: [], status: "empty" };
      }

      const factIds = results
        .filter((r) => r.id && (r.source === "fact" || r.source === "episode"))
        .map((r) => r.id!);
      const conflictSet = new Set<string>();

      if (factIds.length > 0) {
        try {
          const { rows: conflicts } = await pool.query<{
            new_fact_id: string;
          }>(
            `SELECT new_fact_id FROM memory.fact_conflicts
             WHERE new_fact_id = ANY($1) AND created_at > now() - interval '7 days'`,
            [factIds],
          );

          for (const c of conflicts) {
            conflictSet.add(c.new_fact_id);
          }
        } catch {
          /* non-fatal */
        }
      }

      const sources = results.map((r) => {
        const tag = r.confidence ? ` [${r.confidence}]` : "";
        const conflict = r.id && conflictSet.has(r.id) ? " [CONFLICT]" : "";

        return mkItem(
          `**${r.key}** (${r.source})${tag}${conflict}: ${r.value}`,
          {
            source_path: r.key,
            content_type: r.source,
          },
        );
      });

      return { sources, status: "ok" };
    } catch {
      return { sources: [], status: "error" };
    }
  },

  async graph(pool, query, repo) {
    try {
      const words = query
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 3);
      const seen = new Set<string>();
      const sources: SourceItem[] = [];

      for (const word of words.slice(0, 3)) {
        const graphResults = await queryLiveGraph(pool, {
          entity: word,
          repo,
        });

        addUniqueGraphLines(graphResults, seen, sources);
      }

      return { sources, status: sources.length > 0 ? "ok" : "empty" };
    } catch {
      return { sources: [], status: "error" };
    }
  },

  async episodes(pool, query, _repo, agentId) {
    try {
      const results = await searchMemories(pool, query, {
        agentId,
        limit: 5,
      });
      const episodeResults = results.filter((r) => r.source === "episode");

      if (episodeResults.length === 0) {
        return { sources: [], status: "empty" };
      }

      return {
        sources: episodeResults.map((r) =>
          mkItem(`**${r.key}**: ${r.value}`, {
            source_path: r.key,
            content_type: "episode",
          }),
        ),
        status: "ok",
      };
    } catch {
      return { sources: [], status: "error" };
    }
  },

  async rules(pool, query, repo) {
    // Load .claude/rules/*.md files whose filename keyword-matches the query.
    if (!repo) {
      return { sources: [], status: "empty" };
    }

    try {
      const schema = await resolveChunkSchemaForRepo(pool, repo);
      const { rows } = await pool.query<ChunkSearchHit>(
        `SELECT content, file_path FROM ${schema}.chunks
         WHERE repo = $1 AND content_type = 'rule'
         ORDER BY file_path`,
        [repo],
      );

      if (rows.length === 0) {
        return { sources: [], status: "empty" };
      }

      const queryWords = query
        .toLowerCase()
        .split(/\s+/)
        .filter((w: string) => w.length > 2);
      const matched = rows.filter((r) => {
        const ruleName = r.file_path
          .replace(/.*\//, "")
          .replace(/\.md$/, "")
          .toLowerCase();

        return queryWords.some(
          (w: string) => ruleName.includes(w) || w.includes(ruleName),
        );
      });

      // No keyword match is distinct from "no rules exist" — surface it in the trace.
      if (matched.length === 0) {
        return { sources: [], status: "no-match" };
      }

      return {
        sources: matched.map((r) =>
          mkItem(r.content, { source_path: r.file_path, content_type: "rule" }),
        ),
        status: "ok",
      };
    } catch {
      return { sources: [], status: "error" };
    }
  },

  async cross_repo(pool, query, repo) {
    if (!repo) {
      return { sources: [], status: "empty" };
    }

    try {
      const [{ rows: repoRows }, schemas] = await Promise.all([
        pool.query<{ settings: { cross_repo_repos?: string[] } | null }>(
          `SELECT settings FROM lore.repos WHERE full_name = $1`,
          [repo],
        ),
        listChunkSchemas(pool),
      ]);
      const linkedRepos: string[] =
        repoRows[0]?.settings?.cross_repo_repos || [];

      // Linked repos may live in any team schema, so the search spans every provisioned chunk schema plus org_shared.
      const repoFilter =
        linkedRepos.length > 0 ? "repo = ANY($1)" : "repo != $1";
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

      if (rows.length === 0) {
        return { sources: [], status: "empty" };
      }
      // Only portable, high-transfer-score content from other repos passes through.
      const scored = rows
        .map((r) => ({
          ...r,
          transferScore: computeTransferScore(r.content),
        }))
        .filter((r) => r.transferScore >= 0.5);

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
    } catch {
      return { sources: [], status: "error" };
    }
  },

  async incidents(pool, _query, repo) {
    if (!repo) {
      return { sources: [], status: "empty" };
    }

    try {
      const { rows } = await pool.query<{
        settings: { incidents?: Incident[] } | null;
      }>(`SELECT settings FROM lore.repos WHERE full_name = $1`, [repo]);
      const settings = rows[0]?.settings;

      if (
        !settings?.incidents ||
        !Array.isArray(settings.incidents) ||
        settings.incidents.length === 0
      ) {
        return { sources: [], status: "empty" };
      }
      const cutoff = Date.now() - 30 * 86400000;
      const recent = settings.incidents.filter(
        (i) => new Date(i.date).getTime() > cutoff,
      );

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
    } catch {
      return { sources: [], status: "error" };
    }
  },
};

// ── Main assembly ───────────────────────────────────────────────────

// Per-template default token budgets; research keeps the old 16K ceiling since it's memory/episode-heavy.
const TEMPLATE_DEFAULT_BUDGETS: Record<string, number> = {
  default: 8000,
  implementation: 8000,
  review: 8000,
  research: 16000,
};

const STATUS_REASON: Record<FetchStatus, string> = {
  ok: "",
  empty: "no results",
  error: "source error",
  "no-match": "no rule matched the query",
  disabled: "source disabled",
};

const STALE_AGE_MS = 7 * 86400000;

export function computeFreshness(
  lastIngestedAt: Date | string | null,
  now: Date,
): "fresh" | "stale" | "never-ingested" {
  if (!lastIngestedAt) {
    return "never-ingested";
  }

  const age = now.getTime() - new Date(lastIngestedAt).getTime();

  return age > STALE_AGE_MS ? "stale" : "fresh";
}

function freshnessForRepo(
  row: { last_ingested_at: string | Date | null } | undefined,
  now: Date,
): { state: string; warning: string } {
  if (!row) {
    return {
      state: "first-run",
      warning: `> **Welcome to Lore!** This repo is not yet onboarded.\n> Suggested actions:\n> 1. Call \`lore_onboard_repo\` to generate CLAUDE.md and register the repo\n> 2. Call \`lore_ingest_files\` to manually add specific files\n> 3. Call \`lore_search_memory\` to check if others have left learnings\n\n`,
    };
  }
  const lastIngestedAt = row.last_ingested_at;
  const state = computeFreshness(lastIngestedAt, now);

  if (state === "never-ingested") {
    return {
      state,
      warning: `> ⚠ **Context may be stale** — this repo has never been ingested. Run \`lore_ingest_files\` or wait for the nightly reindex.\n\n`,
    };
  }

  if (state === "stale" && lastIngestedAt) {
    const days = Math.floor(
      (now.getTime() - new Date(lastIngestedAt).getTime()) / 86400000,
    );

    return {
      state,
      warning: `> ⚠ **Context may be stale** — last ingested ${days} days ago.\n\n`,
    };
  }

  return { state, warning: "" };
}

interface SectionFit {
  allocatedBudget: number;
  finalTokens: number;
  truncated: boolean;
  included: boolean;
  omitReason?: string;
  keptItems: SourceItem[];
}

/** Budget one section's deduped items: how much it gets, what survives, why it was omitted. Pure — the caller applies the deduction. */
/** What is left to hand out and how this section's share of it is weighted. */
interface SectionBudget {
  remaining: number;
  minTokens: number;
  nonEmptyWeight: number;
}

function fitSection(
  deduped: SourceItem[],
  status: FetchStatus,
  section: { priority: number; max_tokens?: number },
  { remaining, minTokens, nonEmptyWeight }: SectionBudget,
): SectionFit {
  const excluded = {
    allocatedBudget: 0,
    finalTokens: 0,
    truncated: false,
    included: false,
    keptItems: [] as SourceItem[],
  };

  if (deduped.length === 0) {
    return { ...excluded, omitReason: STATUS_REASON[status] || "empty" };
  }

  if (remaining <= 0) {
    return { ...excluded, omitReason: "budget exhausted" };
  }
  const weight = (6 - section.priority) / nonEmptyWeight;
  const allocatedBudget = Math.min(
    section.max_tokens ?? Infinity,
    Math.floor(minTokens * weight * 1.5), // allow some per-section overflow
    remaining,
  );

  if (allocatedBudget <= 100) {
    return { ...excluded, allocatedBudget, omitReason: "budget exhausted" };
  }
  // Cap any single competing document to half the budget so a mega-doc can't crowd out smaller ones; a lone document keeps it all.
  const perDocCap =
    deduped.length > 1 ? Math.floor(allocatedBudget * 0.5) : undefined;
  const fit = fitItemsToBudget(deduped, allocatedBudget, perDocCap);

  return {
    allocatedBudget,
    finalTokens: fit.kept.reduce((sum, i) => sum + i.tokens, 0),
    truncated: fit.truncated,
    included: fit.kept.length > 0,
    keptItems: fit.kept,
  };
}

/** Route one section to its source; the coupling source reads the spec-traceability graph (Dgraph), not the Postgres pool. */
async function fetchSectionSource(
  source: string,
  fetcher: SourceFetcher | undefined,
  ctx: {
    pool: PgPool;
    dgraph: DgraphClientPort | null | undefined;
    query: string;
    repo?: string;
    agentId?: string;
  },
): Promise<FetchResult> {
  if (source === "coupling") {
    return fetchCouplingSource(ctx.dgraph ?? null, ctx.repo);
  }

  if (fetcher) {
    return fetcher(ctx.pool, ctx.query, ctx.repo, ctx.agentId);
  }

  return { sources: [], status: "error" };
}

interface FreshnessInfo {
  state: string;
  warning: string;
}

async function resolveFreshness(
  pool: PgPool,
  repo: string | undefined,
): Promise<FreshnessInfo> {
  if (!repo) {
    return { state: "unknown", warning: "" };
  }

  try {
    const { rows } = await pool.query<{
      last_ingested_at: string | Date | null;
    }>(`SELECT last_ingested_at FROM lore.repos WHERE full_name = $1`, [repo]);

    return freshnessForRepo(rows[0], new Date());
  } catch {
    return { state: "unknown", warning: "" };
  }
}

function resolveEffectiveMax(
  templateName: string,
  maxTokens: number | undefined,
): number {
  return maxTokens ?? TEMPLATE_DEFAULT_BUDGETS[templateName] ?? 8000;
}

interface SectionFetchContext {
  pool: PgPool;
  dgraph: DgraphClientPort | null | undefined;
  query: string;
  repo?: string;
  agentId?: string;
}

interface FetchedSection {
  section: TemplateSection;
  res: FetchResult;
}

/** Fetch every active section in parallel, timing each; a fetcher throwing counts as an empty error result rather than failing the whole assembly. */
async function fetchAllSections(
  activeSections: TemplateSection[],
  ctx: SectionFetchContext,
  timings: Record<string, number>,
): Promise<FetchedSection[]> {
  return Promise.all(
    activeSections.map(async (section) => {
      const t0 = Date.now();
      const fetcher = fetchers[section.source];
      let res: FetchResult;

      try {
        res = await fetchSectionSource(section.source, fetcher, ctx);
      } catch {
        res = { sources: [], status: "error" };
      }
      timings[section.source] = Date.now() - t0;

      return { section, res };
    }),
  );
}

function computeNonEmptyWeight(fetched: FetchedSection[]): number {
  return (
    fetched
      .filter((f) => f.res.sources.length > 0)
      .reduce((sum, f) => sum + (6 - f.section.priority), 0) || 1
  );
}

function buildSerializedSection(
  section: TemplateSection,
  fit: SectionFit,
): SerializedSection {
  return {
    header: section.header,
    source: section.source,
    priority: section.priority,
    documents: fit.keptItems,
    truncated: fit.truncated,
  };
}

interface SectionFitOutcome {
  section: TemplateSection;
  res: FetchResult;
  fit: SectionFit;
  deduped: SourceItem[];
  rawTokens: number;
}

function buildTraceSection(outcome: SectionFitOutcome): TraceSection {
  const { section, res, fit, deduped, rawTokens } = outcome;

  return {
    header: section.header,
    source: section.source,
    priority: section.priority,
    status: res.status,
    allocatedBudget: Number.isFinite(fit.allocatedBudget)
      ? fit.allocatedBudget
      : (section.max_tokens ?? 0),
    rawTokens,
    finalTokens: fit.finalTokens,
    truncated: fit.truncated,
    included: fit.included,
    omitReason: fit.omitReason,
    items: fit.included ? fit.keptItems : deduped,
  };
}

interface AllocatedSections {
  serialized: SerializedSection[];
  traceSections: TraceSection[];
}

/** Allocate the token budget by priority (lower number = larger share), highest first, deducting as we go. A document is emitted in its highest-priority section only — no repeats across sections. */
function allocateSections(
  fetched: FetchedSection[],
  minTokens: number,
): AllocatedSections {
  const nonEmptyWeight = computeNonEmptyWeight(fetched);
  const ordered = [...fetched].sort(
    (a, b) => a.section.priority - b.section.priority,
  );

  let remaining = minTokens;
  const serialized: SerializedSection[] = [];
  const traceSections: TraceSection[] = [];
  const seenAcrossSections = new Set<string>();

  for (const { section, res } of ordered) {
    const deduped = dropSeen(dedupeItems(res.sources), seenAcrossSections);
    const rawTokens = deduped.reduce((sum, i) => sum + i.tokens, 0);
    const fit = fitSection(deduped, res.status, section, {
      remaining,
      minTokens,
      nonEmptyWeight,
    });

    if (fit.included) {
      remaining -= fit.finalTokens;
      serialized.push(buildSerializedSection(section, fit));
    }

    traceSections.push(
      buildTraceSection({ section, res, fit, deduped, rawTokens }),
    );
  }

  return { serialized, traceSections };
}

interface AssembledRefs {
  factIds: string[];
  memoryIds: string[];
}

const emptyAssembledRefs: AssembledRefs = { factIds: [], memoryIds: [] };

/** Context refs for outcome feedback; a search failure is non-fatal — the assembly still returns without refs. */
async function collectAssembledRefs(
  pool: PgPool,
  query: string,
  agentId: string | undefined,
): Promise<AssembledRefs> {
  const factIds: string[] = [];
  const memoryIds: string[] = [];

  try {
    const results = await searchMemories(pool, query, { agentId, limit: 20 });

    collectContextRefIds(results, memoryIds, factIds);
  } catch {
    /* non-fatal */
  }

  return { factIds, memoryIds };
}

function applyContextRefs(result: AssembledResult, refs: AssembledRefs): void {
  if (refs.factIds.length > 0 || refs.memoryIds.length > 0) {
    result.context_refs = {
      fact_ids: refs.factIds,
      memory_ids: refs.memoryIds,
    };
  }
}

interface DebugTraceInput {
  query: string;
  templateName: string;
  minTokens: number;
  crossRepo: boolean | undefined;
  template: Template;
  traceSections: TraceSection[];
  sections: { header: string; tokens: number; truncated: boolean }[];
  freshness: FreshnessInfo;
  startedAt: number;
  timings: Record<string, number>;
}

function buildAssemblyTrace(input: DebugTraceInput): AssemblyTrace {
  const used = input.sections.reduce((sum, s) => sum + s.tokens, 0);

  return {
    query: input.query,
    template: input.templateName,
    effectiveBudget: input.minTokens,
    crossRepo: !!input.crossRepo,
    templateSections: input.template.sections.map((s) => ({
      header: s.header,
      source: s.source,
      priority: s.priority,
      max_tokens: s.max_tokens,
    })),
    sections: input.traceSections,
    budget: {
      total: input.minTokens,
      used,
      leftover: Math.max(0, input.minTokens - used),
    },
    freshness: {
      state: input.freshness.state,
      message: input.freshness.warning.trim(),
    },
    timingsMs: {
      total: Date.now() - input.startedAt,
      perSource: input.timings,
    },
  };
}

export interface AssembleOptions {
  templateName?: string;
  maxTokens?: number;
  repo?: string;
  agentId?: string;
  crossRepo?: boolean;
  includeIds?: boolean;
  debug?: boolean;
  dgraph?: DgraphClientPort | null;
}

export async function assembleContext(
  pool: PgPool,
  query: string,
  {
    templateName = "default",
    maxTokens,
    repo,
    agentId,
    crossRepo,
    includeIds,
    debug,
    dgraph,
  }: AssembleOptions = {},
): Promise<AssembledResult> {
  const startedAt = Date.now();
  const template = getTemplate(templateName);
  const minTokens = Math.max(
    resolveEffectiveMax(templateName, maxTokens),
    2000,
  );
  const freshness = await resolveFreshness(pool, repo);

  // cross_repo is only consulted when explicitly requested.
  const activeSections = template.sections.filter(
    (s) => s.source !== "cross_repo" || crossRepo,
  );
  const timings: Record<string, number> = {};
  const fetched = await fetchAllSections(
    activeSections,
    { pool, dgraph, query, repo, agentId },
    timings,
  );
  const { serialized, traceSections } = allocateSections(fetched, minTokens);
  const refs = includeIds
    ? await collectAssembledRefs(pool, query, agentId)
    : emptyAssembledRefs;

  // Build the final XML-tagged text.
  const body = serializeContext(
    { query, template: templateName, budget: minTokens },
    serialized,
  );
  const text =
    serialized.length > 0 ? freshness.warning + body : freshness.warning;
  const sections = serialized.map((s) => ({
    header: s.header,
    tokens: s.documents.reduce((sum, i) => sum + i.tokens, 0),
    truncated: s.truncated,
  }));
  const result: AssembledResult = { text, sections };

  if (debug) {
    result.trace = buildAssemblyTrace({
      query,
      templateName,
      minTokens,
      crossRepo,
      template,
      traceSections,
      sections,
      freshness,
      startedAt,
      timings,
    });
  }
  applyContextRefs(result, refs);

  return result;
}

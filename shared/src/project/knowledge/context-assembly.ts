/**
 * Context assembly: retrieves from all sources and formats into
 * a structured, token-budgeted block for LLM consumption.
 *
 * Sources return provenance-bearing items (path, type, tokens, relevance) plus a
 * status that explains emptiness, so every assembly decision is traceable. The
 * output is XML-tagged (see context-assembly-format.ts), and a `debug` flag adds
 * a full trace of what each source returned, how the budget was split, and what
 * was truncated or omitted.
 *
 * Templates are YAML files loaded at startup from mcp-server/templates/.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { searchMemories } from './memory-search.js';
import { computeTransferScore } from '../../memory-ranking.js';
import { queryLiveGraph } from './live-graph.js';
import { getQueryEmbedding } from '../../embeddings/embedding-service.js';
import {
  dedupeItems,
  serializeContext,
  type SourceItem,
  type SerializedSection,
} from './context-assembly-format.js';

// ── Types ───────────────────────────────────────────────────────────

interface TemplateSection {
  header: string;
  source: 'repo' | 'code' | 'adrs' | 'memories' | 'graph' | 'episodes' | 'rules' | 'cross_repo' | 'incidents';
  priority: number;
  max_tokens?: number;
}

interface Template {
  name: string;
  description: string;
  sections: TemplateSection[];
}

export type FetchStatus = 'ok' | 'empty' | 'error' | 'no-match' | 'disabled';

export interface FetchResult {
  items: SourceItem[];
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
  templateSections: { header: string; source: string; priority: number; max_tokens?: number }[];
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
  const templateDir = dir || join(import.meta.dirname || process.cwd(), '..', 'templates');
  if (!existsSync(templateDir)) {
    console.warn(`[context-assembly] Templates directory not found: ${templateDir}`);
    return;
  }

  const files = readdirSync(templateDir).filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));
  for (const file of files) {
    try {
      const raw = readFileSync(join(templateDir, file), 'utf-8');
      const template = parseYaml(raw) as Template;
      if (template.name && template.sections) {
        templates.set(template.name, template);
      }
    } catch (err) {
      console.warn(`[context-assembly] Failed to load template ${file}:`, err);
    }
  }
  console.log(`[context-assembly] Loaded ${templates.size} templates: ${[...templates.keys()].join(', ')}`);
}

function getTemplate(name: string): Template {
  return templates.get(name) || templates.get('default') || {
    name: 'default',
    description: 'Fallback template',
    sections: [
      { header: 'Conventions', source: 'repo' as const, priority: 1 },
      { header: 'Agent Memory', source: 'memories' as const, priority: 2 },
    ],
  };
}

// ── Token estimation + item helpers ─────────────────────────────────

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Truncate at a paragraph boundary to fit a token budget — no inline marker;
 *  the `truncated="true"` document attribute carries that signal instead. */
function truncateText(text: string, maxTokens: number): string {
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) return text;
  const cut = text.substring(0, maxChars);
  const lastParagraph = cut.lastIndexOf('\n\n');
  return lastParagraph > maxChars * 0.5 ? cut.substring(0, lastParagraph) : cut;
}

function mkItem(text: string, extra: Partial<SourceItem> = {}): SourceItem {
  return { text, tokens: estimateTokens(text), ...extra };
}

function toScore(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : value != null ? Number(value) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

function toIso(value: unknown): string | undefined {
  if (!value) return undefined;
  try {
    return new Date(value as string | number | Date).toISOString();
  } catch {
    return undefined;
  }
}

/** Pack items into a token budget: keep whole items until the budget is hit,
 *  truncate the one that overflows, drop the rest. Reports whether anything was cut.
 *  `maxPerDocTokens` caps any single document so one mega-doc (e.g. CLAUDE.md)
 *  can't crowd out several smaller, more-relevant chunks — a capped doc is
 *  truncated and packing continues with the next items. Exported for unit tests. */
export function fitItemsToBudget(
  items: SourceItem[],
  budgetTokens: number,
  maxPerDocTokens?: number,
): { items: SourceItem[]; truncated: boolean } {
  const kept: SourceItem[] = [];
  let used = 0;
  let truncated = false;
  for (const it of items) {
    const remaining = budgetTokens - used;
    if (remaining <= 0) {
      truncated = true;
      break;
    }
    const limit = Math.min(remaining, maxPerDocTokens ?? Infinity);
    if (it.tokens <= limit) {
      kept.push(it);
      used += it.tokens;
    } else {
      const text = truncateText(it.text, limit);
      const tokens = estimateTokens(text);
      kept.push({ ...it, text, tokens });
      used += tokens;
      truncated = true;
      // Stop only when the BUDGET was the binding limit; a per-doc cap leaves
      // room, so keep packing more documents.
      if (limit >= remaining) break;
    }
  }
  return { items: kept, truncated };
}

// Common words that add no retrieval signal — dropped from the keyword leg so a
// paragraph-length query matches on its distinctive terms, not its filler.
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'to', 'for', 'of', 'in', 'on', 'at', 'by', 'with', 'from',
  'that', 'this', 'these', 'those', 'is', 'are', 'be', 'as', 'it', 'its', 'into', 'via', 'per',
  'add', 'use', 'using', 'new', 'update', 'edit', 'change', 'make', 'set', 'get', 'also', 'should',
  'would', 'can', 'will', 'not', 'but', 'so', 'if', 'when', 'then', 'than', 'they', 'their',
  'you', 'your', 'we', 'our',
]);

/** Distinctive terms from a (possibly paragraph-length) query: drop stopwords and
 *  ≤2-char words, de-duplicate (case-insensitive), preserve order, cap at `max`.
 *  Used to focus the keyword retrieval leg. Exported for unit tests. */
export function extractKeyTerms(query: string, max = 12): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of query.split(/[^A-Za-z0-9_.-]+/)) {
    const lower = raw.toLowerCase();
    if (lower.length <= 2 || STOPWORDS.has(lower) || seen.has(lower)) continue;
    seen.add(lower);
    out.push(raw);
    if (out.length >= max) break;
  }
  return out;
}

/** Filter out items already emitted in an earlier section (keyed by source path,
 *  else text), recording the survivors as seen. Keeps a document in its highest-
 *  priority section only — no duplicate across sections. Exported for unit tests. */
export function dropSeen(items: SourceItem[], seen: Set<string>): SourceItem[] {
  const kept: SourceItem[] = [];
  for (const it of items) {
    const key = it.source_path || it.text;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(it);
  }
  return kept;
}

/** Rescale item scores so the top result is 1.0 and the rest are proportional
 *  fractions — RRF/`ts_rank` raw scores are tiny (~0.02) and unreadable as a
 *  relevance signal. No-op when there is no positive score. */
function normalizeScores(items: SourceItem[]): SourceItem[] {
  const max = Math.max(0, ...items.map((i) => i.score ?? 0));
  if (max <= 0) return items;
  return items.map((i) => (i.score != null ? { ...i, score: i.score / max } : i));
}

/** Hybrid Reciprocal-Rank-Fusion retrieval over `org_shared.chunks` for a repo +
 *  content types. Combines a pgvector cosine leg with a BM25 (`ts_rank`) leg —
 *  the same RRF that powers `search_context` — so a natural-language query
 *  surfaces semantically-relevant chunks (incl. code), not just keyword overlap.
 *  Degrades to keyword-only when no query embedding is available. Exported for
 *  unit tests. */
export async function hybridChunkItems(
  pool: any,
  query: string,
  repo: string,
  contentTypes: string[],
  limit: number,
): Promise<SourceItem[]> {
  const embedding = await getQueryEmbedding(query);
  // The keyword leg searches the query's distinctive terms (OR'd) rather than the
  // whole paragraph, which would AND every filler word and match almost nothing.
  const keywordQuery = extractKeyTerms(query).join(' OR ') || query;
  const mapRows = (rows: any[]): SourceItem[] =>
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
    const embStr = `[${embedding.join(',')}]`;
    const { rows } = await pool.query(
      `WITH vec AS (
         SELECT id, content, file_path, content_type, ingested_at,
                ROW_NUMBER() OVER (ORDER BY embedding <=> $2::vector) AS r
         FROM org_shared.chunks
         WHERE repo = $1 AND content_type = ANY($3) AND embedding IS NOT NULL
         LIMIT 20
       ),
       kw AS (
         SELECT id, content, file_path, content_type, ingested_at,
                ROW_NUMBER() OVER (ORDER BY ts_rank(search_tsv, websearch_to_tsquery('english', $4)) DESC) AS r
         FROM org_shared.chunks
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
  const { rows } = await pool.query(
    `SELECT content, file_path, content_type, ingested_at,
            ts_rank(search_tsv, websearch_to_tsquery('english', $2)) AS score
     FROM org_shared.chunks
     WHERE repo = $1 AND content_type = ANY($3)
     ORDER BY score DESC NULLS LAST, ingested_at DESC LIMIT $4`,
    [repo, keywordQuery, contentTypes, limit],
  );
  return mapRows(rows);
}

// ── Source fetchers ─────────────────────────────────────────────────

type SourceFetcher = (pool: any, query: string, repo?: string, agentId?: string) => Promise<FetchResult>;

const fetchers: Record<string, SourceFetcher> = {
  // Repo conventions: docs + specs (ADRs are their own section). Hybrid
  // vector+keyword ranking so a natural-language query matches on meaning, not
  // just term overlap (which floated unrelated web-ui specs to the top).
  async repo(pool, query, repo) {
    if (!repo) return { items: [], status: 'empty' };
    try {
      const items = await hybridChunkItems(pool, query, repo, ['doc', 'spec'], 5);
      return { items, status: items.length > 0 ? 'ok' : 'empty' };
    } catch {
      return { items: [], status: 'error' };
    }
  },

  // Source code the task touches — previously NEVER retrieved (the repo source
  // excluded code), so implementation tasks got zero of the files they edit.
  async code(pool, query, repo) {
    if (!repo) return { items: [], status: 'empty' };
    try {
      const items = await hybridChunkItems(pool, query, repo, ['code'], 6);
      return { items, status: items.length > 0 ? 'ok' : 'empty' };
    } catch {
      return { items: [], status: 'error' };
    }
  },

  // ADRs ranked by relevance (hybrid vector+keyword) to the query.
  async adrs(pool, query, repo) {
    if (!repo) return { items: [], status: 'empty' };
    try {
      const items = await hybridChunkItems(pool, query, repo, ['adr'], 10);
      return { items, status: items.length > 0 ? 'ok' : 'empty' };
    } catch {
      return { items: [], status: 'error' };
    }
  },

  async memories(pool, query, _repo, agentId) {
    try {
      const results = await searchMemories(pool, query, agentId, undefined, 10, false);
      if (results.length === 0) return { items: [], status: 'empty' };

      const factIds = results
        .filter(r => r.id && (r.source === 'fact' || r.source === 'episode'))
        .map(r => r.id!);
      const conflictSet = new Set<string>();
      if (factIds.length > 0) {
        try {
          const { rows: conflicts } = await pool.query(
            `SELECT new_fact_id FROM memory.fact_conflicts
             WHERE new_fact_id = ANY($1) AND created_at > now() - interval '7 days'`,
            [factIds],
          );
          for (const c of conflicts) conflictSet.add(c.new_fact_id);
        } catch { /* non-fatal */ }
      }

      const items = results.map(r => {
        const tag = r.confidence ? ` [${r.confidence}]` : '';
        const conflict = r.id && conflictSet.has(r.id) ? ' [CONFLICT]' : '';
        return mkItem(`**${r.key}** (${r.source})${tag}${conflict}: ${r.value}`, {
          source_path: r.key,
          content_type: r.source,
        });
      });
      return { items, status: 'ok' };
    } catch {
      return { items: [], status: 'error' };
    }
  },

  async graph(pool, query, repo) {
    try {
      const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 3);
      const seen = new Set<string>();
      const items: SourceItem[] = [];
      for (const word of words.slice(0, 3)) {
        const graphResults = await queryLiveGraph(pool, word, undefined, repo, false);
        for (const r of graphResults) {
          const line = `${r.entity} (${r.entity_type}) --${r.relation}--> ${r.related_entity} (${r.related_type})`;
          if (seen.has(line)) continue;
          seen.add(line);
          items.push(mkItem(line, { content_type: 'graph' }));
        }
      }
      return { items, status: items.length > 0 ? 'ok' : 'empty' };
    } catch {
      return { items: [], status: 'error' };
    }
  },

  async episodes(pool, query, _repo, agentId) {
    try {
      const results = await searchMemories(pool, query, agentId, undefined, 5, false);
      const episodeResults = results.filter(r => r.source === 'episode');
      if (episodeResults.length === 0) return { items: [], status: 'empty' };
      return {
        items: episodeResults.map(r =>
          mkItem(`**${r.key}**: ${r.value}`, { source_path: r.key, content_type: 'episode' }),
        ),
        status: 'ok',
      };
    } catch {
      return { items: [], status: 'error' };
    }
  },

  async rules(pool, query, repo) {
    // Load .claude/rules/*.md files whose filename keyword-matches the query.
    if (!repo) return { items: [], status: 'empty' };
    try {
      const { rows } = await pool.query(
        `SELECT content, file_path FROM org_shared.chunks
         WHERE repo = $1 AND content_type = 'rule'
         ORDER BY file_path`,
        [repo],
      );
      if (rows.length === 0) return { items: [], status: 'empty' };

      const queryWords = query.toLowerCase().split(/\s+/).filter((w: string) => w.length > 2);
      const matched = rows.filter((r: any) => {
        const ruleName = r.file_path.replace(/.*\//, '').replace(/\.md$/, '').toLowerCase();
        return queryWords.some((w: string) => ruleName.includes(w) || w.includes(ruleName));
      });
      // No keyword match is distinct from "no rules exist" — surface it in the trace.
      if (matched.length === 0) return { items: [], status: 'no-match' };

      return {
        items: matched.map((r: any) => mkItem(r.content, { source_path: r.file_path, content_type: 'rule' })),
        status: 'ok',
      };
    } catch {
      return { items: [], status: 'error' };
    }
  },

  async cross_repo(pool, query, repo) {
    if (!repo) return { items: [], status: 'empty' };
    try {
      const { rows: repoRows } = await pool.query(
        `SELECT settings FROM lore.repos WHERE full_name = $1`, [repo],
      );
      const linkedRepos: string[] = repoRows[0]?.settings?.cross_repo_repos || [];

      let rows: any[];
      if (linkedRepos.length > 0) {
        const result = await pool.query(
          `SELECT content, repo, file_path, ts_rank(search_tsv, plainto_tsquery($2)) AS score
           FROM org_shared.chunks
           WHERE repo = ANY($1) AND search_tsv @@ plainto_tsquery($2)
           ORDER BY score DESC LIMIT 5`,
          [linkedRepos, query],
        );
        rows = result.rows;
      } else {
        const result = await pool.query(
          `SELECT content, repo, file_path, ts_rank(search_tsv, plainto_tsquery($2)) AS score
           FROM org_shared.chunks
           WHERE repo != $1 AND search_tsv @@ plainto_tsquery($2)
           ORDER BY score DESC LIMIT 5`,
          [repo, query],
        );
        rows = result.rows;
      }
      if (rows.length === 0) return { items: [], status: 'empty' };
      // Only portable, high-transfer-score content from other repos passes through.
      const scored = rows
        .map((r: any) => ({ ...r, transferScore: computeTransferScore(r.content) }))
        .filter((r: any) => r.transferScore >= 0.5);
      if (scored.length === 0) return { items: [], status: 'empty' };
      return {
        items: scored.map((r: any) =>
          mkItem(r.content, {
            source_path: r.file_path,
            repo: r.repo,
            content_type: 'cross_repo',
            score: toScore(r.score),
          }),
        ),
        status: 'ok',
      };
    } catch {
      return { items: [], status: 'error' };
    }
  },

  async incidents(pool, _query, repo) {
    if (!repo) return { items: [], status: 'empty' };
    try {
      const { rows } = await pool.query(
        `SELECT settings FROM lore.repos WHERE full_name = $1`, [repo],
      );
      const settings = rows[0]?.settings;
      if (!settings?.incidents || !Array.isArray(settings.incidents) || settings.incidents.length === 0) {
        return { items: [], status: 'empty' };
      }
      const cutoff = Date.now() - 30 * 86400000;
      const recent = settings.incidents.filter((i: any) => new Date(i.date).getTime() > cutoff);
      if (recent.length === 0) return { items: [], status: 'empty' };
      return {
        items: recent.map((i: any) =>
          mkItem(
            `- **${i.severity || 'unknown'}**: ${i.title}${i.resolved ? ' (resolved)' : ''} — ${i.date}${i.url ? ` [link](${i.url})` : ''}`,
            { content_type: 'incident' },
          ),
        ),
        status: 'ok',
      };
    } catch {
      return { items: [], status: 'error' };
    }
  },
};

// ── Main assembly ───────────────────────────────────────────────────

// Per-template default token budgets. Smaller budgets for task-shaped
// templates; research keeps the old 16K ceiling since it's memory/episode-heavy.
const TEMPLATE_DEFAULT_BUDGETS: Record<string, number> = {
  default: 8000,
  implementation: 8000,
  review: 8000,
  research: 16000,
};

const STATUS_REASON: Record<FetchStatus, string> = {
  ok: '',
  empty: 'no results',
  error: 'source error',
  'no-match': 'no rule matched the query',
  disabled: 'source disabled',
};

export async function assembleContext(
  pool: any,
  query: string,
  templateName: string = 'default',
  maxTokens?: number,
  repo?: string,
  agentId?: string,
  crossRepo?: boolean,
  includeIds?: boolean,
  debug?: boolean,
): Promise<AssembledResult> {
  const startedAt = Date.now();
  const template = getTemplate(templateName);
  const effectiveMax = maxTokens ?? TEMPLATE_DEFAULT_BUDGETS[templateName] ?? 8000;
  const minTokens = Math.max(effectiveMax, 2000);

  // Check context freshness + first-run status
  let freshnessWarning = '';
  let freshnessState = 'unknown';
  if (repo) {
    try {
      const { rows } = await pool.query(
        `SELECT last_ingested_at FROM lore.repos WHERE full_name = $1`, [repo],
      );
      if (rows.length === 0) {
        freshnessState = 'first-run';
        freshnessWarning = `> **Welcome to Lore!** This repo is not yet onboarded.\n> Suggested actions:\n> 1. Call \`lore_onboard_repo\` to generate CLAUDE.md and register the repo\n> 2. Call \`lore_ingest_files\` to manually add specific files\n> 3. Call \`lore_search_memory\` to check if others have left learnings\n\n`;
      } else if (!rows[0].last_ingested_at) {
        freshnessState = 'never-ingested';
        freshnessWarning = `> ⚠ **Context may be stale** — this repo has never been ingested. Run \`lore_ingest_files\` or wait for the nightly reindex.\n\n`;
      } else {
        const age = Date.now() - new Date(rows[0].last_ingested_at).getTime();
        if (age > 7 * 86400000) {
          const days = Math.floor(age / 86400000);
          freshnessState = 'stale';
          freshnessWarning = `> ⚠ **Context may be stale** — last ingested ${days} days ago.\n\n`;
        } else {
          freshnessState = 'fresh';
        }
      }
    } catch { /* non-fatal */ }
  }

  // Track assembled IDs for outcome feedback
  const collectedFactIds: string[] = [];
  const collectedMemoryIds: string[] = [];

  // cross_repo is only consulted when explicitly requested.
  const activeSections = template.sections.filter(s => s.source !== 'cross_repo' || crossRepo);

  // Fetch all sources in parallel, timing each.
  const timings: Record<string, number> = {};
  const fetched = await Promise.all(
    activeSections.map(async (section) => {
      const t0 = Date.now();
      const fetcher = fetchers[section.source];
      let res: FetchResult;
      try {
        res = fetcher ? await fetcher(pool, query, repo, agentId) : { items: [], status: 'error' };
      } catch {
        res = { items: [], status: 'error' };
      }
      timings[section.source] = Date.now() - t0;
      return { section, res };
    }),
  );

  // Allocate the token budget by priority (higher priority = lower number =
  // larger share), highest-priority first, deducting as we go.
  const nonEmptyWeight = fetched
    .filter(f => f.res.items.length > 0)
    .reduce((sum, f) => sum + (6 - f.section.priority), 0) || 1;
  const ordered = [...fetched].sort((a, b) => a.section.priority - b.section.priority);

  let remaining = minTokens;
  const serialized: SerializedSection[] = [];
  const traceSections: TraceSection[] = [];
  // A document is emitted in its highest-priority section only — no repeats
  // across sections (e.g. the same episode in both Agent Memory and Recent Episodes).
  const seenAcrossSections = new Set<string>();

  for (const { section, res } of ordered) {
    const deduped = dropSeen(dedupeItems(res.items), seenAcrossSections);
    const rawTokens = deduped.reduce((sum, i) => sum + i.tokens, 0);

    let allocatedBudget = 0;
    let finalTokens = 0;
    let truncated = false;
    let included = false;
    let omitReason: string | undefined;
    let keptItems: SourceItem[] = [];

    if (deduped.length === 0) {
      omitReason = STATUS_REASON[res.status] || 'empty';
    } else if (remaining <= 0) {
      omitReason = 'budget exhausted';
    } else {
      const weight = (6 - section.priority) / nonEmptyWeight;
      allocatedBudget = Math.min(
        section.max_tokens ?? Infinity,
        Math.floor(minTokens * weight * 1.5), // allow some per-section overflow
        remaining,
      );
      if (allocatedBudget <= 100) {
        omitReason = 'budget exhausted';
      } else {
        // When documents compete for a section, cap any single one to half the
        // budget so a mega-doc (e.g. CLAUDE.md) can't crowd out smaller, more-
        // relevant chunks. A lone document keeps the whole budget.
        const perDocCap = deduped.length > 1 ? Math.floor(allocatedBudget * 0.5) : undefined;
        const fit = fitItemsToBudget(deduped, allocatedBudget, perDocCap);
        keptItems = fit.items;
        truncated = fit.truncated;
        finalTokens = keptItems.reduce((sum, i) => sum + i.tokens, 0);
        included = keptItems.length > 0;
        if (included) {
          remaining -= finalTokens;
          serialized.push({
            header: section.header,
            source: section.source,
            priority: section.priority,
            items: keptItems,
            truncated,
          });
        }
      }
    }

    traceSections.push({
      header: section.header,
      source: section.source,
      priority: section.priority,
      status: res.status,
      allocatedBudget: Number.isFinite(allocatedBudget) ? allocatedBudget : (section.max_tokens ?? 0),
      rawTokens,
      finalTokens,
      truncated,
      included,
      omitReason,
      items: included ? keptItems : deduped,
    });
  }

  // Collect context refs for outcome feedback
  if (includeIds) {
    try {
      const results = await searchMemories(pool, query, agentId, undefined, 20, false);
      for (const r of results) {
        if (!r.id) continue;
        if (r.source === 'memory') collectedMemoryIds.push(r.id);
        else collectedFactIds.push(r.id);
      }
    } catch { /* non-fatal */ }
  }

  // Build the final XML-tagged text.
  const body = serializeContext({ query, template: templateName, budget: minTokens }, serialized);
  const text = serialized.length > 0 ? freshnessWarning + body : freshnessWarning;

  const sections = serialized.map(s => ({
    header: s.header,
    tokens: s.items.reduce((sum, i) => sum + i.tokens, 0),
    truncated: s.truncated,
  }));

  const result: AssembledResult = { text, sections };

  if (debug) {
    const used = sections.reduce((sum, s) => sum + s.tokens, 0);
    result.trace = {
      query,
      template: templateName,
      effectiveBudget: minTokens,
      crossRepo: !!crossRepo,
      templateSections: template.sections.map(s => ({
        header: s.header,
        source: s.source,
        priority: s.priority,
        max_tokens: s.max_tokens,
      })),
      sections: traceSections,
      budget: { total: minTokens, used, leftover: Math.max(0, minTokens - used) },
      freshness: { state: freshnessState, message: freshnessWarning.trim() },
      timingsMs: { total: Date.now() - startedAt, perSource: timings },
    };
  }

  if (includeIds && (collectedFactIds.length > 0 || collectedMemoryIds.length > 0)) {
    result.context_refs = { fact_ids: collectedFactIds, memory_ids: collectedMemoryIds };
  }
  return result;
}

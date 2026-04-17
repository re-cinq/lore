/**
 * Context assembly: retrieves from all sources and formats into
 * a structured, token-budgeted block for LLM consumption.
 *
 * Templates are YAML files loaded at startup from mcp-server/templates/.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { searchMemories, computeTransferScore } from './memory-search.js';
import { queryLiveGraph } from './graph.js';

// ── Types ───────────────────────────────────────────────────────────

interface TemplateSection {
  header: string;
  source: 'repo' | 'adrs' | 'memories' | 'graph' | 'episodes' | 'rules' | 'cross_repo' | 'incidents';
  priority: number;
  max_tokens?: number;
}

interface Template {
  name: string;
  description: string;
  sections: TemplateSection[];
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

// ── Token estimation ────────────────────────────────────────────────

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function truncateToTokens(text: string, maxTokens: number): string {
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) return text;

  // Truncate at a paragraph boundary
  const truncated = text.substring(0, maxChars);
  const lastParagraph = truncated.lastIndexOf('\n\n');
  if (lastParagraph > maxChars * 0.5) {
    return truncated.substring(0, lastParagraph) + '\n\n...(truncated)';
  }
  return truncated + '\n\n...(truncated)';
}

// ── Source fetchers ─────────────────────────────────────────────────

type SourceFetcher = (pool: any, query: string, repo?: string, agentId?: string) => Promise<string>;

const fetchers: Record<string, SourceFetcher> = {
  async repo(pool, _query, repo) {
    if (!repo) return '';
    try {
      const { rows } = await pool.query(
        `SELECT content FROM org_shared.chunks
         WHERE repo = $1 AND content_type IN ('doc', 'adr', 'spec')
         ORDER BY content_type, ingested_at DESC LIMIT 5`,
        [repo],
      );
      return rows.map((r: any) => r.content).join('\n\n---\n\n');
    } catch {
      return '';
    }
  },

  async adrs(pool, query, repo) {
    if (!repo) return '';
    try {
      const { rows } = await pool.query(
        `SELECT content, file_path FROM org_shared.chunks
         WHERE repo = $1 AND content_type = 'adr'
         ORDER BY ingested_at DESC LIMIT 10`,
        [repo],
      );
      return rows.map((r: any) => `### ${r.file_path}\n\n${r.content}`).join('\n\n---\n\n');
    } catch {
      return '';
    }
  },

  async memories(pool, query, _repo, agentId) {
    try {
      const results = await searchMemories(pool, query, agentId, undefined, 10, false);
      if (results.length === 0) return '';

      // Check for recent conflicts on returned facts
      const factIds = results.filter(r => r.id && (r.source === 'fact' || r.source === 'episode')).map(r => r.id!);
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

      return results.map(r => {
        const tag = r.confidence ? ` [${r.confidence}]` : '';
        const conflict = r.id && conflictSet.has(r.id) ? ' [CONFLICT]' : '';
        return `**${r.key}** (${r.source})${tag}${conflict}: ${r.value}`;
      }).join('\n\n');
    } catch {
      return '';
    }
  },

  async graph(pool, query, repo) {
    try {
      // Extract likely entity name from query
      const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 3);
      const results: string[] = [];
      for (const word of words.slice(0, 3)) {
        const graphResults = await queryLiveGraph(pool, word, undefined, repo, false);
        for (const r of graphResults) {
          results.push(`${r.entity} (${r.entity_type}) --${r.relation}--> ${r.related_entity} (${r.related_type})`);
        }
      }
      return [...new Set(results)].join('\n');
    } catch {
      return '';
    }
  },

  async episodes(pool, query, _repo, agentId) {
    try {
      // Search facts from episodes
      const results = await searchMemories(pool, query, agentId, undefined, 5, false);
      const episodeResults = results.filter(r => r.source === 'episode');
      if (episodeResults.length === 0) return '';
      return episodeResults.map(r => `**${r.key}**: ${r.value}`).join('\n\n');
    } catch {
      return '';
    }
  },

  async rules(pool, query, repo) {
    // Load .claude/rules/*.md files that match the task query.
    // Rules are ingested with content_type = 'rule' and file_path preserving
    // the original path (e.g., ".claude/rules/api.md").
    if (!repo) return '';
    try {
      const { rows } = await pool.query(
        `SELECT content, file_path FROM org_shared.chunks
         WHERE repo = $1 AND content_type = 'rule'
         ORDER BY file_path`,
        [repo],
      );
      if (rows.length === 0) return '';

      // Match rule filenames against words in the query (simple keyword match)
      const queryWords = query.toLowerCase().split(/\s+/).filter((w: string) => w.length > 2);
      const matched = rows.filter((r: any) => {
        const ruleName = r.file_path.replace(/.*\//, '').replace(/\.md$/, '').toLowerCase();
        return queryWords.some((w: string) => ruleName.includes(w) || w.includes(ruleName));
      });

      // If no keyword matches, skip (don't load all rules for every query)
      if (matched.length === 0) return '';

      return matched
        .map((r: any) => `### ${r.file_path}\n\n${r.content}`)
        .join('\n\n---\n\n');
    } catch {
      return '';
    }
  },
  async cross_repo(pool, query, repo) {
    if (!repo) return '';
    try {
      // Check if repo has specific cross_repo_repos configured
      const { rows: repoRows } = await pool.query(
        `SELECT settings FROM lore.repos WHERE full_name = $1`, [repo],
      );
      const linkedRepos: string[] = repoRows[0]?.settings?.cross_repo_repos || [];

      let rows: any[];
      if (linkedRepos.length > 0) {
        // Search only the linked repos
        const result = await pool.query(
          `SELECT content, repo, file_path FROM org_shared.chunks
           WHERE repo = ANY($1) AND search_tsv @@ plainto_tsquery($2)
           ORDER BY ts_rank(search_tsv, plainto_tsquery($2)) DESC LIMIT 5`,
          [linkedRepos, query],
        );
        rows = result.rows;
      } else {
        // Fallback: search all repos except current
        const result = await pool.query(
          `SELECT content, repo, file_path FROM org_shared.chunks
           WHERE repo != $1 AND search_tsv @@ plainto_tsquery($2)
           ORDER BY ts_rank(search_tsv, plainto_tsquery($2)) DESC LIMIT 5`,
          [repo, query],
        );
        rows = result.rows;
      }
      if (rows.length === 0) return '';
      // Filter by transfer score — only portable, high-value facts from other repos
      const scored = rows
        .map((r: any) => ({ ...r, transferScore: computeTransferScore(r.content) }))
        .filter((r: any) => r.transferScore >= 0.5);
      if (scored.length === 0) return '';
      return scored.map((r: any) => `**[${r.repo}] ${r.file_path}**\n${r.content}`).join('\n\n---\n\n');
    } catch {
      return '';
    }
  },

  async incidents(pool, _query, repo) {
    if (!repo) return '';
    try {
      const { rows } = await pool.query(
        `SELECT settings FROM lore.repos WHERE full_name = $1`, [repo],
      );
      const settings = rows[0]?.settings;
      if (!settings?.incidents || !Array.isArray(settings.incidents) || settings.incidents.length === 0) return '';
      // Filter to incidents from last 30 days
      const cutoff = Date.now() - 30 * 86400000;
      const recent = settings.incidents.filter((i: any) => new Date(i.date).getTime() > cutoff);
      if (recent.length === 0) return '';
      return recent.map((i: any) =>
        `- **${i.severity || 'unknown'}**: ${i.title}${i.resolved ? ' (resolved)' : ''} — ${i.date}${i.url ? ` [link](${i.url})` : ''}`
      ).join('\n');
    } catch {
      return '';
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

export async function assembleContext(
  pool: any,
  query: string,
  templateName: string = 'default',
  maxTokens?: number,
  repo?: string,
  agentId?: string,
  crossRepo?: boolean,
  includeIds?: boolean,
): Promise<{ text: string; sections: { header: string; tokens: number; truncated: boolean }[]; context_refs?: { fact_ids: string[]; memory_ids: string[] } }> {
  const template = getTemplate(templateName);
  const effectiveMax = maxTokens ?? TEMPLATE_DEFAULT_BUDGETS[templateName] ?? 8000;
  const minTokens = Math.max(effectiveMax, 2000);

  // Check context freshness + first-run status
  let freshnessWarning = '';
  if (repo) {
    try {
      const { rows } = await pool.query(
        `SELECT last_ingested_at FROM lore.repos WHERE full_name = $1`, [repo],
      );
      if (rows.length === 0) {
        // Repo not in DB at all — first-run
        freshnessWarning = `> **Welcome to Lore!** This repo is not yet onboarded.\n> Suggested actions:\n> 1. Call \`onboard_repo\` to generate CLAUDE.md and register the repo\n> 2. Call \`ingest_files\` to manually add specific files\n> 3. Call \`search_memory\` to check if others have left learnings\n\n`;
      } else if (!rows[0].last_ingested_at) {
        freshnessWarning = `> ⚠ **Context may be stale** — this repo has never been ingested. Run \`ingest_files\` or wait for the nightly reindex.\n\n`;
      } else {
        const age = Date.now() - new Date(rows[0].last_ingested_at).getTime();
        if (age > 7 * 86400000) {
          const days = Math.floor(age / 86400000);
          freshnessWarning = `> ⚠ **Context may be stale** — last ingested ${days} days ago.\n\n`;
        }
      }
    } catch { /* non-fatal */ }
  }

  // Track assembled IDs for outcome feedback
  const collectedFactIds: string[] = [];
  const collectedMemoryIds: string[] = [];

  // Filter out cross_repo source unless explicitly requested
  const activeSections = template.sections.filter(s =>
    s.source !== 'cross_repo' || crossRepo,
  );

  // Fetch all sections in parallel
  const sectionResults = await Promise.all(
    activeSections.map(async (section) => {
      const fetcher = fetchers[section.source];
      if (!fetcher) return { section, content: '' };
      try {
        const content = await fetcher(pool, query, repo, agentId);
        return { section, content };
      } catch {
        return { section, content: '' };
      }
    }),
  );

  // Filter out empty sections
  const nonEmpty = sectionResults.filter(r => r.content.length > 0);

  // Allocate token budget by priority
  // Higher priority (lower number) gets more budget
  const totalPriorityWeight = nonEmpty.reduce((sum, r) => sum + (6 - r.section.priority), 0);
  let remainingTokens = minTokens;

  // Sort by priority (most important first)
  nonEmpty.sort((a, b) => a.section.priority - b.section.priority);

  const assembled: { header: string; content: string; tokens: number; truncated: boolean }[] = [];

  for (const result of nonEmpty) {
    const weight = (6 - result.section.priority) / totalPriorityWeight;
    const sectionBudget = Math.min(
      result.section.max_tokens || Infinity,
      Math.floor(minTokens * weight * 1.5), // Allow some overflow per section
      remainingTokens,
    );

    if (sectionBudget <= 100) continue; // Skip if too little budget

    const contentTokens = estimateTokens(result.content);
    const truncated = contentTokens > sectionBudget;
    const finalContent = truncated
      ? truncateToTokens(result.content, sectionBudget)
      : result.content;
    const finalTokens = estimateTokens(finalContent);

    assembled.push({
      header: result.section.header,
      content: finalContent,
      tokens: finalTokens,
      truncated,
    });

    remainingTokens -= finalTokens;
    if (remainingTokens <= 0) break;
  }

  // Build the final text
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

  const body = assembled
    .map(s => `## ${s.header}\n\n${s.content}`)
    .join('\n\n---\n\n');
  const text = freshnessWarning + body;

  const sections = assembled.map(s => ({
    header: s.header,
    tokens: s.tokens,
    truncated: s.truncated,
  }));

  const result: { text: string; sections: typeof sections; context_refs?: { fact_ids: string[]; memory_ids: string[] } } = { text, sections };
  if (includeIds && (collectedFactIds.length > 0 || collectedMemoryIds.length > 0)) {
    result.context_refs = { fact_ids: collectedFactIds, memory_ids: collectedMemoryIds };
  }
  return result;
}

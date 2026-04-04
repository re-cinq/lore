/**
 * Context assembly: retrieves from all sources and formats into
 * a structured, token-budgeted block for LLM consumption.
 *
 * Templates are YAML files loaded at startup from mcp-server/templates/.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { searchMemories } from './memory-search.js';
import { queryLiveGraph } from './graph.js';

// ── Types ───────────────────────────────────────────────────────────

interface TemplateSection {
  header: string;
  source: 'repo' | 'adrs' | 'memories' | 'graph' | 'episodes';
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
      return results.map(r => `**${r.key}** (${r.source}): ${r.value}`).join('\n\n');
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
};

// ── Main assembly ───────────────────────────────────────────────────

export async function assembleContext(
  pool: any,
  query: string,
  templateName: string = 'default',
  maxTokens: number = 16000,
  repo?: string,
  agentId?: string,
): Promise<{ text: string; sections: { header: string; tokens: number; truncated: boolean }[] }> {
  const template = getTemplate(templateName);
  const minTokens = Math.max(maxTokens, 2000);

  // Fetch all sections in parallel
  const sectionResults = await Promise.all(
    template.sections.map(async (section) => {
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
  const text = assembled
    .map(s => `## ${s.header}\n\n${s.content}`)
    .join('\n\n---\n\n');

  const sections = assembled.map(s => ({
    header: s.header,
    tokens: s.tokens,
    truncated: s.truncated,
  }));

  return { text, sections };
}

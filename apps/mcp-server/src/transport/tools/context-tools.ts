import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { globSync } from "glob";
import {
  hybridSearch,
  isDbAvailable,
} from "@re-cinq/lore-server-core/platform/db.js";
import { detectCurrentRepo } from "@re-cinq/lore-server-core/features/repo/repo-detect.js";
import { traceRetrieval } from "@re-cinq/lore-server-core/platform/otel.js";
import { textResult } from "./deps.js";
import { registerAssembleContextTool } from "./context-tools-assemble.js";

const CONTEXT_PATH = process.env.CONTEXT_PATH || process.cwd();

function readFileSafe(path: string): string | null {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return null;
  }
}

function topRrfScore(results: { rrf_score: number }[]): number {
  return results.length > 0 ? results[0].rrf_score : 0;
}

async function searchWithOrgSharedFallback(
  query: string,
  schema: string,
  team: string | undefined,
  limit: number,
) {
  const results = await hybridSearch(query, schema, limit);

  if (results.length > 0 || !team || team === "org_shared") {
    return results;
  }

  return hybridSearch(query, "org_shared", limit);
}

function renderScoredPassages(
  query: string,
  results: { rrf_score: number; content: string }[],
): { content: Array<{ type: "text"; text: string }> } {
  if (results.length === 0) {
    return textResult(`No results for "${query}".`);
  }
  const text = results
    .map((r) => `**Score:** ${r.rrf_score.toFixed(3)}\n\n${r.content}`)
    .join("\n\n---\n\n");

  return textResult(text);
}

/** Hybrid vector+BM25 search over the team schema, falling back to org_shared when the team has no hits. */
async function searchDbContext(
  query: string,
  team: string | undefined,
  limit: number,
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const schema = team || "org_shared";
  const results = await searchWithOrgSharedFallback(query, schema, team, limit);

  traceRetrieval({
    query,
    namespace: schema,
    topScore: topRrfScore(results),
    resultCount: results.length,
  });

  return renderScoredPassages(query, results);
}

interface ParagraphScan {
  file: string;
  raw: string;
  lowerQuery: string;
  limit: number;
}

function appendParagraphMatches(
  results: { source: string; paragraph: string }[],
  scan: ParagraphScan,
): void {
  for (const para of scan.raw.split(/\n{2,}/)) {
    if (results.length >= scan.limit) {
      return;
    }

    if (para.toLowerCase().includes(scan.lowerQuery)) {
      results.push({
        source: relative(CONTEXT_PATH, scan.file),
        paragraph: para.trim(),
      });
    }
  }
}

/** File-based fallback: substring-scans each file's paragraphs until `limit` matches. */
function collectMatchingParagraphs(
  files: string[],
  lowerQuery: string,
  limit: number,
): { source: string; paragraph: string }[] {
  const results: { source: string; paragraph: string }[] = [];

  for (const file of files) {
    const raw = readFileSafe(file);

    if (!raw) {
      continue;
    }
    appendParagraphMatches(results, { file, raw, lowerQuery, limit });

    if (results.length >= limit) {
      break;
    }
  }

  return results;
}

// Tool input schemas live as data beside their tool: a zod object is a contract, not a step in registering one.
const SEARCH_CONTEXT_INPUT = {
  query: z.string().describe("Natural-language search query."),
  team: z
    .string()
    .optional()
    .describe(
      "Team schema name to scope the search (e.g. 'platform'). Omit to search org_shared; unknown teams fall back to org_shared on the DB path or return an error on the file path.",
    ),
  limit: z.number().default(8).describe("Maximum passages to return."),
};

export function registerContextTools(server: McpServer) {
  registerSearchContextTool(server);
  registerAssembleContextTool(server);
}

// Auto-detects repo from git remote when no team is specified, to scope DB search to its context namespace.
function logDetectedRepo(team: string | undefined): void {
  const detectedRepo = !team ? detectCurrentRepo() : null;

  if (detectedRepo) {
    console.error(
      `[lore] lore_search_context: auto-detected repo ${detectedRepo}`,
    );
  }
}

function resolveSearchRoot(team: string | undefined): string {
  return team ? join(CONTEXT_PATH, "teams", team) : CONTEXT_PATH;
}

function renderSourcedParagraphs(
  query: string,
  results: { source: string; paragraph: string }[],
): { content: Array<{ type: "text"; text: string }> } {
  if (results.length === 0) {
    return textResult(`No results found for "${query}".`);
  }
  const text = results
    .map((r) => `**Source:** ${r.source}\n\n${r.paragraph}`)
    .join("\n\n---\n\n");

  return textResult(text);
}

/** Case-insensitive substring scan of local .md files, used when no DB is available. */
function fileFallbackSearch(
  query: string,
  team: string | undefined,
  limit: number,
): { content: Array<{ type: "text"; text: string }> } {
  const searchRoot = resolveSearchRoot(team);

  if (!existsSync(searchRoot)) {
    return textResult(`Error: search path not found at ${searchRoot}.`);
  }
  const files = globSync(join(searchRoot, "**/*.md"), { nodir: true });
  const results = collectMatchingParagraphs(files, query.toLowerCase(), limit);

  traceRetrieval({
    query,
    namespace: team || "org",
    topScore: results.length > 0 ? 1.0 : 0.0, // Phase 0: binary score, Phase 1 will be RRF.
    resultCount: results.length,
  });

  return renderSourcedParagraphs(query, results);
}

function registerSearchContextTool(server: McpServer) {
  server.tool(
    "lore_search_context",
    `Searches the repo/org ingested-document corpus (CLAUDE.md, ADRs, team docs, specs) and returns raw matching passages as source-scored snippets. Uses hybrid vector+BM25 retrieval when a DB is available; falls back to case-insensitive substring scan of local .md files otherwise.
Use this when you want chunk-level evidence or the exact wording of a convention/ADR. For a ONE token-budgeted bundle combining all sources (conventions, ADRs, memories, facts, graph) call lore_assemble_context — that is the mandatory first call. For past learnings, decisions, and extracted facts from prior sessions call lore_search_memory. For entity relationships call lore_query_graph.`,
    SEARCH_CONTEXT_INPUT,
    async ({ query, team, limit }) => {
      logDetectedRepo(team);

      if (await isDbAvailable()) {
        return searchDbContext(query, team, limit);
      }

      return fileFallbackSearch(query, team, limit);
    },
  );
}

// MCP tool input args (lore_assemble_context's own snake_case schema), not a DB row.

// Only sent when non-default so these extras also seed the cache key, keeping a 16000-token request from being served an 8000-token cached body.

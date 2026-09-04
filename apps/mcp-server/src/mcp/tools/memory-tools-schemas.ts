import { z } from "zod";

// Tool input schemas live as data beside their tool: a zod object is a contract, not a step in registering one.

export const WRITE_MEMORY_INPUT = {
  key: z
    .string()
    .describe(
      "Caller-chosen retrieval key; slash-namespaced by convention, e.g. 'session-summary/2026-03-30'.",
    ),
  value: z.string(),
  agent_id: z.string().optional(),
  ttl: z
    .number()
    .optional()
    .describe("Time-to-live in seconds. Omit for no expiry."),
  extract_facts: z
    .boolean()
    .optional()
    .describe(
      "When true, the API fires async fact extraction from value (fire-and-forget; does not block the write).",
    ),
};

export const READ_MEMORY_INPUT = {
  key: z.string().describe("Exact memory key; no wildcards or fuzzy matching."),
  agent_id: z.string().optional(),
  version: z
    .string()
    .optional()
    .describe(
      '"all" for full history newest-first, or a numeric string for one specific version. Omit for the latest non-deleted version.',
    ),
};

export const DELETE_MEMORY_INPUT = {
  key: z.string().describe("Exact memory key to soft-delete."),
  agent_id: z.string().optional(),
};

export const LIST_MEMORIES_INPUT = {
  agent_id: z
    .string()
    .optional()
    .describe(
      "Agent scope when no repo is detected (ignored when repo is detected).",
    ),
  limit: z.number().default(50),
  offset: z
    .number()
    .default(0)
    .describe(
      "Rows to skip for pagination (DB path only; not forwarded over proxy).",
    ),
};

export const SEARCH_MEMORY_INPUT = {
  query: z.string(),
  agent_id: z
    .string()
    .optional()
    .describe("Scope to one agent. Omit for org-wide search."),
  pool: z
    .string()
    .optional()
    .describe(
      "Restrict to a named shared pool; non-existent pool name returns empty.",
    ),
  limit: z.number().default(10),
  include_invalidated: z
    .boolean()
    .default(false)
    .describe("When true, also return superseded/historical facts."),
  graph_augment: z
    .boolean()
    .default(false)
    .describe(
      "When true, enrich results with 1-hop knowledge-graph neighbors.",
    ),
};

export const WRITE_EPISODE_INPUT = {
  content: z
    .string()
    .min(1)
    .max(50000)
    .describe(
      "Raw text to ingest; deduplicated by content hash. 1–50000 chars.",
    ),
  source: z
    .string()
    .default("manual")
    .describe('Provenance tag, e.g. "session", "pr-review", "ci".'),
  ref: z
    .string()
    .optional()
    .describe(
      'External reference, e.g. "owner/repo#42". The owner/repo prefix scopes graph entities.',
    ),
  agent_id: z.string().optional(),
};

export const QUERY_GRAPH_INPUT = {
  entity: z
    .string()
    .optional()
    .describe(
      "Entity name (case-insensitive); matched against both edge endpoints. Omit to browse recent edges.",
    ),
  relation_type: z
    .string()
    .optional()
    .describe(
      'Filter to one relation type, e.g. "uses", "owns", "depends-on", "replaced-by", "part-of", "implements".',
    ),
  repo: z
    .string()
    .optional()
    .describe(
      'Scope to a specific repo, e.g. "re-cinq/lore". Repo-less edges excluded when set.',
    ),
  include_invalidated: z
    .boolean()
    .default(false)
    .describe("When true, also include historically-invalidated edges."),
};

export const AGENT_STATS_INPUT = {
  agent_id: z
    .string()
    .optional()
    .describe("Agent to inspect. Omit for the ambient agent."),
};

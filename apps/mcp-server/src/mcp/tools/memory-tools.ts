import { errorMessage } from "@re-cinq/lore-shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { resolveAgentId } from "@re-cinq/lore-server-core/platform/agent-id.js";
import {
  writeMemoryFile,
  readMemoryFile,
  deleteMemoryFile,
  listMemoriesFile,
  searchMemoryFile,
} from "@re-cinq/lore-server-core/features/memory/memory-file.js";
import { detectCurrentRepo } from "@re-cinq/lore-server-core/features/repo/repo-detect.js";
import {
  trackLatency,
  proxyMemory,
  proxyToApi,
  proxyGetApi,
  withReadCache,
  unreachableError,
  deniedError,
  notConfiguredError,
} from "./deps.js";
import { invalidate as invalidateCache } from "@re-cinq/lore-server-core/platform/proxy-cache.js";

// Reads whose results a memory/episode write can change. Over-invalidating is
// safe — it only forces the next read to re-fetch.
const MEMORY_DERIVED_READS = [
  "lore_search_memory",
  "lore_read_memory",
  "lore_list_memories",
  "lore_assemble_context",
];
const EPISODE_DERIVED_READS = [
  "lore_search_memory",
  "lore_query_graph",
  "lore_assemble_context",
];

export function registerMemoryTools(server: McpServer) {
  server.tool(
    "lore_write_memory",
    `Stores one curated key/value memory (versioned, repo-scoped when a repo is detected, agent-scoped otherwise) and returns {key, version, agent_id, created_at}. Use when you have a decision, convention, correction, or session summary you want to retrieve later by a key you choose. Instead: lore_write_episode for raw uncurated text with no chosen key.`,
    {
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
    },
    async ({ key, value, agent_id, ttl, extract_facts }) => {
      try {
        const repo = detectCurrentRepo() || undefined;

        // Proxy to GKE if available
        const proxied = await proxyMemory("write", {
          key,
          value,
          agent_id: agent_id || resolveAgentId(),
          ttl,
          repo,
          extract_facts,
        });

        if (proxied.ok) {
          invalidateCache(MEMORY_DERIVED_READS);

          return { content: [{ type: "text" as const, text: proxied.body }] };
        }

        if (proxied.reason === "unreachable") {
          return unreachableError("lore_write_memory", proxied.detail);
        }

        if (proxied.reason === "denied") {
          return deniedError("lore_write_memory", proxied.detail);
        }
        // File fallback only when LORE_API_URL is not configured (true offline mode)
        const result = writeMemoryFile(key, value, agent_id, ttl);

        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error writing memory: ${errorMessage(err)}`,
            },
          ],
        };
      }
    },
  );

  server.tool(
    "lore_read_memory",
    `Fetches one memory by its exact key and returns the stored row as JSON (latest version by default, or full history/specific version on request). Use only when you already know the precise key. Instead: lore_search_memory when searching by meaning; lore_list_memories to enumerate keys.`,
    {
      key: z
        .string()
        .describe("Exact memory key; no wildcards or fuzzy matching."),
      agent_id: z.string().optional(),
      version: z
        .string()
        .optional()
        .describe(
          '"all" for full history newest-first, or a numeric string for one specific version. Omit for the latest non-deleted version.',
        ),
    },
    async ({ key, agent_id, version }) => {
      try {
        const ver =
          version === "all" ? "all" : version ? Number(version) : undefined;

        const proxied = await withReadCache(
          {
            tool: "lore_read_memory",
            args: { key, agent_id: agent_id || resolveAgentId(), version },
            ttlSeconds: 300,
          },
          () =>
            proxyMemory("read", {
              key,
              agent_id: agent_id || resolveAgentId(),
              version,
            }),
        );

        if (proxied.ok) {
          return { content: [{ type: "text" as const, text: proxied.body }] };
        }

        if (proxied.reason === "unreachable") {
          return unreachableError("lore_read_memory", proxied.detail);
        }

        if (proxied.reason === "denied") {
          return deniedError("lore_read_memory", proxied.detail);
        }
        const result = readMemoryFile(key, agent_id, ver);

        if (!result) {
          return {
            content: [
              { type: "text" as const, text: `Memory "${key}" not found.` },
            ],
          };
        }

        return {
          content: [
            { type: "text" as const, text: JSON.stringify(result, null, 2) },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error reading memory: ${errorMessage(err)}`,
            },
          ],
        };
      }
    },
  );

  server.tool(
    "lore_delete_memory",
    `Soft-deletes a memory by key (hides it from read/list/search; version history is retained) and returns {key, deleted: true}. Scope is agent_id, not repo. Use to retire a stale or mistaken memory. Instead: lore_cancel_local_task to stop a local background task; lore_cancel_task to cancel a pipeline task — those are unrelated.`,
    {
      key: z.string().describe("Exact memory key to soft-delete."),
      agent_id: z.string().optional(),
    },
    async ({ key, agent_id }) => {
      try {
        const proxied = await proxyMemory("delete", {
          key,
          agent_id: agent_id || resolveAgentId(),
        });

        if (proxied.ok) {
          invalidateCache(MEMORY_DERIVED_READS);

          return { content: [{ type: "text" as const, text: proxied.body }] };
        }

        if (proxied.reason === "unreachable") {
          return unreachableError("lore_delete_memory", proxied.detail);
        }

        if (proxied.reason === "denied") {
          return deniedError("lore_delete_memory", proxied.detail);
        }
        const result = deleteMemoryFile(key, agent_id);

        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error deleting memory: ${errorMessage(err)}`,
            },
          ],
        };
      }
    },
  );

  server.tool(
    "lore_list_memories",
    `Lists memory keys for the current repo (newest-first, paginated), returning {memories: [{key, agent_id, repo, version, created_at, ttl_seconds, has_facts}], total}. Scope: detected repo wins; falls back to agent_id; then org-wide. Excludes expired and soft-deleted entries. Use to browse existing keys without ranking. Instead: lore_search_memory to find memories by meaning; lore_read_memory to fetch one specific value.`,
    {
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
    },
    async ({ agent_id, limit, offset }) => {
      try {
        const repo = detectCurrentRepo() || undefined;

        const proxied = await withReadCache(
          {
            tool: "lore_list_memories",
            args: { agent_id: agent_id || undefined, limit, repo },
            repo: repo || undefined,
            ttlSeconds: 300,
          },
          () =>
            proxyMemory("list", {
              agent_id: agent_id || undefined,
              limit,
              repo,
            }),
        );

        if (proxied.ok) {
          return { content: [{ type: "text" as const, text: proxied.body }] };
        }

        if (proxied.reason === "unreachable") {
          return unreachableError("lore_list_memories", proxied.detail);
        }

        if (proxied.reason === "denied") {
          return deniedError("lore_list_memories", proxied.detail);
        }
        const result = listMemoriesFile(agent_id, limit, offset);

        return {
          content: [
            { type: "text" as const, text: JSON.stringify(result, null, 2) },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error listing memories: ${errorMessage(err)}`,
            },
          ],
        };
      }
    },
  );

  server.tool(
    "lore_search_memory",
    `Semantic (vector + keyword) search across org-wide memories and extracted facts; returns a relevance-ranked array of {key, value, score, agent_id, source, id?, confidence?} (source: memory|fact|episode|graph). Use to find past learnings, decisions, corrections, and facts when you do NOT have an exact key. Instead: lore_read_memory for exact-key lookup; lore_list_memories to enumerate keys; lore_search_context for raw repo document passages (conventions, ADRs, .md text); lore_query_graph to traverse entity relationships; lore_assemble_context for the token-budgeted startup bundle (the mandatory first call).`,
    {
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
    },
    async ({
      query,
      agent_id,
      pool,
      limit,
      include_invalidated,
      graph_augment,
    }) => {
      try {
        const searchArgs = {
          query,
          agent_id: agent_id || undefined,
          pool_name: pool,
          limit,
          include_invalidated,
          graph_augment,
        };
        const proxied = await withReadCache(
          {
            tool: "lore_search_memory",
            args: searchArgs,
            ttlSeconds: 300,
          },
          () => proxyMemory("search", searchArgs),
        );

        if (proxied.ok) {
          return { content: [{ type: "text" as const, text: proxied.body }] };
        }

        if (proxied.reason === "unreachable") {
          return unreachableError("lore_search_memory", proxied.detail);
        }

        if (proxied.reason === "denied") {
          return deniedError("lore_search_memory", proxied.detail);
        }
        const results = searchMemoryFile(query, agent_id, limit);

        return {
          content: [
            { type: "text" as const, text: JSON.stringify(results, null, 2) },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error searching memories: ${errorMessage(err)}`,
            },
          ],
        };
      }
    },
  );

  server.tool(
    "lore_write_episode",
    `Ingests one raw uncurated text blob as a deduplicated episode; returns {status: "ok", episode_id, source, ref} or {status: "duplicate"} when already ingested. Content is secret-redacted; facts and graph entities/edges are extracted asynchronously. Use for bulk/passive capture where you do not want to choose a key and do not need the text individually addressable. Instead: lore_write_memory for a curated nugget you want to retrieve by a specific key. No file fallback — requires DB or API.`,
    {
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
    },
    async ({ content, source, ref, agent_id }) => {
      try {
        // Proxy to GKE
        const proxied = await proxyToApi("/api/episode", {
          content,
          source,
          ref,
          agent_id: agent_id || resolveAgentId(),
        });

        if (proxied.ok) {
          invalidateCache(EPISODE_DERIVED_READS);

          return { content: [{ type: "text" as const, text: proxied.body }] };
        }

        if (proxied.reason === "unreachable") {
          return unreachableError("lore_write_episode", proxied.detail);
        }

        if (proxied.reason === "denied") {
          return deniedError("lore_write_episode", proxied.detail);
        }

        return {
          content: [
            {
              type: "text" as const,
              text: "Episodes require PostgreSQL or LORE_API_URL. Neither is configured.",
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error writing episode: ${errorMessage(err)}`,
            },
          ],
        };
      }
    },
  );

  server.tool(
    "lore_query_graph",
    `Reads the live knowledge graph and returns typed relationship edges {entity, entity_type, relation, related_entity, related_type, direction, valid_from} for one entity, or recent edges when no entity given. Use when you want structured relationships (uses/owns/depends-on/replaced-by), not prose. Graph is populated asynchronously by lore_write_episode — no writes here. Instead: lore_search_memory for learnings and facts in prose form; lore_search_context for raw document passages; lore_assemble_context for the token-budgeted startup bundle.`,
    {
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
    },
    async ({ entity, relation_type, repo, include_invalidated }) => {
      return trackLatency("lore_query_graph", async () => {
        try {
          // Local stdio mode: proxy the read to the GKE server over LORE_API_URL
          // (mirrors lore_assemble_context) instead of requiring a direct DB.
          const params = new URLSearchParams();

          if (entity) {
            params.set("entity", entity);
          }

          if (relation_type) {
            params.set("relation_type", relation_type);
          }

          if (repo) {
            params.set("repo", repo);
          }

          if (include_invalidated) {
            params.set("include_invalidated", "true");
          }
          const proxied = await withReadCache(
            {
              tool: "lore_query_graph",
              args: { entity, relation_type, repo, include_invalidated },
              repo: repo || undefined,
              ttlSeconds: 600,
            },
            () => proxyGetApi(`/api/graph?${params.toString()}`),
          );

          if (proxied.ok) {
            return {
              content: [{ type: "text" as const, text: proxied.body }],
            };
          }

          if (proxied.reason === "unreachable") {
            return unreachableError("lore_query_graph", proxied.detail);
          }

          if (proxied.reason === "denied") {
            return deniedError("lore_query_graph", proxied.detail);
          }

          return {
            content: [
              {
                type: "text" as const,
                text: "Knowledge graph requires PostgreSQL (LORE_DB_HOST) or a configured LORE_API_URL.",
              },
            ],
          };
        } catch (err) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error querying graph: ${errorMessage(err)}`,
              },
            ],
          };
        }
      });
    },
  );

  server.tool(
    "lore_agent_stats",
    `Returns an agent's combined health and learning statistics as JSON (memory_count, total_facts, active_facts, invalidated_facts, total_searches, recent_episodes, etc.). Use to gauge how much an agent has learned and how active it is. Instead: lore_my_usage for per-developer LLM token spend.`,
    {
      agent_id: z
        .string()
        .optional()
        .describe("Agent to inspect. Omit for the ambient agent."),
    },
    async ({ agent_id }) => {
      try {
        const params = new URLSearchParams({
          agent_id: resolveAgentId(agent_id),
        });
        const proxied = await proxyGetApi(`/api/agent-stats?${params}`);

        if (proxied.ok) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(JSON.parse(proxied.body), null, 2),
              },
            ],
          };
        }

        if (proxied.reason === "not_configured") {
          return notConfiguredError("fetching agent stats");
        }

        if (proxied.reason === "denied") {
          return deniedError("lore_agent_stats", proxied.detail);
        }

        return {
          content: [
            {
              type: "text" as const,
              text: `Could not fetch agent stats from the Lore API: ${proxied.detail}`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error fetching agent stats: ${errorMessage(err)}`,
            },
          ],
        };
      }
    },
  );
}

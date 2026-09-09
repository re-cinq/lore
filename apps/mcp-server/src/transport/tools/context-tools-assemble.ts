// The one budgeted bundle: lore_assemble_context. Separate from context-tools.ts, which returns raw passages — the two tools share a word, not a job.

import { errorMessage } from "@re-cinq/lore-shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  textResult,
  deniedError,
  unreachableError,
  withReadCache,
  trackLatency,
  proxyGetApi,
  type ProxyResult,
} from "./deps.js";
import { detectCurrentRepo } from "@re-cinq/lore-server-core/features/repo/repo-detect.js";
import { updateBanner } from "../../work/update/mcp-update.js";

// MCP tool input args (lore_assemble_context's own snake_case schema), not a DB row.
// eslint-disable-next-line re-lint/no-row-types-outside-models
interface AssembleContextExtraArgs {
  max_tokens?: number;
  cross_repo?: boolean;
  agent_id?: string;
}

function resolveRepoLabel(repo: string | undefined): string {
  return repo || detectCurrentRepo() || "";
}

const ASSEMBLE_CONTEXT_INPUT = {
  query: z
    .string()
    .describe(
      "Natural-language description of the context needed. Drives retrieval and ranking across all sources.",
    ),
  template: z
    .string()
    .default("default")
    .describe(
      "Section-ordering profile. Recognized values: 'default' | 'review' | 'implementation' | 'research'. Unrecognized values silently fall back to 'default'. Note: template choice does NOT raise the token budget — max_tokens always defaults to 8000 regardless of template, so pass max_tokens explicitly for research queries.",
    ),
  max_tokens: z
    .number()
    .min(2000)
    .default(8000)
    .describe(
      "Token budget for the assembled block; floor 2000. Raise to ~16000 for research-heavy queries. Defaults to 8000.",
    ),
  repo: z
    .string()
    .optional()
    .describe("'owner/repo'. Auto-detected from the git remote when omitted."),
  agent_id: z
    .string()
    .optional()
    .describe("Overrides the ambient agent id used to scope memories/facts."),
  cross_repo: z
    .boolean()
    .default(false) // eslint-disable-line re-lint/no-flag-params -- schema default value, not a behaviour the callee selects
    .describe(
      "When true, also pulls context from linked repos in the org. Falls back to the repo's settings.cross_repo when false.",
    ),
};

function buildAssembleExtras(
  args: AssembleContextExtraArgs,
): Record<string, string> {
  const extras: Record<string, string> = {};

  if (args.max_tokens) {
    extras.max_tokens = String(args.max_tokens);
  }

  if (args.cross_repo) {
    extras.cross_repo = "true";
  }

  if (args.agent_id) {
    extras.agent_id = args.agent_id;
  }

  return extras;
}

async function fetchAssembledContext(
  params: URLSearchParams,
): Promise<ProxyResult> {
  const r = await proxyGetApi(`/api/context?${params.toString()}`);

  if (!r.ok) {
    return r;
  }
  const body = JSON.parse(r.body) as { text?: string };

  // A reachable backend returning empty context is a real result, not an outage — return as-is rather than serving a stale, mislabeled fallback.
  return { ok: true as const, body: body.text ?? "" };
}

async function interpretProxiedContext(
  proxied: ProxyResult,
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  if (proxied.ok) {
    const banner = await updateBanner();

    return textResult(banner + proxied.body);
  }

  if (proxied.reason === "unreachable") {
    return unreachableError("lore_assemble_context", proxied.detail);
  }

  if (proxied.reason === "denied") {
    return deniedError("lore_assemble_context", proxied.detail);
  }

  return textResult(
    "Context assembly requires PostgreSQL or LORE_API_URL. Neither is configured.",
  );
}

/** Cached for 10 minutes on the query itself: a session re-orienting asks the same question repeatedly, and each miss is a full assembly across every source. */
async function cachedAssemble(
  key: { query: string; template: string; repo: string },
  extras: Record<string, string>,
): Promise<ProxyResult> {
  return withReadCache(
    {
      tool: "lore_assemble_context",
      args: { ...key, ...extras },
      repo: key.repo || undefined,
      ttlSeconds: 600,
    },
    () => fetchAssembledContext(new URLSearchParams({ ...key, ...extras })),
  );
}

/** The mandatory first call, served entirely by the API — the adapter holds no pool, so with no LORE_API_URL there is nothing to degrade to and it says so instead of returning an empty bundle. */
async function assembleContext(args: {
  query: string;
  template: string;
  max_tokens?: number;
  repo?: string;
  agent_id?: string;
  cross_repo?: boolean;
}) {
  const { query, template, max_tokens, repo, agent_id, cross_repo } = args;

  if (!process.env.LORE_API_URL || !process.env.LORE_INGEST_TOKEN) {
    return textResult(
      "Context assembly requires PostgreSQL or LORE_API_URL. Neither is configured.",
    );
  }
  const resolvedRepo = resolveRepoLabel(repo);
  const extras = buildAssembleExtras({ max_tokens, cross_repo, agent_id });

  return interpretProxiedContext(
    await cachedAssemble({ query, template, repo: resolvedRepo }, extras),
  );
}

export function registerAssembleContextTool(server: McpServer) {
  server.tool(
    "lore_assemble_context",
    `Assembles ONE token-budgeted, template-ordered context block by pulling from every source at once (repo conventions/docs, ADRs, memories, facts, episodes, graph relationships) and returning a single provenance-tagged text block. This is the mandatory first call when starting any task — use it before the narrower retrieval tools.
Instead: use lore_search_context for raw passages/exact wording from ingested docs; use lore_search_memory for past learnings, decisions, and extracted facts from prior sessions; use lore_query_graph for entity relationships. Those three are the building blocks this tool already combines.`,
    ASSEMBLE_CONTEXT_INPUT,
    async (args) =>
      trackLatency("lore_assemble_context", async () => {
        try {
          return await assembleContext(args);
        } catch (err) {
          return textResult(`Error assembling context: ${errorMessage(err)}`);
        }
      }),
  );
}

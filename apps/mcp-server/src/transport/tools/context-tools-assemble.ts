// The one budgeted bundle: lore_assemble_context. Separate from context-tools.ts, which returns raw passages — the two tools share a word, not a job.

import { errorMessage } from "@re-cinq/lore-shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  textResult,
  deniedError,
  failedProxyError,
  withReadCache,
  trackLatency,
  proxyGetApi,
  type ProxyResult,
} from "./deps.js";
import { repoParam, withRepo, type ServerMode } from "./repo-scope.js";
import { updateBanner } from "../../work/update/mcp-update.js";
import { backendParam } from "./backend-param.js";
import type { KnowledgeBackend } from "@re-cinq/lore-shared/knowledge-backend.js";

// MCP tool input args (lore_assemble_context's own snake_case schema), not a DB row.
// eslint-disable-next-line re-lint/no-row-types-outside-models
interface AssembleContextExtraArgs {
  max_tokens?: number;
  cross_repo?: boolean;
  agent_id?: string;
  backend?: KnowledgeBackend;
}

// eslint-disable-next-line re-lint/no-row-types-outside-models
interface AssembleContextArgs extends AssembleContextExtraArgs {
  query: string;
  template: string;
  repo: string;
}

export const ASSEMBLE_CONTEXT_INPUT = {
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
  backend: backendParam,
};

export function registerAssembleContextTool(
  server: McpServer,
  mode: ServerMode,
) {
  server.tool(
    "lore_assemble_context",
    `Assembles ONE token-budgeted, template-ordered context block by pulling from every source at once (repo conventions/docs, ADRs, memories, facts, episodes, graph relationships) and returning a single provenance-tagged text block. This is the mandatory first call when starting any task — use it before the narrower retrieval tools.
Instead: use lore_search_context for raw passages/exact wording from ingested docs; use lore_search_memory for past learnings, decisions, and extracted facts from prior sessions; use lore_query_graph for entity relationships. Those three are the building blocks this tool already combines.`,
    { ...ASSEMBLE_CONTEXT_INPUT, repo: repoParam(mode) },
    async (args) =>
      trackLatency("lore_assemble_context", async () => {
        try {
          return await assembleForMode(args, mode);
        } catch (err) {
          return textResult(`Error assembling context: ${errorMessage(err)}`);
        }
      }),
  );
}

async function assembleForMode(
  args: Omit<AssembleContextArgs, "repo"> & { repo?: string },
  mode: ServerMode,
) {
  return withRepo(args, mode, assembleContext);
}

/** The mandatory first call: proxies entirely to the API — without LORE_API_URL there is nothing to degrade to. */
async function assembleContext(args: AssembleContextArgs) {
  if (!process.env.LORE_API_URL || !process.env.LORE_INGEST_TOKEN) {
    return textResult(
      "Context assembly requires PostgreSQL or LORE_API_URL. Neither is configured.",
    );
  }
  const { query, template, repo } = args;
  const proxied = await cachedAssemble(
    { query, template, repo },
    buildAssembleExtras(args),
  );
  if (proxied.ok) {
    const { text, trace } = parseAssembleBody(proxied.body);
    logAssembleAudit(query, template, trace);
    return interpretProxiedContext({ ok: true, body: text });
  }
  return interpretProxiedContext(proxied);
}

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

  if (args.backend) {
    extras.backend = args.backend;
  }

  return extras;
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

async function fetchAssembledContext(
  params: URLSearchParams,
): Promise<ProxyResult> {
  const r = await proxyGetApi(`/api/context?${params.toString()}`);

  if (!r.ok) {
    return r;
  }

  // A reachable backend returning empty context is a real result — return as-is so the caller sees the trace for the audit log.
  return r;
}

interface AssembleSection {
  source: string;
  returnedTokens: number;
}

interface AssembleTrace {
  sections: AssembleSection[];
}

function parseAssembleBody(body: string): {
  text: string;
  trace?: AssembleTrace;
} {
  try {
    const parsed = JSON.parse(body) as { text?: string; trace?: AssembleTrace };
    return { text: parsed.text ?? "", trace: parsed.trace };
  } catch {
    return { text: body };
  }
}

function logAssembleAudit(
  query: string,
  template: string,
  trace: AssembleTrace | undefined,
): void {
  const sections = trace?.sections ?? [];
  const sources = sections.map((s) => s.source).join(", ") || "none";
  const tokens = sections.reduce((sum, s) => sum + s.returnedTokens, 0);
  console.error(
    `[lore] lore_assemble_context: query: ${query}, template: ${template}, sources hit: ${sources}, tokens: ${tokens}`,
  );
}

async function interpretProxiedContext(
  proxied: ProxyResult,
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  if (proxied.ok) {
    const banner = await updateBanner();

    return textResult(banner + proxied.body);
  }

  if (proxied.reason === "unreachable") {
    return failedProxyError("lore_assemble_context", proxied);
  }

  if (proxied.reason === "denied") {
    return deniedError("lore_assemble_context", proxied.detail);
  }

  return textResult(
    "Context assembly requires PostgreSQL or LORE_API_URL. Neither is configured.",
  );
}

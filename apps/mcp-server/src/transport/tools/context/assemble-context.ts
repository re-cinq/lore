// The one budgeted bundle: lore_assemble_context. Separate from search-context.ts, which returns raw passages — the two tools share a word, not a job.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  textResult,
  deniedError,
  failedProxyError,
  withReadCache,
  trackLatency,
  proxyGetApi,
  ASSEMBLY_PROXY_LIMITS,
  type ProxyResult,
} from "../shared/deps.js";
import { repoParam, withRepo, type ServerMode } from "../shared/repo-scope.js";
import { updateBanner } from "../../../work/update/mcp-update.js";
import {
  ContextBackendSchema,
  type ContextBackend,
} from "@re-cinq/lore-shared/knowledge-backend.js";
import {
  ContextTemplateSchema,
  type ContextTemplate,
} from "@re-cinq/lore-shared/context-template.js";
import { apiAnswer, apiGetUrl, type ApiQuery } from "../../api/api-types.js";

// MCP tool input args (lore_assemble_context's own snake_case schema), not a DB row.
// eslint-disable-next-line re-lint/no-row-types-outside-models
interface AssembleContextExtraArgs {
  max_tokens?: number;
  cross_repo?: boolean;
  agent_id?: string;
  backend?: ContextBackend;
}

interface AssembleContextArgs extends AssembleContextExtraArgs {
  query: string;
  template: ContextTemplate;
  repo: string;
}

export const ASSEMBLE_CONTEXT_INPUT = {
  query: z
    .string()
    .describe(
      "Natural-language description of the context needed. Drives retrieval and ranking across all sources.",
    ),
  template: ContextTemplateSchema.default("default").describe(
    "Section-ordering profile: 'default' | 'review' | 'implementation' | 'research'. Note: template choice does NOT raise the token budget — max_tokens always defaults to 8000 regardless of template, so pass max_tokens explicitly for research queries. Ignored under backend lore-v2.",
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
  // Optional, not defaulted: an unset backend lets the API apply the repo's settings.context_backend before falling back to Utopia.
  backend: ContextBackendSchema.optional().describe(
    "utopia (default), lore, or both: the template assembly over that store. lore-v2: a block built from the task's own questions over Lore's stores.",
  ),
};

export function registerAssembleContextTool(
  server: McpServer,
  mode: ServerMode,
) {
  server.tool(
    "lore_assemble_context",
    `Assembles ONE token-budgeted, template-ordered context block by pulling from every source at once (repo conventions/docs, ADRs, memories, facts, episodes, graph relationships) and returning a single provenance-tagged text block. With backend lore-v2 the block is instead built from the task's own questions: a repo primer, key facts each citing its source, where to look, and previous work. This is the mandatory first call when starting any task — use it before the narrower retrieval tools.
Instead: use lore_search_context for raw passages/exact wording from ingested docs; use lore_search_memory for past learnings, decisions, and extracted facts from prior sessions; use lore_query_graph for entity relationships. Those three are the building blocks this tool already combines.`,
    { ...ASSEMBLE_CONTEXT_INPUT, repo: repoParam(mode) },
    async (args) =>
      trackLatency("lore_assemble_context", () => assembleForMode(args, mode)),
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
  const { query, template, repo } = args;
  const proxied = await cachedAssemble(
    { query, template, repo },
    buildAssembleExtras(args),
  );

  if (proxied.ok) {
    const { text, sections, resolvedTemplate } = parseAssembleBody(
      proxied.body,
    );

    logAssembleAudit(query, resolvedTemplate ?? template, sections);

    return interpretProxiedContext({ ok: true, body: text });
  }

  return interpretProxiedContext(proxied);
}

type AssembleExtras = Pick<
  ApiQuery<"/api/context">,
  "max_tokens" | "cross_repo" | "agent_id" | "backend"
>;

function buildAssembleExtras(args: AssembleContextExtraArgs): AssembleExtras {
  return {
    max_tokens: args.max_tokens || undefined,
    cross_repo: args.cross_repo || undefined,
    agent_id: args.agent_id || undefined,
    backend: args.backend || undefined,
  };
}

/** The builder (lore-v2) writes for up to two minutes, and a retry would start a second build, so it gets one long attempt. */
const BUILDER_PROXY_LIMITS = { timeoutMs: 120_000, maxAttempts: 1 };

/** Cached for 10 minutes on the query itself: a session re-orienting asks the same question repeatedly, and each miss is a full assembly across every source. */
async function cachedAssemble(
  key: { query: string; template: ContextTemplate; repo: string },
  extras: AssembleExtras,
): Promise<ProxyResult> {
  return withReadCache(
    {
      tool: "lore_assemble_context",
      args: { ...key, ...extras },
      repo: key.repo,
      ttlSeconds: 600,
    },
    () =>
      proxyGetApi(
        apiGetUrl("/api/context", { ...key, ...extras }),
        limitsFor(extras.backend),
      ),
    { label: false },
  );
}

function limitsFor(backend: string | undefined) {
  return backend === "lore-v2" ? BUILDER_PROXY_LIMITS : ASSEMBLY_PROXY_LIMITS;
}

interface AssembleSection {
  header: string;
  tokens: number;
  truncated: boolean;
}

function parseAssembleBody(body: string): {
  text: string;
  sections?: AssembleSection[];
  resolvedTemplate?: string;
} {
  const parsed = apiAnswer("/api/context", body);
  const { text, sections } = parsed;

  // lore-api declares sections as unknown; the shape is assembleContext's own.
  const resolvedTemplate = (parsed as Record<string, unknown>)["template"] as
    string | undefined;

  return {
    text: text ?? "",
    sections: sections as AssembleSection[] | undefined,
    resolvedTemplate,
  };
}

function logAssembleAudit(
  query: string,
  template: string,
  sections: AssembleSection[] | undefined,
): void {
  const sources = sections?.map((s) => s.header).join(", ") || "none";
  const tokens = sections?.reduce((sum, s) => sum + s.tokens, 0) ?? 0;

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

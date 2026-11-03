// The template assembly: one query answered from every source of the repository's backend in a template's order. The context builder answers each of its questions with it, and /api/context serves it whenever the builder cannot run.

import type { Pool } from "pg";
import { traceFromEnv } from "@re-cinq/lore-shared/project/trace/trace-from-env.js";
import { assembleContext } from "@re-cinq/lore-server-core/features/context/context-assembly.js";
import {
  repoContextSettings,
  type RepoContextSettings,
} from "@re-cinq/lore-server-core/features/context/cross-repo.js";
import {
  resolveBackend,
  type KnowledgeBackend,
} from "@re-cinq/lore-shared/knowledge-backend.js";
import { utopiaAssemblyOptions } from "../utopia/memory/utopia-memory-search.js";

export interface AssembleOptions {
  repo?: string;
  template?: string;
  maxTokens?: number;
  agentId?: string;
  crossRepoRequested: boolean;
  backend?: KnowledgeBackend;
}

export interface AssemblyScope {
  settings: RepoContextSettings;
  backend: KnowledgeBackend;
}

/** The repository's settings and the store its context is read from: the one asked for, else the repository's own, else Utopia. */
export async function assemblyScope(
  pool: Pool,
  repo: string | undefined,
  requested: KnowledgeBackend | undefined,
): Promise<AssemblyScope> {
  const settings = await repoContextSettings(pool, repo);

  return {
    settings,
    backend: resolveBackend(requested, settings.contextBackend),
  };
}

export async function templateAssembly(
  pool: Pool,
  query: string,
  opts: AssembleOptions & AssemblyScope,
): Promise<Awaited<ReturnType<typeof assembleContext>>> {
  return assembleContext(pool, query, await engineOptions(pool, opts));
}

/** The trace is always kept (in memory only) because the assembly report reads it; the response still carries it only on `debug`. */
async function engineOptions(
  pool: Pool,
  opts: AssembleOptions & AssemblyScope,
) {
  const repo = opts.repo || undefined;

  return {
    templateName: opts.template,
    maxTokens: opts.maxTokens,
    repo,
    agentId: opts.agentId,
    crossRepo: opts.crossRepoRequested || opts.settings.crossRepo,
    debug: true,
    graph: traceFromEnv(process.env),
    backend: opts.backend,
    ...(await utopiaAssemblyOptions(pool, repo, opts.settings.utopiaMirror)),
  };
}

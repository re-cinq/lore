// What an agent asking a question about a repository is handed, in the shape a context eval reads: the assembled text, and each returned document with its token cost. Assembled passively, so an eval's two hundred questions a night strengthen no memory.

import type { Pool } from "pg";
import { traceFromEnv } from "@re-cinq/lore-shared/project/trace/trace-from-env.js";
import { utopiaAssemblyOptions } from "../utopia/memory/utopia-memory-search.js";
import type { AssemblyTrace } from "@re-cinq/lore-shared/project/knowledge/context-assembly.js";
import { assembleContext } from "@re-cinq/lore-server-core/features/context/context-assembly.js";
import { repoContextSettings } from "@re-cinq/lore-server-core/features/context/cross-repo.js";
import {
  noUtopiaReader,
  resolveBackend,
  type KnowledgeBackend,
} from "@re-cinq/lore-shared/knowledge-backend.js";
import type { AssembledForEval, AssembledSource } from "./evaluate-document.js";
import type { TicketBackend } from "./evaluate-ticket.js";
import { contextBuilderFor } from "../context/context-builder-deps.js";
import { builtOrAssembled } from "../context/built-or-assembled.js";

const TICKET_BUDGET = 8000;

/** Every document the assembly kept, with its section and the tokens it took; an item with no path keeps its tokens under an empty one. A section's "no Utopia reader" line is no document. */
export function sourcesOf(trace: AssemblyTrace | undefined): AssembledSource[] {
  return (trace?.sections ?? [])
    .filter((section) => section.included)
    .flatMap(sectionSources);
}

function sectionSources({
  source,
  items: kept,
}: AssemblyTrace["sections"][number]): AssembledSource[] {
  return kept
    .filter((document) => document.text !== noUtopiaReader(source))
    .map((document) => ({
      path: document.source_path ?? "",
      section: source,
      tokens: document.tokens,
    }));
}

export async function assembleForEval(
  pool: Pool,
  repo: string,
  question: string,
  backend?: KnowledgeBackend,
): Promise<AssembledForEval> {
  const result = await assembled(pool, { repo, query: question, backend });

  return { text: result.text, sources: sourcesOf(result.trace) };
}

/** What an implementer of a ticket is handed: the `implementation` template at the default budget, and the names of the sections that kept content. */
export async function assembleForTicket(
  pool: Pool,
  repo: string,
  query: string,
  backend: TicketBackend,
): Promise<{ text: string; sections: string[] }> {
  if (backend === "lore-v2") {
    return builtForTicket(pool, repo, query);
  }
  const result = await assembled(pool, {
    repo,
    query,
    backend,
    templateName: "implementation",
  });
  const kept = (result.trace?.sections ?? []).filter(
    (section) => section.included && section.items.length > 0,
  );

  return { text: result.text, sections: kept.map((section) => section.source) };
}

/** The block a lore-v2 caller gets, fallback included: the builder's when it writes one, the template assembly over Lore's stores otherwise, its section naming which (`builder`, or `fallback: <reason>`), so the eval grades what a caller is handed and counts the fallbacks. */
async function builtForTicket(
  pool: Pool,
  repo: string,
  query: string,
): Promise<{ text: string; sections: string[] }> {
  const build = await contextBuilderFor(pool, {
    repo,
    query,
    maxTokens: TICKET_BUDGET,
    crossRepoRequested: false,
  });
  const answer = await builtOrAssembled(build, () =>
    assembleForTicket(pool, repo, query, "lore"),
  );

  return {
    text: answer.text,
    sections:
      answer.builder === "on" ? ["builder"] : [`fallback: ${answer.builder}`],
  };
}

interface AssemblyRequest {
  repo: string;
  query: string;
  backend: KnowledgeBackend | undefined;
  templateName?: string;
}

async function assembled(
  pool: Pool,
  { repo, query, backend, templateName }: AssemblyRequest,
): Promise<Awaited<ReturnType<typeof assembleContext>>> {
  const settings = await repoContextSettings(pool, repo);

  return assembleContext(pool, query, {
    templateName,
    repo,
    crossRepo: settings.crossRepo,
    backend: resolveBackend(backend, settings.contextBackend),
    ...(await utopiaAssemblyOptions(pool, repo, settings.utopiaMirror)),
    graph: traceFromEnv(process.env),
    debug: true,
    passive: true,
  });
}

// What an agent asking a question about a repository is handed, in the shape a context eval reads: the assembled text, and each returned document with its token cost. Assembled passively, so an eval's two hundred questions a night strengthen no memory.

import type { Pool } from "pg";
import { traceFromEnv } from "@re-cinq/lore-shared/project/trace/trace-from-env.js";
import { utopiaReadsFrom } from "@re-cinq/lore-shared/utopia/utopia-reads.js";
import type { AssemblyTrace } from "@re-cinq/lore-shared/project/knowledge/context-assembly.js";
import { assembleContext } from "@re-cinq/lore-server-core/features/context/context-assembly.js";
import { repoContextSettings } from "@re-cinq/lore-server-core/features/context/cross-repo.js";
import {
  noUtopiaReader,
  resolveBackend,
  type KnowledgeBackend,
} from "@re-cinq/lore-shared/knowledge-backend.js";
import type { AssembledForEval, AssembledSource } from "./evaluate-document.js";

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
  const settings = await repoContextSettings(pool, repo);
  const result = await assembleContext(pool, question, {
    repo,
    crossRepo: settings.crossRepo,
    backend: resolveBackend(backend, settings.contextBackend),
    utopiaReads: utopiaReadsFrom(process.env),
    utopiaMirror: settings.utopiaMirror,
    graph: traceFromEnv(process.env),
    debug: true,
    passive: true,
  });

  return { text: result.text, sources: sourcesOf(result.trace) };
}

// What an agent asking a question about a repository is handed, in the shape a context eval reads: the assembled text, and each returned document with its token cost. Assembled passively, so an eval's two hundred questions a night strengthen no memory.

import type { Pool } from "pg";
import { createDgraphClient } from "@re-cinq/lore-shared";
import type { AssemblyTrace } from "@re-cinq/lore-shared/project/knowledge/context-assembly.js";
import { assembleContext } from "@re-cinq/lore-server-core/features/context/context-assembly.js";
import { repoWantsCrossRepo } from "@re-cinq/lore-server-core/features/context/cross-repo.js";
import type { AssembledForEval, AssembledSource } from "./evaluate-document.js";

/** Every document the assembly kept, with the tokens it took; an item with no path keeps its tokens under an empty one. */
export function sourcesOf(trace: AssemblyTrace | undefined): AssembledSource[] {
  return (trace?.sections ?? [])
    .filter((section) => section.included)
    .flatMap((section) => section.items)
    .map((kept) => ({ path: kept.source_path ?? "", tokens: kept.tokens }));
}

export async function assembleForEval(
  pool: Pool,
  repo: string,
  question: string,
): Promise<AssembledForEval> {
  const result = await assembleContext(pool, question, {
    repo,
    crossRepo: await repoWantsCrossRepo(pool, repo),
    dgraph: createDgraphClient(process.env),
    debug: true,
    passive: true,
  });

  return { text: result.text, sources: sourcesOf(result.trace) };
}

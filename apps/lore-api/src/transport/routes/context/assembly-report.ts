import { recordContextAssembly } from "@re-cinq/lore-shared/otel/metrics.js";
import type { AssemblyTrace } from "@re-cinq/lore-shared/project/knowledge/context-assembly.js";
import type { KnowledgeBackend } from "@re-cinq/lore-shared/knowledge-backend.js";
import { sourcesOf } from "../../../work/context-evals/assembled-for-eval.js";

interface AssemblyKey {
  backend: KnowledgeBackend;
  repo: string | undefined;
  template: string | undefined;
}

/** Runs one assembly and reports it: a log line and a count by backend and outcome, so whether a pod got Utopia content is readable without a floor transcript. A throw is counted as an error and rethrown. */
export async function reportingAssembly<
  Result extends { trace?: AssemblyTrace },
>(key: AssemblyKey, assemble: () => Promise<Result>): Promise<Result> {
  const startedAt = Date.now();

  try {
    const result = await assemble();

    reportAssembled(key, result.trace, Date.now() - startedAt);

    return result;
  } catch (err) {
    recordContextAssembly({ backend: key.backend, outcome: "error" });
    throw err;
  }
}

function reportAssembled(
  key: AssemblyKey,
  trace: AssemblyTrace | undefined,
  ms: number,
): void {
  const kept = sourcesOf(trace);
  const sections = [...new Set(kept.map((document) => document.section))];
  const tokens = kept.reduce((sum, document) => sum + document.tokens, 0);

  recordContextAssembly({
    backend: key.backend,
    outcome: outcomeOf(sections, trace),
  });
  console.log(
    `[context] assembled backend=${key.backend} repo=${key.repo ?? "-"} template=${key.template ?? "-"} sections=${sections.join(",")} tokens=${tokens} ms=${ms}`,
  );
}

/** ok when a section kept content; else error when a reader failed (a section-level throw is caught into its status), else empty. */
function outcomeOf(
  kept: string[],
  trace: AssemblyTrace | undefined,
): "ok" | "empty" | "error" {
  if (kept.length > 0) {
    return "ok";
  }
  const failed = (trace?.sections ?? []).some(
    (section) => section.status === "error",
  );

  return failed ? "error" : "empty";
}

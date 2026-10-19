// The section pipeline every store's assembly shares (specs/utopia-graph-mirror FR13.6): the template's sections read through a store's reader, packed into the budget by priority, serialized into one block, and recorded for the debug trace.

import { serializeContext } from "./context-assembly-format.js";
import {
  activeSections,
  getTemplate,
  type TemplateSection,
} from "./context-assembly-templates.js";
import type { AssembledRefs } from "./context-assembly-items.js";
import {
  allocateSections,
  assemblyBudget,
  type FetchedSection,
} from "./context-assembly-budget.js";
import type { FetchResult, SectionReader } from "./context-assembly-types.js";
import {
  buildAssemblyTrace,
  type AssemblyTrace,
  type DebugTraceInput,
} from "./context-assembly-trace.js";

export interface AssembledResult {
  text: string;
  sections: { header: string; tokens: number; truncated: boolean }[];
  trace?: AssemblyTrace;
  context_refs?: { fact_ids: string[]; memory_ids: string[] };
}

interface AssemblyRequest {
  template: ReturnType<typeof getTemplate>;
  templateName: string;
  minTokens: number;
}

/** One assembly's parameters, fixed before any source is read: which template, how big a budget, and the clock the timings are measured against. */
export interface AssemblyRun extends AssemblyRequest {
  query: string;
  crossRepo: boolean | undefined;
  startedAt: number;
  timings: Record<string, number>;
}

export function assemblyRun(
  query: string,
  options: { templateName?: string; maxTokens?: number; crossRepo?: boolean },
): AssemblyRun {
  const templateName = options.templateName ?? "default";

  return {
    query,
    templateName,
    minTokens: assemblyBudget(templateName, options.maxTokens),
    crossRepo: options.crossRepo,
    template: getTemplate(templateName),
    startedAt: Date.now(),
    timings: {},
  };
}

/** What every store's assembly shares once its sections are read: the budget handed out by priority, the block serialized, and each section's record for the trace. */
export function packedAssembly(
  run: AssemblyRun,
  fetched: FetchedSection[],
  freshness: { warning: string },
) {
  const { serialized, traceSections } = allocateSections(
    fetched,
    run.minTokens,
  );

  return {
    result: composeAssembled(run, serialized, freshness),
    traceSections,
  };
}

/** Every section the template asks for. `cross_repo` is consulted ONLY when explicitly requested: a linked repo's context is useful when someone asked for it and noise when they did not, and the transfer-score filter downstream cannot tell the difference. */
export async function fetchSections(
  run: AssemblyRun,
  readSection: SectionReader,
) {
  return fetchAllSections(
    activeSections(run.template, run),
    readSection,
    run.timings,
  );
}

/** Fetch every active section in parallel, timing each; a reader throwing counts as an empty error result rather than failing the whole assembly. */
async function fetchAllSections(
  activeSections: TemplateSection[],
  readSection: SectionReader,
  timings: Record<string, number>,
): Promise<FetchedSection[]> {
  return Promise.all(
    activeSections.map(async (section) => {
      const t0 = Date.now();
      let res: FetchResult;

      try {
        res = await readSection(section);
      } catch {
        res = { sources: [], status: "error" };
      }
      timings[section.source] = Date.now() - t0;

      return { section, res };
    }),
  );
}

/** The XML-tagged text an agent receives, plus the per-section token counts. An assembly that found NOTHING still returns the freshness warning on its own — silence would read as "your context is fine" rather than "there is none". */
function composeAssembled(
  request: { query: string; templateName: string; minTokens: number },
  serialized: Parameters<typeof serializeContext>[1],
  freshness: { warning: string },
): AssembledResult {
  const body = serializeContext(
    {
      query: request.query,
      template: request.templateName,
      budget: request.minTokens,
    },
    serialized,
  );

  return {
    text: serialized.length > 0 ? freshness.warning + body : freshness.warning,
    sections: sectionTokenCounts(serialized),
  };
}

/** Per-section token counts as the caller sees them — one entry per section that made it into the block. */
function sectionTokenCounts(
  serialized: Parameters<typeof serializeContext>[1],
) {
  return serialized.map((s) => ({
    header: s.header,
    tokens: s.documents.reduce((sum, i) => sum + i.tokens, 0),
    truncated: s.truncated,
  }));
}

export function traceInput(
  run: AssemblyRun,
  assembled: ReturnType<typeof packedAssembly>,
  health: Pick<DebugTraceInput, "freshness" | "embedderDegraded">,
): DebugTraceInput {
  return {
    ...run,
    ...health,
    traceSections: assembled.traceSections,
    sections: assembled.result.sections,
  };
}

/** Composes the bundle and hangs the optional annotations on it: the debug trace (which records what each source contributed and how long it took) and the context refs (which a merged PR later boosts the half-life of, and a rejected one penalises). */
export function annotate(
  result: AssembledResult,
  trace: DebugTraceInput | null,
  refs: AssembledRefs,
): AssembledResult {
  if (trace) {
    result.trace = buildAssemblyTrace(trace);
  }
  applyContextRefs(result, refs);

  return result;
}

function applyContextRefs(result: AssembledResult, refs: AssembledRefs): void {
  if (refs.factIds.length > 0 || refs.memoryIds.length > 0) {
    result.context_refs = {
      fact_ids: refs.factIds,
      memory_ids: refs.memoryIds,
    };
  }
}

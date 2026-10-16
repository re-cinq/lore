// Context assembly: retrieves from all sources into a structured, token-budgeted, XML-tagged block; `debug` adds a full per-source trace (context-assembly-format.ts).

import type { PgPool } from "../../memory-store.js";
import { serializeContext } from "./context-assembly-format.js";
import {
  activeSections,
  getTemplate,
  loadTemplates,
} from "./context-assembly-templates.js";
import type { TemplateSection } from "./context-assembly-templates.js";
import {
  collectAssembledRefs,
  emptyAssembledRefs,
  type AssembledRefs,
} from "./context-assembly-items.js";
import {
  fetchCouplingSource,
  type GraphContextSource,
} from "./context-assembly-coupling.js";
import { fetchers, type SourceFetcher } from "./context-assembly-fetchers.js";
import {
  allocateSections,
  assemblyBudget,
  halfBudget,
  type FetchedSection,
} from "./context-assembly-budget.js";
import {
  computeFreshness,
  embeddingWarning,
  resolveFreshness,
} from "./context-assembly-freshness.js";
import {
  embeddingHealth,
  embedderDegraded,
} from "../../embeddings/embedding-service.js";
import type {
  FetchStatus,
  FetchResult,
  TraceSection,
} from "./context-assembly-types.js";
import {
  labelledByBackend,
  utopiaAssemblyFor,
} from "./context-assembly-backends.js";
import type { KnowledgeBackend } from "../../../domain/knowledge-backend.js";
import {
  buildAssemblyTrace,
  type AssemblyTrace,
  type DebugTraceInput,
} from "./context-assembly-trace.js";

export {
  loadTemplates,
  computeFreshness,
  embeddingWarning,
  fetchers,
  fetchCouplingSource,
};
export {
  fitItemsToBudget,
  extractKeyTerms,
  dropSeen,
} from "./context-assembly-items.js";
export {
  hybridChunkItems,
  hybridChunkSearch,
} from "./context-assembly-chunk-search.js";
export { formatCouplingItems } from "./context-assembly-coupling.js";
export type { FetchStatus, FetchResult, TraceSection, AssemblyTrace };

export interface AssembledResult {
  text: string;
  sections: { header: string; tokens: number; truncated: boolean }[];
  trace?: AssemblyTrace;
  context_refs?: { fact_ids: string[]; memory_ids: string[] };
}

export interface AssembleOptions {
  templateName?: string;
  maxTokens?: number;
  repo?: string;
  agentId?: string;
  crossRepo?: boolean;
  includeIds?: boolean;
  debug?: boolean;
  graph?: GraphContextSource | null;
  /** Assemble without recording that anything was retrieved: for measuring what an agent would get (context evals), not for an agent. */
  passive?: boolean;
  /** Which store answers (ADR-052 amendment 2026-10-16); "lore" when absent. */
  backend?: KnowledgeBackend;
}

/** One assembly from the chosen store. "both" is Lore's then Utopia's, each labelled and each on half the budget, so the two are compared at the same cost as one. */
export async function assembleContext(
  pool: PgPool,
  query: string,
  options: AssembleOptions = {},
): Promise<AssembledResult> {
  const backend = options.backend ?? "lore";

  if (backend !== "both") {
    return backend === "lore"
      ? assembleFromLore(pool, query, options)
      : utopiaAssemblyFor(query, options);
  }
  const halved = {
    ...options,
    maxTokens: halfBudget(options.templateName, options.maxTokens),
  };

  return labelledByBackend(
    await assembleFromLore(pool, query, halved),
    utopiaAssemblyFor(query, halved),
  );
}

async function assembleFromLore(
  pool: PgPool,
  query: string,
  options: AssembleOptions,
): Promise<AssembledResult> {
  const { repo, agentId, includeIds, debug, graph, passive } = options;
  const run = assemblyRun(query, options);
  const assembled = await assembleSections(
    run,
    { pool, graph, query, repo, agentId, passive },
    { crossRepo: run.crossRepo, timings: run.timings },
  );
  const refs = includeIds
    ? await collectAssembledRefs(pool, query, agentId)
    : emptyAssembledRefs;

  const trace = debug ? traceInput(run, assembled) : null;

  return annotate(assembled.result, trace, refs);
}

interface AssemblyRequest {
  template: ReturnType<typeof getTemplate>;
  templateName: string;
  minTokens: number;
}

/** One assembly's parameters, fixed before any source is read: which template, how big a budget, and the clock the timings are measured against. */
interface AssemblyRun extends AssemblyRequest {
  query: string;
  crossRepo: boolean | undefined;
  startedAt: number;
  timings: Record<string, number>;
}

function assemblyRun(query: string, options: AssembleOptions): AssemblyRun {
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

/** Every section fetched, packed into the budget, and serialized into one block. */
async function assembleSections(
  { template, templateName, minTokens }: AssemblyRequest,
  sources: Parameters<typeof fetchSections>[1],
  fetchOptions: Parameters<typeof fetchSections>[2],
) {
  // Freshness is read BEFORE the sections: it tells the caller its context may be out of date, which matters most when the assembly otherwise succeeded.
  const ingestFreshness = await resolveFreshness(sources.pool, sources.repo);
  const { serialized, traceSections } = allocateSections(
    await fetchSections(template, sources, fetchOptions),
    minTokens,
  );
  const { freshness, degraded } = withEmbedderBanner(ingestFreshness);
  const result = composeAssembled(
    { query: sources.query, templateName, minTokens },
    serialized,
    freshness,
  );

  return { result, traceSections, freshness, embedderDegraded: degraded };
}

interface SectionFetchContext {
  pool: PgPool;
  graph: GraphContextSource | null | undefined;
  query: string;
  repo?: string;
  agentId?: string;
  passive?: boolean;
}

/** Every section the template asks for. `cross_repo` is consulted ONLY when explicitly requested: a linked repo's context is useful when someone asked for it and noise when they did not, and the transfer-score filter downstream cannot tell the difference. */
async function fetchSections(
  template: ReturnType<typeof getTemplate>,
  sources: Parameters<typeof fetchAllSections>[1],
  opts: { crossRepo: boolean | undefined; timings: Record<string, number> },
) {
  return fetchAllSections(
    activeSections(template, opts),
    sources,
    opts.timings,
  );
}

/** Fetch every active section in parallel, timing each; a fetcher throwing counts as an empty error result rather than failing the whole assembly. */
async function fetchAllSections(
  activeSections: TemplateSection[],
  ctx: SectionFetchContext,
  timings: Record<string, number>,
): Promise<FetchedSection[]> {
  return Promise.all(
    activeSections.map(async (section) => {
      const t0 = Date.now();
      const fetcher = fetchers[section.source];
      let res: FetchResult;

      try {
        res = await fetchSectionSource(section.source, fetcher, ctx);
      } catch {
        res = { sources: [], status: "error" };
      }
      timings[section.source] = Date.now() - t0;

      return { section, res };
    }),
  );
}

/** Route one section to its source; the coupling source reads the spec-traceability graph through the trace port, not the Postgres pool. */
async function fetchSectionSource(
  source: string,
  fetcher: SourceFetcher | undefined,
  ctx: SectionFetchContext,
): Promise<FetchResult> {
  if (source === "coupling") {
    return fetchCouplingSource(ctx.graph ?? null, ctx.repo, ctx.query);
  }

  if (fetcher) {
    return fetcher(ctx.pool, ctx.query, ctx.repo, {
      agentId: ctx.agentId,
      passive: ctx.passive,
    });
  }

  return { sources: [], status: "error" };
}

/** The ingest banner plus, when the embedder is degraded, the keyword-only one. Read AFTER the sections: their embedding calls are what says whether the embedder is answering right now. */
function withEmbedderBanner(ingestFreshness: {
  state: string;
  warning: string;
}): { freshness: { state: string; warning: string }; degraded: boolean } {
  const health = embeddingHealth();

  return {
    freshness: {
      ...ingestFreshness,
      warning: ingestFreshness.warning + embeddingWarning(health),
    },
    degraded: embedderDegraded(health),
  };
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

function traceInput(
  run: AssemblyRun,
  assembled: Awaited<ReturnType<typeof assembleSections>>,
): DebugTraceInput {
  return {
    ...run,
    traceSections: assembled.traceSections,
    sections: assembled.result.sections,
    freshness: assembled.freshness,
    embedderDegraded: assembled.embedderDegraded,
  };
}

/** Composes the bundle and hangs the optional annotations on it: the debug trace (which records what each source contributed and how long it took) and the context refs (which a merged PR later boosts the half-life of, and a rejected one penalises). */
function annotate(
  result: AssembledResult,
  trace: Parameters<typeof buildAssemblyTrace>[0] | null,
  refs: Awaited<ReturnType<typeof collectAssembledRefs>>,
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

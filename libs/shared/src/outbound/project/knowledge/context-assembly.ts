// Context assembly: retrieves from all sources into a structured, token-budgeted, XML-tagged block; `debug` adds a full per-source trace (context-assembly-format.ts).

import { searchMemories } from "./memory-search.js";
import type { DgraphClientPort, PgPool } from "../../memory-store.js";
import { serializeContext } from "./context-assembly-format.js";
import { getTemplate, loadTemplates } from "./context-assembly-templates.js";
import type { TemplateSection } from "./context-assembly-templates.js";
import { collectContextRefIds } from "./context-assembly-items.js";
import { fetchCouplingSource } from "./context-assembly-coupling.js";
import { fetchers, type SourceFetcher } from "./context-assembly-fetchers.js";
import {
  allocateSections,
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
export { hybridChunkItems } from "./context-assembly-chunk-search.js";
export { formatCouplingItems } from "./context-assembly-coupling.js";
export type { FetchStatus, FetchResult, TraceSection, AssemblyTrace };

export interface AssembledResult {
  text: string;
  sections: { header: string; tokens: number; truncated: boolean }[];
  trace?: AssemblyTrace;
  context_refs?: { fact_ids: string[]; memory_ids: string[] };
}

// Per-template default token budgets; research keeps the old 16K ceiling since it's memory/episode-heavy.
const TEMPLATE_DEFAULT_BUDGETS: Record<string, number | undefined> = {
  default: 8000,
  implementation: 8000,
  review: 8000,
  research: 16000,
};

export interface AssembleOptions {
  templateName?: string;
  maxTokens?: number;
  repo?: string;
  agentId?: string;
  crossRepo?: boolean;
  includeIds?: boolean;
  debug?: boolean;
  dgraph?: DgraphClientPort | null;
}

export async function assembleContext(
  pool: PgPool,
  query: string,
  options: AssembleOptions = {},
): Promise<AssembledResult> {
  const { repo, agentId, includeIds, debug, dgraph } = options;
  const run = assemblyRun(query, options);
  const assembled = await assembleSections(
    run,
    { pool, dgraph, query, repo, agentId },
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

/** Never below 2000 tokens: a budget small enough to fit nothing still costs a request, and an agent that receives an empty block cannot tell it from a repo with no context at all. */
function assemblyBudget(templateName: string, maxTokens?: number): number {
  return Math.max(resolveEffectiveMax(templateName, maxTokens), 2000);
}

function resolveEffectiveMax(
  templateName: string,
  maxTokens: number | undefined,
): number {
  return maxTokens ?? TEMPLATE_DEFAULT_BUDGETS[templateName] ?? 8000;
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
  dgraph: DgraphClientPort | null | undefined;
  query: string;
  repo?: string;
  agentId?: string;
}

/** Every section the template asks for. `cross_repo` is consulted ONLY when explicitly requested: a linked repo's context is useful when someone asked for it and noise when they did not, and the transfer-score filter downstream cannot tell the difference. */
async function fetchSections(
  template: ReturnType<typeof getTemplate>,
  sources: Parameters<typeof fetchAllSections>[1],
  opts: { crossRepo: boolean | undefined; timings: Record<string, number> },
) {
  return fetchAllSections(
    template.sections.filter(
      (s) => s.source !== "cross_repo" || opts.crossRepo,
    ),
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

/** Route one section to its source; the coupling source reads the spec-traceability graph (Dgraph), not the Postgres pool. */
async function fetchSectionSource(
  source: string,
  fetcher: SourceFetcher | undefined,
  ctx: {
    pool: PgPool;
    dgraph: DgraphClientPort | null | undefined;
    query: string;
    repo?: string;
    agentId?: string;
  },
): Promise<FetchResult> {
  if (source === "coupling") {
    return fetchCouplingSource(ctx.dgraph ?? null, ctx.repo, ctx.query);
  }

  if (fetcher) {
    return fetcher(ctx.pool, ctx.query, ctx.repo, ctx.agentId);
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

interface AssembledRefs {
  factIds: string[];
  memoryIds: string[];
}

const emptyAssembledRefs: AssembledRefs = { factIds: [], memoryIds: [] };

/** Context refs for outcome feedback; a search failure is non-fatal — the assembly still returns without refs. */
async function collectAssembledRefs(
  pool: PgPool,
  query: string,
  agentId: string | undefined,
): Promise<AssembledRefs> {
  const factIds: string[] = [];
  const memoryIds: string[] = [];

  try {
    const results = await searchMemories(pool, query, { agentId, limit: 20 });

    collectContextRefIds(results, memoryIds, factIds);
  } catch {
    /* non-fatal */
  }

  return { factIds, memoryIds };
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

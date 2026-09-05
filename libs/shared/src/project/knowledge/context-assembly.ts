// Context assembly: retrieves from all sources into a structured, token-budgeted, XML-tagged block; `debug` adds a full per-source trace (context-assembly-format.ts).

import { searchMemories } from "./memory-search.js";
import type { DgraphClientPort, PgPool } from "../../memory-store.js";
import { serializeContext } from "./context-assembly-format.js";
import {
  getTemplate,
  loadTemplates,
  type Template,
} from "./context-assembly-templates.js";
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
  resolveFreshness,
  type FreshnessInfo,
} from "./context-assembly-freshness.js";
import type {
  FetchStatus,
  FetchResult,
  TraceSection,
} from "./context-assembly-types.js";

export { loadTemplates, computeFreshness, fetchers, fetchCouplingSource };
export {
  fitItemsToBudget,
  extractKeyTerms,
  dropSeen,
} from "./context-assembly-items.js";
export { hybridChunkItems } from "./context-assembly-chunk-search.js";
export { formatCouplingItems } from "./context-assembly-coupling.js";
export type { FetchStatus, FetchResult, TraceSection };

export interface AssemblyTrace {
  query: string;
  template: string;
  effectiveBudget: number;
  crossRepo: boolean;
  templateSections: {
    header: string;
    source: string;
    priority: number;
    max_tokens?: number;
  }[];
  sections: TraceSection[];
  budget: { total: number; used: number; leftover: number };
  freshness: { state: string; message: string };
  timingsMs: { total: number; perSource: Record<string, number> };
}

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

function resolveEffectiveMax(
  templateName: string,
  maxTokens: number | undefined,
): number {
  return maxTokens ?? TEMPLATE_DEFAULT_BUDGETS[templateName] ?? 8000;
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
    return fetchCouplingSource(ctx.dgraph ?? null, ctx.repo);
  }

  if (fetcher) {
    return fetcher(ctx.pool, ctx.query, ctx.repo, ctx.agentId);
  }

  return { sources: [], status: "error" };
}

interface SectionFetchContext {
  pool: PgPool;
  dgraph: DgraphClientPort | null | undefined;
  query: string;
  repo?: string;
  agentId?: string;
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

function applyContextRefs(result: AssembledResult, refs: AssembledRefs): void {
  if (refs.factIds.length > 0 || refs.memoryIds.length > 0) {
    result.context_refs = {
      fact_ids: refs.factIds,
      memory_ids: refs.memoryIds,
    };
  }
}

interface DebugTraceInput {
  query: string;
  templateName: string;
  minTokens: number;
  crossRepo: boolean | undefined;
  template: Template;
  traceSections: TraceSection[];
  sections: { header: string; tokens: number; truncated: boolean }[];
  freshness: FreshnessInfo;
  startedAt: number;
  timings: Record<string, number>;
}

function buildAssemblyTrace(input: DebugTraceInput): AssemblyTrace {
  const used = input.sections.reduce((sum, s) => sum + s.tokens, 0);

  return {
    query: input.query,
    template: input.templateName,
    effectiveBudget: input.minTokens,
    crossRepo: !!input.crossRepo,
    templateSections: input.template.sections.map((s) => ({
      header: s.header,
      source: s.source,
      priority: s.priority,
      max_tokens: s.max_tokens,
    })),
    sections: input.traceSections,
    budget: {
      total: input.minTokens,
      used,
      leftover: Math.max(0, input.minTokens - used),
    },
    freshness: {
      state: input.freshness.state,
      message: input.freshness.warning.trim(),
    },
    timingsMs: {
      total: Date.now() - input.startedAt,
      perSource: input.timings,
    },
  };
}

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
  {
    templateName = "default",
    maxTokens,
    repo,
    agentId,
    crossRepo,
    includeIds,
    debug,
    dgraph,
  }: AssembleOptions = {},
): Promise<AssembledResult> {
  const startedAt = Date.now();
  const template = getTemplate(templateName);
  const minTokens = Math.max(
    resolveEffectiveMax(templateName, maxTokens),
    2000,
  );
  const freshness = await resolveFreshness(pool, repo);

  // cross_repo is only consulted when explicitly requested.
  const activeSections = template.sections.filter(
    (s) => s.source !== "cross_repo" || crossRepo,
  );
  const timings: Record<string, number> = {};
  const fetched = await fetchAllSections(
    activeSections,
    { pool, dgraph, query, repo, agentId },
    timings,
  );
  const { serialized, traceSections } = allocateSections(fetched, minTokens);
  const refs = includeIds
    ? await collectAssembledRefs(pool, query, agentId)
    : emptyAssembledRefs;

  // Build the final XML-tagged text.
  const body = serializeContext(
    { query, template: templateName, budget: minTokens },
    serialized,
  );
  const text =
    serialized.length > 0 ? freshness.warning + body : freshness.warning;
  const sections = serialized.map((s) => ({
    header: s.header,
    tokens: s.documents.reduce((sum, i) => sum + i.tokens, 0),
    truncated: s.truncated,
  }));
  const result: AssembledResult = { text, sections };

  if (debug) {
    result.trace = buildAssemblyTrace({
      query,
      templateName,
      minTokens,
      crossRepo,
      template,
      traceSections,
      sections,
      freshness,
      startedAt,
      timings,
    });
  }
  applyContextRefs(result, refs);

  return result;
}

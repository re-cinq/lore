// Context assembly: retrieves from all sources into a structured, token-budgeted, XML-tagged block; `debug` adds a full per-source trace (context-assembly-format.ts).

import type { PgPool } from "../../memory-store.js";
import { loadTemplates } from "./context-assembly-templates.js";
import {
  collectAssembledRefs,
  emptyAssembledRefs,
} from "./context-assembly-items.js";
import {
  fetchCouplingSource,
  type GraphContextSource,
} from "./context-assembly-coupling.js";
import { fetchers, type SourceFetcher } from "./context-assembly-fetchers.js";
import { halfBudget } from "./context-assembly-budget.js";
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
  SectionReader,
  TraceSection,
} from "./context-assembly-types.js";
import {
  labelledByBackend,
  utopiaAssemblyFor,
} from "./context-assembly-backends.js";
import type { KnowledgeBackend } from "../../../domain/knowledge-backend.js";
import type { UtopiaReads } from "../../utopia/utopia-reads.js";
import {
  utopiaArmOf,
  utopiaSectionReader,
  type UtopiaMirror,
} from "./context-assembly-utopia.js";
import type { AssemblyTrace } from "./context-assembly-trace.js";
import {
  annotate,
  assemblyRun,
  fetchSections,
  packedAssembly,
  traceInput,
  type AssembledResult,
  type AssemblyRun,
} from "./context-assembly-pipeline.js";

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
export type {
  FetchStatus,
  FetchResult,
  TraceSection,
  AssemblyTrace,
  AssembledResult,
};

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
  /** Utopia's read client; null on a deployment without one. */
  utopiaReads?: UtopiaReads | null;
  /** The repository's mirror (`settings.utopia`); absent when it has none. */
  utopiaMirror?: UtopiaMirror;
}

/** One assembly from the chosen store. "both" is Lore's then Utopia's, each labelled and each on half the budget, so the two are compared at the same cost as one. */
export async function assembleContext(
  pool: PgPool,
  query: string,
  options: AssembleOptions = {},
): Promise<AssembledResult> {
  const backend = options.backend ?? "lore";

  if (backend === "lore") {
    return assembleFromLore(pool, query, options);
  }

  return backend === "utopia"
    ? assembleFromUtopia(query, options)
    : assembleSideBySide(pool, query, options);
}

async function assembleSideBySide(
  pool: PgPool,
  query: string,
  options: AssembleOptions,
): Promise<AssembledResult> {
  const halved = {
    ...options,
    maxTokens: halfBudget(options.templateName, options.maxTokens),
  };
  const [lore, utopia] = await Promise.all([
    assembleFromLore(pool, query, halved),
    assembleFromUtopia(query, halved),
  ]);

  return labelledByBackend(lore, utopia);
}

async function assembleFromLore(
  pool: PgPool,
  query: string,
  options: AssembleOptions,
): Promise<AssembledResult> {
  const { agentId, includeIds, debug } = options;
  const run = assemblyRun(query, options);
  const { fetched, health } = await readLoreSections(pool, run, options);
  const assembled = packedAssembly(run, fetched, health.freshness);
  const refs = includeIds
    ? await collectAssembledRefs(pool, query, agentId)
    : emptyAssembledRefs;

  return annotate(
    assembled.result,
    debug ? traceInput(run, assembled, health) : null,
    refs,
  );
}

async function readLoreSections(
  pool: PgPool,
  run: AssemblyRun,
  { repo, agentId, graph, passive }: AssembleOptions,
) {
  const { query } = run;
  // Freshness is read BEFORE the sections: it tells the caller its context may be out of date, which matters most when the assembly otherwise succeeded.
  const ingestFreshness = await resolveFreshness(pool, repo);
  const fetched = await fetchSections(
    run,
    loreSectionReader({ pool, graph, query, repo, agentId, passive }),
  );
  const { freshness, degraded } = withEmbedderBanner(ingestFreshness);

  return { fetched, health: { freshness, embedderDegraded: degraded } };
}

/** Utopia keeps no ingest clock Lore reads, and its search is not Lore's embedder: no banner either way. */
const UTOPIA_FRESHNESS = { state: "unknown", warning: "" };

/** Utopia's assembly through the same sections, budget and trace as Lore's when the repository has a mirror and the deployment a reader; otherwise every section says it has no Utopia reader yet. */
async function assembleFromUtopia(
  query: string,
  options: AssembleOptions,
): Promise<AssembledResult> {
  const arm = utopiaArmOf(options.utopiaReads, options.utopiaMirror);

  if (!arm) {
    return utopiaAssemblyFor(query, options);
  }
  const run = assemblyRun(query, options);
  const fetched = await fetchSections(run, utopiaSectionReader(arm, query));
  const assembled = packedAssembly(run, fetched, UTOPIA_FRESHNESS);
  const trace = options.debug
    ? traceInput(run, assembled, {
        freshness: UTOPIA_FRESHNESS,
        embedderDegraded: false,
      })
    : null;

  return annotate(assembled.result, trace, emptyAssembledRefs);
}

interface SectionFetchContext {
  pool: PgPool;
  graph: GraphContextSource | null | undefined;
  query: string;
  repo?: string;
  agentId?: string;
  passive?: boolean;
}

function loreSectionReader(ctx: SectionFetchContext): SectionReader {
  return (section) =>
    fetchSectionSource(section.source, fetchers[section.source], ctx);
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

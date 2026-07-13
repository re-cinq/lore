/**
 * The runtime-agnostic spec-traceability projection core. Reads a repo's
 * markdown via an injected reader and projects a `kind` (specs/adrs) into the
 * trace graph. Used by the CI-driven spec-trace trigger (spec-trace-dispatch) —
 * docs no longer flow as pipeline tasks; this is their only lane. Test
 * projection is CI-only too (lore-tests.yml → /test-report + /coverage), so
 * there is no longer a graph-ingest task wrapper here.
 */

import {
  runIngestGraph,
  type IngestGraphSummary,
  type IngestKind,
  type DgraphClientPort,
} from "@re-cinq/lore-shared";

export interface RepoReader {
  tree(ref?: string): Promise<string[]>;
  read(path: string, ref?: string): Promise<string | null>;
}

/**
 * Reads the repo's files via the injected reader and projects `kind` into the
 * graph. The injected deps (repo reader / dgraph) are the only thing that
 * differs between runtime contexts.
 */
export async function projectRepoGraph(
  params: {
    kind: IngestKind;
    repo: string;
    ref?: string;
    glob?: string;
    force?: boolean;
  },
  deps: { repo: RepoReader; dgraph: DgraphClientPort | null },
): Promise<IngestGraphSummary> {
  return runIngestGraph(params, {
    dgraph: deps.dgraph,
    listTree: (r) => deps.repo.tree(r),
    readFile: async (path, r) => (await deps.repo.read(path, r)) ?? "",
  });
}

import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import {
  createDgraphClient,
  ingestSpecTrace,
  projectAdrFile,
  projectSpecFile,
  deleteSpecSubtree,
  deleteAdrSubtree,
  pruneTestFiles,
  type SpecTraceOutcome,
  type DgraphClientPort,
} from "@re-cinq/lore-shared";

/** The graph writes one incremental delta needs, as a seam the route's tests can replace. */
export interface IngestDeltaDeps {
  /** Availability gate + the client the default projectors close over. */
  dgraph(): DgraphClientPort | null;
  projectSpec(
    repo: string,
    path: string,
    content: string,
  ): Promise<{ projected: boolean }>;
  projectAdr(
    repo: string,
    path: string,
    content: string,
  ): Promise<{ projected: boolean }>;
  deleteSpec(repo: string, path: string): Promise<void>;
  deleteAdr(repo: string, path: string): Promise<void>;
  ingestReport(repo: string, payload: unknown): Promise<SpecTraceOutcome>;
  pruneTests(repo: string, files: string[]): Promise<{ prunedChunks: number }>;
}

/** The client every projector needs; a delta that reached here without one is a wiring bug, not a request error. */
function requireClient(
  dgraph: () => DgraphClientPort | null,
): DgraphClientPort {
  const client = dgraph();

  enforceTrue(client, Error, "ingest-delta: no dgraph client");

  return client!;
}

/** The production deps, with the dgraph client created once and shared by every projector. */
export const defaultDeps = (): IngestDeltaDeps => {
  let client: DgraphClientPort | null | undefined;
  const dgraph = () =>
    client === undefined ? (client = createDgraphClient()) : client;
  const must = () => requireClient(dgraph);

  return {
    dgraph,
    projectSpec: (repo, path, content) =>
      projectSpecFile({ repo, filePath: path, content }, must()),
    projectAdr: (repo, path, content) =>
      projectAdrFile({ repo, filePath: path, content }, must()),
    deleteSpec: (repo, path) => deleteSpecSubtree(must(), repo, path),
    deleteAdr: (repo, path) => deleteAdrSubtree(must(), repo, path),
    ingestReport: (repo, payload) =>
      ingestSpecTrace(must(), repo, "test-report", payload),
    pruneTests: (repo, files) => pruneTestFiles(must(), repo, files),
  };
};

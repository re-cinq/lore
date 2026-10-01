import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import {
  createDgraphClient,
  ingestSpecTrace,
  projectAdrFile,
  projectSpecFile,
  listGraphDocPaths,
  deleteSpecSubtree,
  deleteAdrSubtree,
  pruneTestFiles,
  type SpecTraceOutcome,
  type DgraphClientPort,
} from "@re-cinq/lore-shared";
import { projectFor } from "../../../outbound/project-boot.js";

/** How one doc file is projected: `force` re-projects a file whose content hash has not changed. */
export interface DocProjection {
  force: boolean;
}

type ProjectDoc = (
  repo: string,
  path: string,
  content: string,
  projection: DocProjection,
) => Promise<{ projected: boolean }>;

/** The graph writes one incremental delta needs, as a seam the route's tests can replace. */
export interface IngestDeltaDeps {
  /** Availability gate + the client the default projectors close over. */
  dgraph(): DgraphClientPort | null;
  projectSpec: ProjectDoc;
  projectAdr: ProjectDoc;
  /** Every spec path the graph holds for the repo, which a full ingest prunes against. */
  listSpecs(repo: string): Promise<string[]>;
  listAdrs(repo: string): Promise<string[]>;
  deleteSpec(repo: string, path: string): Promise<void>;
  deleteAdr(repo: string, path: string): Promise<void>;
  ingestReport(repo: string, payload: unknown): Promise<SpecTraceOutcome>;
  pruneTests(repo: string, files: string[]): Promise<{ prunedChunks: number }>;
  /** The repo's default branch: a test report for any other branch is work in flight and goes to that branch's overlay. */
  defaultBranch(repo: string): Promise<string>;
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
    projectSpec: (repo, path, content, projection) =>
      projectSpecFile({ repo, filePath: path, content }, must(), projection),
    projectAdr: (repo, path, content, projection) =>
      projectAdrFile({ repo, filePath: path, content }, must(), projection),
    listSpecs: (repo) => listGraphDocPaths(must(), "Spec", repo),
    listAdrs: (repo) => listGraphDocPaths(must(), "ADR", repo),
    deleteSpec: (repo, path) => deleteSpecSubtree(must(), repo, path),
    deleteAdr: (repo, path) => deleteAdrSubtree(must(), repo, path),
    ingestReport: (repo, payload) =>
      ingestSpecTrace(must(), repo, "test-report", payload),
    pruneTests: (repo, files) => pruneTestFiles(must(), repo, files),
    defaultBranch: async (repo) =>
      (await projectFor(repo)).repo.defaultBranch(),
  };
};

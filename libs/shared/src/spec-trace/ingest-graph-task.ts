/** ingest-graph-task — deterministic, zero-LLM orchestrator turning specs/ADRs/tests into the spec-traceability graph; idempotent via content_hash (unchanged files tally as `skipped`). */

import { ingestTestsKind, runKindIngest } from "./ingest-graph-run.js";
import {
  INGEST_KINDS,
  skippedSummary,
  type IngestGraphParams,
  type IngestGraphPorts,
  type IngestGraphSummary,
  type IngestKindDef,
} from "./ingest-graph-registry.js";

export {
  selectIngestFiles,
  summarizeIngest,
  chunkGlobsForKind,
  INGEST_KINDS,
  type IngestKind,
  type IngestGraphParams,
  type IngestGraphSummary,
  type IngestGraphPorts,
  type IngestKindDef,
  type IngestScope,
  type IngestCounts,
} from "./ingest-graph-registry.js";

export async function runIngestGraph(
  params: IngestGraphParams,
  ports: IngestGraphPorts,
  registry: Record<string, IngestKindDef> = INGEST_KINDS,
): Promise<IngestGraphSummary> {
  if (!ports.dgraph) {
    return skippedSummary(
      params.kind,
      "Dgraph not configured (LORE_DGRAPH_HTTP unset)",
    );
  }

  if (params.kind === "tests") {
    return ingestTestsKind(params.repo, ports.dgraph, ports.buildTestReport);
  }

  const def = registry[params.kind];

  if (!def) {
    return skippedSummary(params.kind, `unknown ingest kind "${params.kind}"`);
  }

  return runKindIngest({ params, ports, dgraph: ports.dgraph, def, registry });
}

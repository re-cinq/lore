// The ingest station (specs/ingest-station FR1): one pod runs one
// internal.ingest.* payload. Docs kinds (specs/adrs) project from the LOCAL
// CLONE at $WORKSPACE_DIR/target — the init container's checkout, so no GitHub
// App creds ride in the pod (ADR-031 D7) — and write dgraph directly via
// LORE_DGRAPH_HTTP, the label-scoped egress this station type alone receives
// (FR4). Payload kinds (test-report/coverage) arrive with FR3
// (payload-by-reference); until then they are rejected loudly.

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import {
  runIngestGraph,
  createDgraphClient,
  INGEST_KINDS,
  type DgraphClientPort,
  type IngestGraphSummary,
} from "@re-cinq/lore-shared";
import type { NodeResult } from "@re-cinq/lore-assembly-lines";
import type { StationInput } from "../input.js";

// Derived, not parallel: INGEST_KINDS holds exactly the file-projectable doc
// kinds (tests is special-cased inside runIngestGraph, payload kinds are FR3).
const DOC_KINDS = new Set(Object.keys(INGEST_KINDS));
// Keeps the extras value well under the ~1 KB stage-commit trailer guidance
// (station-contract.md) — long detail belongs in the log lines.
const FAILED_FILES_MAX = 900;

export interface IngestStationDeps {
  /** The init container's checkout root (defaults to $WORKSPACE_DIR/target). */
  workspaceDir?: string;
  /** Injectable dgraph port; defaults to LORE_DGRAPH_HTTP via createDgraphClient. */
  dgraph?: DgraphClientPort | null;
  /** Injectable embedder for tests; defaults to Vertex. */
  embed?: (text: string) => Promise<number[] | null>;
}

/** Walks the clone for every file path, repo-relative with forward slashes. */
async function listClone(root: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(join(root, prefix), { withFileTypes: true });
  const paths: string[] = [];

  for (const entry of entries) {
    if (entry.name === ".git") {
      continue;
    }
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      paths.push(...(await listClone(root, rel)));
    } else {
      paths.push(rel);
    }
  }

  return paths;
}

function summaryExtras(summary: IngestGraphSummary): Record<string, string> {
  const extras: Record<string, string> = {
    "Lore-Ingest-Summary": `projected=${summary.projected} skipped=${summary.skipped} failed=${summary.failed}`,
  };

  if (summary.failed > 0) {
    extras["Lore-Ingest-Failed-Files"] = summary.failedFiles
      .join(", ")
      .slice(0, FAILED_FILES_MAX);
  }

  return extras;
}

export async function runIngestStation(
  input: StationInput,
  deps: IngestStationDeps = {},
): Promise<NodeResult> {
  const kind = input.params.kind as string | undefined;

  enforceTrue(
    kind !== undefined && DOC_KINDS.has(kind),
    Error,
    `ingest station: no ingest handler for kind "${kind}" (payload kinds land with FR3)`,
  );
  const workspaceDir =
    deps.workspaceDir ??
    join(process.env.WORKSPACE_DIR ?? "/workspace", "target");
  const dgraph = deps.dgraph === undefined ? createDgraphClient() : deps.dgraph;

  enforceTrue(
    dgraph,
    Error,
    "ingest station: LORE_DGRAPH_HTTP not configured — the def-ingest recipe must inject it (FR4)",
  );

  const summary = await runIngestGraph(
    {
      kind: kind as "specs" | "adrs",
      repo: input.repo,
      glob: input.params.glob as string | undefined,
      force: input.params.force === "true",
    },
    {
      dgraph,
      listTree: () => listClone(workspaceDir),
      readFile: async (path: string) =>
        readFile(join(workspaceDir, path), "utf8"),
      embed: deps.embed,
    },
  );

  // Partial failure routes the line's failed edge — never a silent success
  // with files missing (same contract as the Floor handler it replaces).
  return {
    outcome: summary.failed > 0 ? "failed" : "success",
    extras: summaryExtras(summary),
  };
}

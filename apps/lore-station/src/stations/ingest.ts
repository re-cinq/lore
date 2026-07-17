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
  ingestSpecTrace,
  INGEST_KINDS,
  type DgraphClientPort,
  type IngestGraphSummary,
} from "@re-cinq/lore-shared";
import type { NodeResult } from "@re-cinq/lore-assembly-lines";
import type { StationInput } from "../input.js";

// Derived, not parallel: INGEST_KINDS holds exactly the file-projectable doc
// kinds (tests is special-cased inside runIngestGraph).
const DOC_KINDS = new Set(Object.keys(INGEST_KINDS));
// Payload kinds arrive by reference (FR3): the body lives on the scheduling
// pipeline.events row; station_input carries only payload_event_id.
const PAYLOAD_KINDS = new Set(["test-report", "coverage"]);
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
  /** Payload-by-reference fetch; defaults to the Lore API events endpoint. */
  fetchPayload?: (eventId: string) => Promise<unknown>;
}

/**
 * Statement embedder proxied through the Lore API (FR4): run pods carry no GCP
 * credentials, so Vertex rides POST /api/embed on the API's own access. The
 * default for docs kinds when LORE_API_URL is set; injectable for tests.
 */
/** Backoff before each 429 retry — a burst that outruns the API's embed bucket
 *  clears within the same sliding-window minute, so short waits win it back. */
const EMBED_429_DELAYS_MS = [2000, 5000, 15000];

export function apiEmbed(
  baseUrl: string,
  token: string | undefined,
  fetchImpl: typeof fetch = fetch,
  sleep: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms)),
): (text: string) => Promise<number[] | null> {
  return async (text: string) => {
    let res: Response;

    for (let attempt = 0; ; attempt++) {
      res = await fetchImpl(`${baseUrl}/api/embed`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text }),
      });

      if (res.status !== 429 || attempt >= EMBED_429_DELAYS_MS.length) {
        break;
      }
      await sleep(EMBED_429_DELAYS_MS[attempt]);
    }

    enforceTrue(
      res.ok,
      Error,
      `ingest station: embed proxy returned ${res.status}`,
    );
    const body = (await res.json()) as { embedding: number[] | null };

    return body.embedding;
  };
}

/** The default embedder: the API proxy when configured, else the projector's
 *  own fallback (Vertex ADC — local/dev only). */
function defaultEmbed():
  ((text: string) => Promise<number[] | null>) | undefined {
  const baseUrl = process.env.LORE_API_URL;

  if (!baseUrl) {
    return undefined;
  }

  return apiEmbed(
    baseUrl,
    process.env.LORE_STATION_TOKEN ?? process.env.LORE_INGEST_TOKEN,
  );
}

/** GET the scheduling event's payload back from the Lore API (FR3). */
async function fetchPayloadFromApi(
  repo: string,
  eventId: string,
): Promise<unknown> {
  const baseUrl = process.env.LORE_API_URL;
  const token = process.env.LORE_STATION_TOKEN ?? process.env.LORE_INGEST_TOKEN;

  enforceTrue(baseUrl, Error, "ingest station: LORE_API_URL not configured");
  const res = await fetch(
    `${baseUrl}/api/repos/${repo}/events/${eventId}/payload`,
    { headers: { Authorization: `Bearer ${token}` } },
  );

  enforceTrue(
    res.ok,
    Error,
    `ingest station: payload fetch for event ${eventId} returned ${res.status}`,
  );

  return res.json();
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
    kind !== undefined && (DOC_KINDS.has(kind) || PAYLOAD_KINDS.has(kind)),
    Error,
    `ingest station: no ingest handler for kind "${kind}"`,
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

  if (PAYLOAD_KINDS.has(kind!)) {
    const eventId = input.params.payload_event_id as string | undefined;

    enforceTrue(
      eventId,
      Error,
      `ingest station: kind "${kind}" requires the payload_event_id param`,
    );
    const payload = await (
      deps.fetchPayload ?? ((id: string) => fetchPayloadFromApi(input.repo, id))
    )(eventId!);
    const outcome = await ingestSpecTrace(dgraph!, input.repo, kind!, payload);

    return {
      outcome: "success",
      extras: {
        "Lore-Ingest-Summary": `validated_by=${outcome.validatedBy} violated=${outcome.violated} coverage_nodes=${outcome.coverageNodes} covers_edges=${outcome.coversEdges} test_chunks=${outcome.testChunks}`,
      },
    };
  }

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
      embed: deps.embed ?? defaultEmbed(),
    },
  );

  // Partial failure routes the line's failed edge — never a silent success
  // with files missing (same contract as the Floor handler it replaces).
  return {
    outcome: summary.failed > 0 ? "failed" : "success",
    extras: summaryExtras(summary),
  };
}

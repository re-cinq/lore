// The ingest station (specs/ingest-station FR1): one pod runs one internal.ingest.* payload. Docs kinds (specs/adrs) project from the LOCAL CLONE at $WORKSPACE_DIR/target (no GitHub App creds in the pod, ADR-031 D7) and write dgraph directly via LORE_DGRAPH_HTTP (the label-scoped egress this station type alone receives, FR4). Payload kinds (test-report/coverage) arrive via FR3 payload-by-reference; until then they're rejected loudly.

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
import { eventLine, type NodeResult } from "@re-cinq/lore-assembly-lines";
import type { StationInput } from "@re-cinq/lore-shared/station-input.js";

// Derived, not parallel: INGEST_KINDS holds exactly the file-projectable doc kinds (tests is special-cased inside runIngestGraph).
const DOC_KINDS = new Set(Object.keys(INGEST_KINDS));
// Payload kinds arrive by reference (FR3): the body lives on the scheduling pipeline.events row; station_input carries only payload_event_id.
const PAYLOAD_KINDS = new Set(["test-report", "coverage"]);
// Keeps the extras value well under the ~1 KB stage-commit trailer guidance (station-contract.md) — long detail belongs in the log lines.
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

// Vertex embeddings via the API (FR4) — pods have no GCP credentials.
const EMBED_429_DELAYS_MS = [2000, 5000, 15000];

interface EmbedProxy {
  baseUrl: string;
  token: string | undefined;
  fetchImpl: typeof fetch;
  sleep: (ms: number) => Promise<void>;
}

/** POSTs one text, retrying only 429 — the embedder is shared across every ingesting repo, so rate limiting is an ordinary queueing signal rather than a fault. Any other status is returned as-is for the caller to enforce on. */
async function postEmbed(proxy: EmbedProxy, text: string): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await proxy.fetchImpl(`${proxy.baseUrl}/api/embed`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${proxy.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text }),
    });

    if (res.status !== 429 || attempt >= EMBED_429_DELAYS_MS.length) {
      return res;
    }
    await proxy.sleep(EMBED_429_DELAYS_MS[attempt]);
  }
}

export function apiEmbed(
  baseUrl: string,
  token: string | undefined,
  fetchImpl: typeof fetch = fetch,
  sleep: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms)),
): (text: string) => Promise<number[] | null> {
  const proxy: EmbedProxy = { baseUrl, token, fetchImpl, sleep };

  return async (text: string) => {
    const res = await postEmbed(proxy, text);

    enforceTrue(
      res.ok,
      Error,
      `ingest station: embed proxy returned ${res.status}`,
    );
    const body = (await res.json()) as { embedding: number[] | null };

    return body.embedding;
  };
}

// The default embedder: the API proxy when configured, else the projector's own fallback (Vertex ADC — local/dev only).
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

// The station token where there is one, falling back to the ingest token — a pod carries the narrower credential, a local run usually only the broader one.
function stationToken(): string | undefined {
  return process.env.LORE_STATION_TOKEN ?? process.env.LORE_INGEST_TOKEN;
}

/** GET the scheduling event's payload back from the Lore API (FR3). */
async function fetchPayloadFromApi(
  repo: string,
  eventId: string,
): Promise<unknown> {
  const baseUrl = process.env.LORE_API_URL;

  enforceTrue(baseUrl, Error, "ingest station: LORE_API_URL not configured");
  const res = await fetch(
    `${baseUrl}/api/repos/${repo}/events/${eventId}/payload`,
    {
      signal: AbortSignal.timeout(30_000),
      headers: { Authorization: `Bearer ${stationToken()}` },
    },
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
      continue;
    }
    paths.push(rel);
  }

  return paths;
}

function summaryExtras(summary: IngestGraphSummary): Record<string, string> {
  const extras: Record<string, string> = {
    "Lore-Ingest-Summary": `projected=${summary.projected} skipped=${summary.skipped} failed=${summary.failed}`,
  };

  if (summary.failed > 0) {
    const failed = summary.failedFiles.join(", ");

    extras["Lore-Ingest-Failed-Files"] = failed.slice(0, FAILED_FILES_MAX);
  }

  return extras;
}

function resolveIngestKind(input: StationInput): string {
  const kind = input.params.kind as string | undefined;

  enforceTrue(
    kind !== undefined && (DOC_KINDS.has(kind) || PAYLOAD_KINDS.has(kind)),
    Error,
    `ingest station: no ingest handler for kind "${kind}"`,
  );

  return kind!;
}

function resolveWorkspaceDir(deps: IngestStationDeps): string {
  return (
    deps.workspaceDir ??
    join(process.env.WORKSPACE_DIR ?? "/workspace", "target")
  );
}

function resolveIngestDgraph(deps: IngestStationDeps): DgraphClientPort {
  const dgraph = deps.dgraph === undefined ? createDgraphClient() : deps.dgraph;

  enforceTrue(
    dgraph,
    Error,
    "ingest station: LORE_DGRAPH_HTTP not configured — the def-ingest recipe must inject it (FR4)",
  );

  return dgraph;
}

interface ResolvedIngestTarget {
  workspaceDir: string;
  dgraph: DgraphClientPort;
}

/** Where the projection reads from: the clone on disk, and the embedder. Both are handed in rather than reached for, so the same walk runs against a test workspace. */
function graphSources(
  target: ResolvedIngestTarget,
  deps: IngestStationDeps,
): Parameters<typeof runIngestGraph>[1] {
  const { workspaceDir, dgraph } = target;

  return {
    dgraph,
    listTree: () => listClone(workspaceDir),
    readFile: async (path: string) =>
      readFile(join(workspaceDir, path), "utf8"),
    embed: deps.embed ?? defaultEmbed(),
  };
}

// What to project, from the node's params. `force` arrives as the string "true" — station params are a string map on the wire, so the comparison is against the text rather than a boolean.
function docsRequest(kind: "specs" | "adrs", input: StationInput) {
  return {
    kind,
    repo: input.repo,
    glob: input.params.glob as string | undefined,
    force: input.params.force === "true",
  };
}

async function runDocsIngest(
  kind: "specs" | "adrs",
  input: StationInput,
  target: ResolvedIngestTarget,
  deps: IngestStationDeps,
): Promise<NodeResult> {
  const summary = await runIngestGraph(
    docsRequest(kind, input),
    graphSources(target, deps),
  );

  const extras = summaryExtras(summary);

  console.log(
    eventLine(`ingest ${kind} complete: ${extras["Lore-Ingest-Summary"]}`),
  );

  // Partial failure routes the line's failed edge — never a silent success with files missing (same contract as the Floor handler it replaces).
  return { outcome: summary.failed > 0 ? "failed" : "success", extras };
}

// What the projection actually wrote, as one line. Counts rather than prose: this ends up in a stage commit's extras, where it is read to answer "did the graph get the tests" without opening the graph.
function traceSummary(outcome: {
  validatedBy: number;
  violated: number;
  coverageNodes: number;
  coversEdges: number;
  testChunks: number;
}): string {
  return `validated_by=${outcome.validatedBy} violated=${outcome.violated} coverage_nodes=${outcome.coverageNodes} covers_edges=${outcome.coversEdges} test_chunks=${outcome.testChunks}`;
}

// The payload this kind of ingest projects. Fetched back from the API by the scheduling event's id rather than carried in the node's params: a test report is far larger than an event row wants to be.
async function readPayload(
  kind: string,
  input: StationInput,
  deps: IngestStationDeps,
): Promise<unknown> {
  const eventId = input.params.payload_event_id as string | undefined;

  enforceTrue(
    eventId,
    Error,
    `ingest station: kind "${kind}" requires the payload_event_id param`,
  );
  const fetchPayload =
    deps.fetchPayload ?? ((id: string) => fetchPayloadFromApi(input.repo, id));

  return fetchPayload(eventId);
}

async function runPayloadIngest(
  kind: string,
  input: StationInput,
  dgraph: DgraphClientPort,
  deps: IngestStationDeps,
): Promise<NodeResult> {
  const payload = await readPayload(kind, input, deps);
  const summaryLine = traceSummary(
    await ingestSpecTrace(dgraph, input.repo, kind, payload),
  );

  console.log(eventLine(`ingest ${kind} complete: ${summaryLine}`));

  return { outcome: "success", extras: { "Lore-Ingest-Summary": summaryLine } };
}

export async function runIngestStation(
  input: StationInput,
  deps: IngestStationDeps = {},
): Promise<NodeResult> {
  const kind = resolveIngestKind(input);

  console.log(eventLine(`ingest ${kind} for ${input.repo}`));
  const target: ResolvedIngestTarget = {
    workspaceDir: resolveWorkspaceDir(deps),
    dgraph: resolveIngestDgraph(deps),
  };

  return PAYLOAD_KINDS.has(kind)
    ? runPayloadIngest(kind, input, target.dgraph, deps)
    : runDocsIngest(kind as "specs" | "adrs", input, target, deps);
}

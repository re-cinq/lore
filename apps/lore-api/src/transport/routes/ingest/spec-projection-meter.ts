import type { DgraphClientPort, DgraphTxn } from "@re-cinq/lore-shared";
import {
  parseCodeLinksInStatement,
  parseTestLinksInStatement,
} from "@re-cinq/lore-shared/spec-link-parser.js";
import { segmentStatements } from "@re-cinq/lore-shared/spec-segment.js";

type Embed = (texts: string[]) => Promise<Array<number[] | null>>;
type ReadLinked = (path: string) => Promise<string | null>;

/** One spec as the projection takes it. */
interface SpecDocument {
  repo: string;
  filePath: string;
  content: string;
}

/** What a spec projection waits on, and the commit and force flag it runs with. */
export interface ProjectionWaits {
  dgraph: DgraphClientPort;
  embed: Embed;
  readLinked: ReadLinked;
  commit: string;
  force: boolean;
}

/** The projection, in the shape `projectSpecFile` has. */
export type ProjectSpec = (
  document: SpecDocument,
  dgraph: DgraphClientPort,
  options: { force: boolean; embed: Embed; readLinked: ReadLinked },
) => Promise<{ projected: boolean }>;

/** One spec projection's waits, counted and timed: graph requests, the embedding call and linked-file reads. */
export interface ProjectionSpend {
  graphRequests: number;
  graphMs: number;
  embedMs: number;
  fileReads: number;
  readMs: number;
}

/** Projects one spec with its waits metered, and logs where its time went when it was projected rather than skipped as unchanged (#4150). */
export async function projectSpecMetered(
  project: ProjectSpec,
  document: SpecDocument,
  waits: ProjectionWaits,
  now: () => number = Date.now,
): Promise<{ projected: boolean }> {
  const started = now();
  const metered = meterWaits(waits, now);
  const outcome = await project(document, metered.dgraph, metered.options);

  if (outcome.projected) {
    const spend = { ...metered.spend, totalMs: now() - started };

    console.log(projectionLine(document, waits.commit, spend));
  }

  return outcome;
}

/** The `[project-spec]` line for one projected spec: its size, its time, and how much of that went to graph requests, embedding and file reads. */
export function projectionLine(
  document: SpecDocument,
  commit: string,
  spend: ProjectionSpend & { totalMs: number },
): string {
  const { statements, links } = specSize(document.content);

  return `[project-spec] ${document.repo}@${commit.slice(0, 9)} ${document.filePath}: ${statements} statements and ${links} links in ${seconds(spend.totalMs)}s; ${spend.graphRequests} graph requests took ${seconds(spend.graphMs)}s, embedding ${seconds(spend.embedMs)}s, ${spend.fileReads} file reads ${seconds(spend.readMs)}s`;
}

/** Wraps the graph client, the embedder and the file reader so each adds its time to one {@link ProjectionSpend}. */
function meterWaits(waits: ProjectionWaits, now: () => number) {
  const spend = noSpend();
  const add = addersTo(spend);

  return {
    spend,
    dgraph: { newTxn: () => meteredTxn(waits.dgraph.newTxn(), add.graph, now) },
    options: {
      force: waits.force,
      embed: (texts: string[]) =>
        timed(now, () => waits.embed(texts), add.embed),
      readLinked: (path: string) =>
        timed(now, () => waits.readLinked(path), add.read),
    },
  };
}

function noSpend(): ProjectionSpend {
  return { graphRequests: 0, graphMs: 0, embedMs: 0, fileReads: 0, readMs: 0 };
}

/** One adder per kind of wait: a graph request and a file read count one each, and every wait adds its milliseconds. */
function addersTo(spend: ProjectionSpend) {
  return {
    graph: (ms: number) => {
      spend.graphRequests += 1;
      spend.graphMs += ms;
    },
    embed: (ms: number) => {
      spend.embedMs += ms;
    },
    read: (ms: number) => {
      spend.fileReads += 1;
      spend.readMs += ms;
    },
  };
}

/** A transaction whose every query and mutation counts as one graph request. */
function meteredTxn(
  txn: DgraphTxn,
  add: (ms: number) => void,
  now: () => number,
): DgraphTxn {
  return {
    queryWithVars: (query, vars) =>
      timed(now, () => txn.queryWithVars(query, vars), add),
    mutate: (request) => timed(now, () => txn.mutate(request), add),
    discard: () => txn.discard(),
  };
}

/** Runs `wait` and adds the milliseconds it took. */
async function timed<T>(
  now: () => number,
  wait: () => Promise<T>,
  add: (ms: number) => void,
): Promise<T> {
  const started = now();

  try {
    return await wait();
  } finally {
    add(now() - started);
  }
}

/** A spec's statements and the test and code links they carry. */
function specSize(content: string): { statements: number; links: number } {
  const statements = segmentStatements(content);

  return {
    statements: statements.length,
    links: statements.reduce(
      (sum, { text }) =>
        sum +
        parseTestLinksInStatement(text).length +
        parseCodeLinksInStatement(text).length,
      0,
    ),
  };
}

function seconds(ms: number): number {
  return Math.round(ms / 1000);
}

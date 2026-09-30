// A run that lives on the external floor, read through its client and answered in the models the run page already reads. Nothing here writes: a floor run is changed only by the floor.
import type {
  FloorClient,
  LineBody,
  RunView,
  VisitView,
} from "@re-cinq/floor-client";
import type {
  AssemblyRunQuery,
  AssemblyRunRecord,
  AssemblyRunSummary,
  StationRunRecord,
} from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import type { AgentRunTurnRow } from "@re-cinq/lore-shared/project/agent-run-turns/agent-run-turns-port.js";
import type { RunGraph } from "@re-cinq/lore-shared/project/assembly-runs/run-graph.js";
import { floorRunFilters, matchesFloorQuery } from "./floor-run-query.js";
import {
  floorRunToAssemblyRun,
  floorRunToSummary,
  lineBodyToRunGraph,
  turnRecordToRow,
  visitToStationRun,
} from "./floor-run-mapping.js";

export type FloorRunSource = Pick<
  FloorClient,
  "runs" | "stationRuns" | "lines" | "stations" | "costs"
>;

type StationKind = "agent" | "service" | "human";

const TURNS_PER_READ = 1000;
const DEFAULT_LIST_LIMIT = 50;

export class FloorRunReader {
  /** A line version is its content, so its graph never changes once read. */
  private readonly graphs = new Map<string, Promise<RunGraph>>();

  constructor(private readonly floor: FloorRunSource) {}

  async getById(runId: string): Promise<AssemblyRunRecord | null> {
    const found = await this.floor.runs.get(runId);

    return found ? this.recordOf(found.run) : null;
  }

  /** The floor's runs the query matches, newest first within each of the lists it took to ask. */
  async listSummaries(query: AssemblyRunQuery): Promise<AssemblyRunSummary[]> {
    const limit = query.limit ?? DEFAULT_LIST_LIMIT;
    const pages = await Promise.all(
      floorRunFilters(query).map((filter) =>
        this.floor.runs.list(filter, { limit }),
      ),
    );
    const summaries = await Promise.all(
      pages.flatMap((page) => page.items).map((run) => this.summaryOf(run)),
    );

    return summaries.filter((run) => matchesFloorQuery(run, query));
  }

  async listStationRuns(runId: string): Promise<StationRunRecord[]> {
    const run = await this.getById(runId);

    if (!run) {
      return [];
    }
    const visits = await this.floor.stationRuns.list({ run: runId });

    return visits.map((visit) => visitToStationRun(visit, run));
  }

  /** Every turn of the run, visit by visit in the order the walk opened them. The floor numbers turns within a visit, so a row's id here is its place in the run: the cursor a reader pages with. */
  async turns(runId: string): Promise<AgentRunTurnRow[]> {
    const visits = await this.floor.stationRuns.list({ run: runId });
    const perVisit = await Promise.all(
      visits.map((visit) => this.turnsOf(visit)),
    );

    return perVisit
      .flat()
      .map((turn, place) => ({ ...turn, id: String(place + 1) }));
  }

  async costUsd(runId: string): Promise<number | null> {
    const totals = await this.floor.costs.summary({ run: runId }, "run");

    return totals.at(0)?.costUsd ?? null;
  }

  /** The cost of each run, in ONE read: the list page asks once, not once per row. A lone run asks for just its own; several ask for everything since the oldest began. */
  async costsByRun(
    runs: readonly { id: string; createdAt: Date }[],
  ): Promise<Map<string, number>> {
    const oldest = Math.min(...runs.map((run) => run.createdAt.getTime()));
    const filter =
      runs.length === 1
        ? { run: runs[0].id }
        : { since: new Date(oldest).toISOString() };
    const totals = await this.floor.costs.summary(filter, "run");

    return new Map(
      totals.flatMap((row) =>
        row.key === null ? [] : [[row.key, row.costUsd]],
      ),
    );
  }

  async recordOf(run: RunView): Promise<AssemblyRunRecord> {
    const [visits, graph] = await Promise.all([
      this.floor.stationRuns.list({ run: run.id }),
      this.graphOf(run),
    ]);

    return floorRunToAssemblyRun({ run, visits, graph });
  }

  /** A finished run's status reads from its verdict; only an open one needs its visits to tell queued from running. */
  private async summaryOf(run: RunView): Promise<AssemblyRunSummary> {
    const visits = run.finishedAt
      ? []
      : await this.floor.stationRuns.list({ run: run.id });

    return floorRunToSummary({ run, visits });
  }

  private async turnsOf(visit: VisitView): Promise<AgentRunTurnRow[]> {
    const rows: AgentRunTurnRow[] = [];
    let since: number | null = 0;

    while (since !== null) {
      const page = await this.floor.stationRuns.records(visit.id, {
        kind: "turn",
        since,
        limit: TURNS_PER_READ,
      });

      rows.push(...page.items.map((turn) => turnRecordToRow(turn, visit)));
      since = page.nextCursor;
    }

    return rows;
  }

  private graphOf(run: RunView): Promise<RunGraph> {
    const known = this.graphs.get(run.lineHash);

    if (known) {
      return known;
    }
    const reading = this.readGraph(run);

    this.graphs.set(run.lineHash, reading);

    return reading;
  }

  private async readGraph(run: RunView): Promise<RunGraph> {
    const version = await this.floor.lines.version(run.lineId, run.lineHash);
    const body: LineBody = version?.body ?? emptyLine();

    return lineBodyToRunGraph(run.lineId, body, await this.kindsOf(body));
  }

  private async kindsOf(body: LineBody): Promise<Record<string, StationKind>> {
    const names = body.nodes.flatMap((node) =>
      node.station ? [stationNameOf(node.station)] : [],
    );
    const stations = await Promise.all(
      names.map((name) => this.floor.stations.get(name)),
    );

    return Object.fromEntries(
      stations.flatMap((station) =>
        station ? [[station.id, station.body.kind]] : [],
      ),
    );
  }
}

/** A node may pin its station as `name@hash`. */
function stationNameOf(stationRef: string): string {
  return stationRef.split("@")[0];
}

function emptyLine(): LineBody {
  return { entry: "", exit: "", args: {}, nodes: [], edges: [] };
}

// A run that lives on the external floor, read through its client and answered in the models the run page already reads. Nothing here writes: a floor run is changed only by the floor.
import type {
  FloorClient,
  RecordKind,
  RunView,
  StationRunRecordView,
  VisitView,
  RunFilter,
} from "@re-cinq/floor-client";
import type {
  AssemblyRunQuery,
  AssemblyRunStatus,
  AssemblyRunRecord,
  AssemblyRunSummary,
  StationRunRecord,
} from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import type { AgentRunTurnRow } from "@re-cinq/lore-shared/project/agent-run-turns/agent-run-turns-port.js";
import type { RunGraph } from "@re-cinq/lore-shared/project/assembly-runs/run-graph.js";
import { startValue } from "@re-cinq/lore-shared/review/floor-review-runs.js";
import {
  miniPipeline,
  type PipelineNode,
} from "../assembly-line-station/mini-pipeline.js";
import {
  floorRunFilters,
  floorPageFilter,
  matchesFloorQuery,
  pagesToRead,
  searchEnded,
} from "./floor-run-query.js";
import {
  floorRunToAssemblyRun,
  floorRunToSummary,
  turnRecordToRow,
  visitToStationRun,
} from "./floor-run-mapping.js";
import { readLineFacts, type LineFacts } from "./floor-line-facts.js";
import {
  visitEvents,
  visitModelCalls,
  type VisitReadDeps,
} from "./floor-visit-reads.js";
import {
  floorVisitIdOf,
  nodeLogsOf,
  type FloorNodeLogs,
} from "./floor-records.js";

export type FloorRunSource = Pick<
  FloorClient,
  "runs" | "stationRuns" | "lines" | "stations" | "costs" | "events"
>;

const RECORDS_PER_READ = 1000;
const EVENTS_PER_READ = 200;
const DEFAULT_LIST_LIMIT = 50;

/** How many pages a search for a task's run reads before giving up: 500 runs of one line. */
const TASK_SEARCH_PAGES = 10;

const DEFAULT_PAGE_LIMIT = 25;

export interface FloorRunListing {
  run: AssemblyRunSummary;
  pipeline: PipelineNode[];
}

export interface FloorRunPage {
  runs: FloorRunListing[];
  nextCursor: string | null;
}

export interface FloorRunPageQuery {
  repo?: string;
  status?: AssemblyRunStatus;
  cursor?: string;
  limit?: number;
}

export class FloorRunReader {
  /** A line version is its content, so what it says about its nodes never changes once read. */
  private readonly lines = new Map<string, Promise<LineFacts>>();

  constructor(private readonly floor: FloorRunSource) {}

  async getById(runId: string): Promise<AssemblyRunRecord | null> {
    const found = await this.floor.runs.get(runId);

    return found ? this.recordOf(found.run) : null;
  }

  /** The floor's runs the query matches, newest first within each of the lists it took to ask. */
  async listSummaries(query: AssemblyRunQuery): Promise<AssemblyRunSummary[]> {
    const lists = await Promise.all(
      floorRunFilters(query).map((filter) => this.runsFor(filter, query)),
    );
    const summaries = await Promise.all(
      lists.flat().map((run) => this.summaryOf(run)),
    );

    return summaries.filter((run) => matchesFloorQuery(run, query));
  }

  /** One list of the floor's, or a search through it when the list is not keyed on the task asked for. */
  private async runsFor(
    filter: RunFilter,
    query: AssemblyRunQuery,
  ): Promise<RunView[]> {
    if (query.taskId !== undefined && filter.subject === undefined) {
      return this.runOfTask(filter, query.taskId);
    }
    const limit = query.limit ?? DEFAULT_LIST_LIMIT;

    return (await this.floor.runs.list(filter, { limit })).items;
  }

  /** The task's run in a line keyed on something else (the loop keys on the repository's backlog), paged for rather than read off the first page: a repository's finished loop runs keep growing, and the task's run falls off the newest fifty. A task has one run there, so the search stops at it. */
  private async runOfTask(
    filter: RunFilter,
    taskId: string,
  ): Promise<RunView[]> {
    let cursor: string | undefined;

    for (let page = 0; page < TASK_SEARCH_PAGES; page++) {
      const listed = await this.floor.runs.list(filter, {
        limit: DEFAULT_LIST_LIMIT,
        ...(cursor ? { cursor } : {}),
      });
      const started = listed.items.filter(
        (run) => startValue(run, "task_id") === taskId,
      );

      if (started.length > 0 || !listed.nextCursor) {
        return started;
      }
      cursor = listed.nextCursor;
    }

    return [];
  }

  /** One page of the floor's runs, newest first (of one repository when asked), each with its mini pipeline; the cursor is the floor's own, handed back untouched. A status is searched for through the floor's pages. */
  async page(query: FloorRunPageQuery): Promise<FloorRunPage> {
    const { status } = query;
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const runs: FloorRunListing[] = [];
    let cursor = query.cursor;
    let nextCursor: string | null = null;

    for (let read = 0; read < pagesToRead(status); read++) {
      const listed = await this.floorPage(query, limit, cursor);

      runs.push(...listed.runs.filter((run) => hasStatus(run, status)));
      nextCursor = listed.nextCursor;
      cursor = nextCursor ?? undefined;

      if (searchEnded(runs.length, limit, nextCursor)) {
        break;
      }
    }

    return { runs, nextCursor };
  }

  private async floorPage(
    query: FloorRunPageQuery,
    limit: number,
    cursor: string | undefined,
  ): Promise<FloorRunPage> {
    const listed = await this.floor.runs.list(floorPageFilter(query), {
      limit,
      ...(cursor ? { cursor } : {}),
    });
    const runs = await Promise.all(
      listed.items.map((run) => this.listingOf(run)),
    );

    return { runs, nextCursor: listed.nextCursor };
  }

  /** One run as the list shows it; null for a run the floor does not hold. */
  async listing(runId: string): Promise<FloorRunListing | null> {
    const found = await this.floor.runs.get(runId);

    return found ? this.listingOf(found.run) : null;
  }

  async listStationRuns(runId: string): Promise<StationRunRecord[]> {
    const found = await this.floor.runs.get(runId);

    if (!found) {
      return [];
    }
    const [run, facts, visits] = await Promise.all([
      this.recordOf(found.run),
      this.lineFactsOf(found.run),
      this.floor.stationRuns.list({ run: runId }),
    ]);

    return visits.map((visit) =>
      visitToStationRun(visit, { ...run, routes: facts.routes }),
    );
  }

  visitModelCalls(runId: string, visitId: string) {
    return visitModelCalls(this.visitReadDeps(), runId, visitId);
  }

  visitEvents(runId: string, visitId: string) {
    return visitEvents(this.visitReadDeps(), runId, visitId);
  }

  private visitReadDeps(): VisitReadDeps {
    const { runs, stationRuns, events } = this.floor;

    return {
      visitById: (visitId) => stationRuns.get(visitId),
      runById: async (runId) => (await runs.get(runId))?.run ?? null,
      eventsPage: (runId, since) =>
        events.feed({ run: runId, since }, { limit: EVENTS_PER_READ }),
      recordsOf: (visit, kind) => this.recordsOf(visit, kind),
      lineFactsOf: (run) => this.lineFactsOf(run),
    };
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

  /** The log the floor kept for one of the run's visits, named as the run page names it (`floor-<visit id>`); null for a name of no visit of this run. */
  async nodeLogs(
    runId: string,
    agentCrName: string,
    tail: number | undefined,
  ): Promise<FloorNodeLogs | null> {
    const visitId = floorVisitIdOf(agentCrName);
    const visit = visitId ? await this.floor.stationRuns.get(visitId) : null;

    if (!visit || visit.runId !== runId) {
      return null;
    }

    return nodeLogsOf(visit, await this.recordsOf(visit, "log"), tail);
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

  private async listingOf(run: RunView): Promise<FloorRunListing> {
    const [visits, graph] = await Promise.all([
      this.floor.stationRuns.list({ run: run.id }),
      this.graphOf(run),
    ]);

    return {
      run: floorRunToSummary({ run, visits }),
      pipeline: miniPipeline(
        graph.nodes,
        visits.map((visit) => ({
          nodeId: visit.nodeId,
          iteration: visit.iteration,
          outcome: visit.report?.outcome ?? null,
        })),
      ),
    };
  }

  /** A finished run's status reads from its verdict; only an open one needs its visits to tell queued from running. */
  private async summaryOf(run: RunView): Promise<AssemblyRunSummary> {
    const visits = run.finishedAt
      ? []
      : await this.floor.stationRuns.list({ run: run.id });

    return floorRunToSummary({ run, visits });
  }

  private async turnsOf(visit: VisitView): Promise<AgentRunTurnRow[]> {
    const turns = await this.recordsOf(visit, "turn");

    return turns.map((turn) => turnRecordToRow(turn, visit));
  }

  /** Every record of one kind the visit has, read to the end. */
  private async recordsOf(
    visit: VisitView,
    kind: RecordKind,
  ): Promise<StationRunRecordView[]> {
    const records: StationRunRecordView[] = [];
    let since: number | null = 0;

    while (since !== null) {
      const page = await this.floor.stationRuns.records(visit.id, {
        kind,
        since,
        limit: RECORDS_PER_READ,
      });

      records.push(...page.items);
      since = page.nextCursor;
    }

    return records;
  }

  private async graphOf(run: RunView): Promise<RunGraph> {
    return (await this.lineFactsOf(run)).graph;
  }

  private lineFactsOf(run: RunView): Promise<LineFacts> {
    const known = this.lines.get(run.lineHash);

    if (known) {
      return known;
    }
    const reading = readLineFacts(this.floor, run);

    this.lines.set(run.lineHash, reading);

    return reading;
  }
}

function hasStatus(
  listing: FloorRunListing,
  status: AssemblyRunStatus | undefined,
): boolean {
  return status === undefined || listing.run.status === status;
}

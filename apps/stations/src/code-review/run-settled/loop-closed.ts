// What a settled implementation-loop run on the external floor owes its ticket. The rules are the ones a run Lore's own Floor walked is settled by (`handleLoopRunClosed`): this file only reads a floor run as the run and the visits those rules take.
import type { Handle } from "@re-cinq/floor-station";
import type { FloorClient, RunView, VisitView } from "@re-cinq/floor-client";
import { LOOP_LINE } from "@re-cinq/lore-shared/backlog/floor-loop.js";
import {
  isInfraFailure,
  type InfraFailureCountInput,
} from "@re-cinq/lore-shared/backlog/loop-infra-deferral.js";
import {
  handleLoopRunClosed,
  type ClosedLoopRun,
  type LoopRunClosedDeps,
  type StationVisit,
} from "@re-cinq/lore-shared/backlog/loop-run-closed.js";
import { DOD_RESOLVED_PREFIX } from "@re-cinq/lore-shared/dod-verdict.js";
import {
  floorRepoOf,
  loreRepoOf,
  parseGitRef,
  parsePullRequestUrl,
} from "@re-cinq/lore-shared/floor/floor-items.js";
import { classifyError } from "@re-cinq/lore-shared/lib/error-classify.js";
import type { RunGraph } from "@re-cinq/lore-shared/project/assembly-runs/run-graph.js";
import { startValueOf } from "./run-settled.js";

/** A floor run as the loop's settling rules take it. */
export interface FloorLoopRun {
  run: ClosedLoopRun;
  visits: StationVisit[];
  outcome: string;
}

export interface SettleLoopDeps {
  run(runId: string): Promise<RunView | null>;
  visits(runId: string): Promise<VisitView[]>;
  /** The ports the settling rules write through, for one settled run. */
  closed(settled: FloorLoopRun): LoopRunClosedDeps;
}

/** Settles the ticket of a loop run, then lets the wrapped station do its own part. */
export function settlingLoopTickets(
  deps: SettleLoopDeps,
  next: Handle,
): Handle {
  return async (brief, tools) => {
    if (brief.needs.line_id === LOOP_LINE) {
      await settleTicket(deps, brief.needs.run_id);
    }

    return next(brief, tools);
  };
}

async function settleTicket(
  deps: SettleLoopDeps,
  runId: string,
): Promise<void> {
  const run = await deps.run(runId);

  if (!run) {
    return;
  }
  const settled = closedLoopRunOf(run, await deps.visits(runId));

  await handleLoopRunClosed(
    settled.run,
    settled.outcome,
    run.reason ?? undefined,
    deps.closed(settled),
  );
}

/** The two node types the settling rules look for. The floor's line has no retrospective; its `done` marker stands where one was. */
const LOOP_GRAPH: RunGraph = {
  name: LOOP_LINE,
  entry: "dod",
  exit: "done",
  nodes: [
    {
      id: "await-pr",
      type: "pr_review",
      station: null,
      station_inherited: false,
    },
    {
      id: "done",
      type: "retrospective",
      station: null,
      station_inherited: false,
    },
  ],
  edges: [],
};

const FLOOR_SUCCESS = "success";
/** What Lore's own Floor calls a run that reached its exit. */
const COMPLETED = "completed";
const REACHED_EXIT: StationVisit = {
  nodeId: "done",
  iteration: 1,
  outcome: "success",
};

export function closedLoopRunOf(
  run: RunView,
  visits: VisitView[],
): FloorLoopRun {
  const reachedExit = run.outcome === FLOOR_SUCCESS;
  const read = visits.map(stationVisitOf);

  return {
    run: {
      id: run.id,
      repo: loreRepoOf(run.repo),
      blueprintName: run.lineId,
      taskId: startValueOf(run, "task_id") ?? null,
      branch: branchOf(run),
      args: pullRequestOf(visits),
      graph: LOOP_GRAPH,
    },
    visits: reachedExit ? [...read, REACHED_EXIT] : read,
    outcome: reachedExit ? COMPLETED : (run.outcome ?? "error"),
  };
}

function branchOf(run: RunView): string | null {
  const ref = startValueOf(run, "repo");

  return ref?.includes("@") ? parseGitRef(ref).branch : null;
}

/** The pull request `open-pr` produced, as the run args the rules read it from. */
function pullRequestOf(visits: VisitView[]): Record<string, unknown> {
  const url = visits
    .flatMap(({ report }) => report?.produced?.pr_url ?? [])
    .at(-1);

  return url
    ? { pr_url: url, pr_number: parsePullRequestUrl(url).prNumber }
    : {};
}

function stationVisitOf({
  nodeId,
  iteration,
  report,
}: VisitView): StationVisit {
  return {
    nodeId,
    iteration,
    outcome: report?.outcome ?? null,
    failureDetail: detailOf(report),
    failureClass: report?.error ? classOf(report.error) : null,
  };
}

/** A visit's own words about why it stopped, in the order a ticket's reader needs them. */
const BLOCKED_VALUES = [
  "dod_blocked",
  "tdd_blocked",
  "ci_blocked",
  "pr_blocked",
];

function detailOf(report: VisitView["report"]): string | null {
  const produced = report?.produced ?? {};
  const resolved: string | undefined = produced.dod_resolved;

  if (resolved) {
    return `${DOD_RESOLVED_PREFIX}${resolved}`;
  }
  const blocked = BLOCKED_VALUES.flatMap((name) => produced[name] ?? []).at(0);

  return blocked ?? report?.error ?? null;
}

/** The floor's own word for a dispatch no worker took. */
const UNCLAIMED = /^unclaimed:/;

function classOf(error: string): string {
  return UNCLAIMED.test(error) ? "unclaimed" : classifyError(error).category;
}

const RUNS_READ = 50;

export interface InfraFailuresFloor {
  runs: Pick<FloorClient["runs"], "list">;
  stationRuns: Pick<FloorClient["stationRuns"], "list">;
}

/** How many earlier loop runs on the ticket's branch ended on the cluster rather than on the work, since the window opened: the count a new such failure adds one to. */
export async function floorInfraFailures(
  floor: InfraFailuresFloor,
  { repo, branch, since, excludeRunId }: InfraFailureCountInput,
): Promise<number> {
  const { items: finished } = await floor.runs.list(
    { repo: floorRepoOf(repo), line: LOOP_LINE, open: false },
    { limit: RUNS_READ },
  );
  const earlier = finished.filter(
    (run) =>
      run.id !== excludeRunId &&
      new Date(run.createdAt) > since &&
      branchOf(run) === branch,
  );
  const judged = await Promise.all(
    earlier.map(async (run) => {
      const settled = closedLoopRunOf(
        run,
        await floor.stationRuns.list({ run: run.id }),
      );

      return isInfraFailure(settled.run, settled.visits);
    }),
  );

  return judged.filter(Boolean).length;
}

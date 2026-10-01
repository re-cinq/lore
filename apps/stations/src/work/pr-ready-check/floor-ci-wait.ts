// The CI wait of lines that run on the external floor: a run parked on its `await-ci` human station is judged by the same reader the Postgres-backed runs use, and the verdict is reported to the parked visit. A red build's failing checks ride along as produced values, which is how the repair agent is handed them.

import type { floorClient } from "@re-cinq/lore-shared/floor/floor-client.js";
import { loreRepoOf } from "@re-cinq/lore-shared/floor/floor-items.js";
import { reportToVisit } from "@re-cinq/lore-shared/floor/floor-report.js";
import { errorMessage } from "@re-cinq/lore-shared/lib/error-classify.js";
import type { PullRef } from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
import type { LoopRunSlice, ParkedReport } from "./sweep-contract.js";

/** The floor lines that park on their pull request's CI. */
export const FLOOR_CI_WAIT_LINES: readonly string[] = ["onboard"];

const CI_NODE = "await-ci";
const PULL_NUMBER = /\/pull\/(\d+)\/?$/;
const CLOSED_REASON = "the pull request was closed without merging";
const FEEDBACK_VALUES = [
  "ci_feedback_sha",
  "ci_failed_checks",
  "ci_failure_summary",
] as const;

type Floor = ReturnType<typeof floorClient>;
type RunView = Awaited<ReturnType<Floor["runs"]["list"]>>["items"][number];
type VisitView = Awaited<ReturnType<Floor["stationRuns"]["list"]>>[number];
type Report = Parameters<typeof reportToVisit>[2];

export interface CiWaitFloor {
  runs: Pick<Floor["runs"], "list" | "cancel">;
  stationRuns: Pick<Floor["stationRuns"], "list">;
  events: Pick<Floor["events"], "post">;
}

export interface FloorCiWaitDeps {
  floor: CiWaitFloor;
  /** The CI verdict for one parked run, or null while there is nothing to tell it. */
  judge(run: LoopRunSlice): Promise<ParkedReport | null>;
  prState(repo: string, prNumber: number): Promise<PullRef["state"] | null>;
}

interface CiWait {
  run: LoopRunSlice;
  visitId: string;
  prNumber: number;
}

type Settled = "resumed" | "blocked" | "waiting" | "closed";

export async function floorCiWaitSweep(deps: FloorCiWaitDeps): Promise<string> {
  const waits = await parkedCiWaits(deps.floor);
  const tally = { resumed: 0, blocked: 0, waiting: 0, closed: 0, errors: 0 };

  for (const wait of waits) {
    try {
      tally[await settle(deps, wait)]++;
    } catch (err) {
      tally.errors++;
      console.error(
        `[pr-ready-check] floor run ${wait.run.id}: ${errorMessage(err)}`,
      );
    }
  }

  return summaryOf(waits.length, tally);
}

async function parkedCiWaits(floor: CiWaitFloor): Promise<CiWait[]> {
  const pages = await Promise.all(
    FLOOR_CI_WAIT_LINES.map((line) => floor.runs.list({ line, open: true })),
  );
  const runs = pages.flatMap(({ items: openRuns }) => openRuns);
  const waits = await Promise.all(
    runs.map(async (run) =>
      ciWaitOf(run, await floor.stationRuns.list({ run: run.id })),
    ),
  );

  return waits.filter((wait) => wait !== null);
}

function ciWaitOf(run: RunView, visits: VisitView[]): CiWait | null {
  const newest = visits.findLast((visit) => visit.nodeId === CI_NODE);
  const prNumber = prNumberOf(visits);

  if (newest?.report !== null || prNumber === null) {
    return null;
  }

  return {
    visitId: newest.id,
    prNumber,
    run: {
      id: run.id,
      blueprintName: run.lineId,
      repo: loreRepoOf(run.repo),
      status: "running",
      args: { pr_number: prNumber, ...lastRedSha(visits) },
      graph: null,
    },
  };
}

function prNumberOf(visits: VisitView[]): number | null {
  const url = producedLast(visits, "pr_url");
  const digits = url ? PULL_NUMBER.exec(url)?.[1] : undefined;

  return digits ? Number(digits) : null;
}

/** The sha the last red verdict was reported for, which is what tells a repair that moved nothing from one that pushed. */
function lastRedSha(visits: VisitView[]): { ci_feedback_sha?: string } {
  const sha = producedLast(visits, "ci_feedback_sha");

  return sha ? { ci_feedback_sha: sha } : {};
}

function producedLast(visits: VisitView[], name: string): string | undefined {
  return visits.flatMap(({ report }) => report?.produced?.[name] ?? []).at(-1);
}

async function settle(deps: FloorCiWaitDeps, wait: CiWait): Promise<Settled> {
  const { floor } = deps;
  const state = await deps.prState(wait.run.repo, wait.prNumber);

  if (state === "closed") {
    await floor.runs.cancel(wait.run.id, CLOSED_REASON);

    return "closed";
  }
  const report =
    state === "merged" ? MERGED : reportOf(await deps.judge(wait.run));

  if (!report) {
    return "waiting";
  }
  await reportToVisit(floor.events, wait.visitId, report);

  return report.outcome === "success" ? "resumed" : "blocked";
}

/** A pull request merged while its build was still being read has nothing left to wait for. */
const MERGED: Report = { outcome: "success" };

/** Only the values the `await-ci` station declares are produced; the reason stays with the outcome that routes on it. */
function reportOf(judged: ParkedReport | null): Report | null {
  if (!judged) {
    return null;
  }
  const produced = Object.fromEntries(
    FEEDBACK_VALUES.flatMap((name) =>
      typeof judged.args[name] === "string" ? [[name, judged.args[name]]] : [],
    ),
  );

  return Object.keys(produced).length > 0
    ? { outcome: judged.outcome, produced }
    : { outcome: judged.outcome };
}

function summaryOf(
  checked: number,
  tally: Record<Settled | "errors", number>,
): string {
  const base = `floor: checked ${checked}, resumed ${tally.resumed}, blocked ${tally.blocked}, waiting ${tally.waiting}, closed ${tally.closed}`;

  return tally.errors > 0 ? `${base}, errors ${tally.errors}` : base;
}

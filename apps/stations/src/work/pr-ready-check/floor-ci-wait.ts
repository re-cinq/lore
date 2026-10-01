// The waits of lines that run on the external floor: a run parked on its `await-ci` or `await-pr` human station is judged by the same readers the Postgres-backed runs use, and the verdict is reported to the parked visit. A red build's failing checks ride along as produced values and as one file, the round brief, which is how the next agent is handed them.

import type { floorClient } from "@re-cinq/lore-shared/floor/floor-client.js";
import {
  roundBriefOf,
  type CiFeedback,
  type RoundHandoff,
} from "@re-cinq/lore-shared/ci-wait/round-brief.js";
import { loreRepoOf } from "@re-cinq/lore-shared/floor/floor-items.js";
import { reportToVisit } from "@re-cinq/lore-shared/floor/floor-report.js";
import { errorMessage } from "@re-cinq/lore-shared/lib/error-classify.js";
import type { PullRef } from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
import type { LoopRunSlice, ParkedReport } from "./sweep-contract.js";

/** The floor lines that park on their pull request. */
export const FLOOR_CI_WAIT_LINES: readonly string[] = [
  "onboard",
  "implementation-loop",
];

/** The per-push wait: CI alone decides. */
const CI_NODE = "await-ci";
/** The end-of-line wait: CI and review threads decide. */
const PR_NODE = "await-pr";
const WAIT_NODES: readonly string[] = [CI_NODE, PR_NODE];
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
  blobs: Pick<Floor["blobs"], "put">;
}

type Judge = (run: LoopRunSlice) => Promise<ParkedReport | null>;

export interface FloorCiWaitDeps {
  floor: CiWaitFloor;
  /** The CI verdict for a run parked on `await-ci`, or null while there is nothing to tell it. */
  judge: Judge;
  /** The verdict for a run parked on `await-pr`: CI and the review threads. */
  judgePr: Judge;
  prState(repo: string, prNumber: number): Promise<PullRef["state"] | null>;
}

interface CiWait {
  run: LoopRunSlice;
  visitId: string;
  nodeId: string;
  prNumber: number;
  handoff: RoundHandoff | null;
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
  const newest = visits.findLast((visit) => WAIT_NODES.includes(visit.nodeId));
  const prNumber = prNumberOf(visits);

  if (newest?.report !== null || prNumber === null) {
    return null;
  }

  return {
    visitId: newest.id,
    nodeId: newest.nodeId,
    prNumber,
    handoff: handoffOf(visits),
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

/** What the last round said it did and left, when a round has reported one. */
function handoffOf(visits: VisitView[]): RoundHandoff | null {
  const next = producedLast(visits, "tdd_next");

  return next ? { next, done: producedLast(visits, "tdd_done") ?? null } : null;
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
  const report = state === "merged" ? MERGED : await verdictOf(deps, wait);

  if (!report) {
    return "waiting";
  }
  await reportToVisit(floor.events, wait.visitId, report);

  return report.outcome === "success" ? "resumed" : "blocked";
}

/** A pull request merged while it was still being read has nothing left to wait for. */
const MERGED: Report = { outcome: "success" };

async function verdictOf(
  deps: FloorCiWaitDeps,
  wait: CiWait,
): Promise<Report | null> {
  const judge = wait.nodeId === PR_NODE ? deps.judgePr : deps.judge;
  const judged = await judge(wait.run);

  if (!judged) {
    return null;
  }
  const produced = await producedOf(deps.floor, judged, wait.handoff);

  return Object.keys(produced).length > 0
    ? { outcome: judged.outcome, produced }
    : { outcome: judged.outcome };
}

/** The feedback values a wait station declares, and the round brief stored as a file; the reason stays with the outcome that routes on it. A verdict that names no failed check produces nothing. */
async function producedOf(
  floor: CiWaitFloor,
  judged: ParkedReport,
  handoff: RoundHandoff | null,
): Promise<Record<string, string>> {
  const values = Object.fromEntries(
    FEEDBACK_VALUES.flatMap((name) =>
      typeof judged.args[name] === "string" ? [[name, judged.args[name]]] : [],
    ),
  ) as Partial<Record<(typeof FEEDBACK_VALUES)[number], string>>;
  const feedback = feedbackOf(values);

  if (!feedback) {
    return values;
  }
  const brief = roundBriefOf({ feedback, handoff });
  const stored = await floor.blobs.put(
    new TextEncoder().encode(brief),
    "text/markdown",
  );

  return { ...values, round_brief: stored.hash };
}

function feedbackOf(
  values: Partial<Record<(typeof FEEDBACK_VALUES)[number], string>>,
): CiFeedback | null {
  const { ci_feedback_sha: sha, ci_failed_checks: failedChecks } = values;

  return sha && failedChecks
    ? { sha, failedChecks, summary: values.ci_failure_summary ?? "" }
    : null;
}

function summaryOf(
  checked: number,
  tally: Record<Settled | "errors", number>,
): string {
  const base = `floor: checked ${checked}, resumed ${tally.resumed}, blocked ${tally.blocked}, waiting ${tally.waiting}, closed ${tally.closed}`;

  return tally.errors > 0 ? `${base}, errors ${tally.errors}` : base;
}

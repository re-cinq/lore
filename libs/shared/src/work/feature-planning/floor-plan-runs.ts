import type { FloorClient, RunView, VisitView } from "@re-cinq/floor-client";
import { floorRepoOf, parseGitRef } from "../../outbound/floor/floor-items.js";
import type { ParkedTarget } from "../../outbound/project/assembly-runs/parked-node.js";
import {
  PLANNING_DEFINITION,
  type PlanLine,
} from "../../outbound/project/plans/plan-run.js";
import { isOpen, startValue } from "../review/floor-review-runs.js";

export const AUTHOR_NODE = "author";
export const MERGED_NODE = "merged";
const SPEC_PR_NODE = "open-spec-pr";
const ENTRY_NODE = "analyze";
const PULL_NUMBER = /\/pull\/(\d+)\/?$/;

export interface PlanLineFloor {
  runs: Pick<FloorClient["runs"], "list">;
  stationRuns: Pick<FloorClient["stationRuns"], "list">;
}

/** A visit parked on a human station: the node a person answers, and the visit the answer is reported to. */
export interface ParkedVisit extends ParkedTarget {
  visitId: string;
}

/** The floor's answer to `PlanLine`: the same fields, with the parked visits carrying the id a report needs. `prUrl` is what `open-spec-pr` produced, and `branch` is what the run was started on. */
export interface FloorPlanLine extends Omit<
  PlanLine,
  "parkedAuthor" | "parkedMerged"
> {
  parkedAuthor: ParkedVisit | null;
  parkedMerged: ParkedVisit | null;
}

export interface PlanKey {
  repo: string;
  planId: string;
}

/** What the floor is asked for a plan's planning runs, newest first. */
export function planRunsFilter({ repo, planId }: PlanKey) {
  return {
    repo: floorRepoOf(repo),
    line: PLANNING_DEFINITION,
    subject: floorPlanSubject(planId),
  };
}

/** The floor's subject key for a plan: the line marks its `plan_id` argument as the subject. */
function floorPlanSubject(planId: string): string {
  return `plan_id:${planId}`;
}

/** The plan's planning run, open if there is one and otherwise the newest; null before any started. */
export async function floorPlanLineState(
  floor: PlanLineFloor,
  key: PlanKey,
): Promise<FloorPlanLine | null> {
  const { items: runs } = await floor.runs.list(planRunsFilter(key));
  const run = runs.find(isOpen) ?? runs.at(0);

  return run ? lineOfRun(floor, run) : null;
}

/** The repository's open planning runs, each read as a line: how a spec PR's close finds the run waiting for it. */
export async function openPlanLines(
  floor: PlanLineFloor,
  repo: string,
): Promise<FloorPlanLine[]> {
  const { items: open } = await floor.runs.list({
    repo: floorRepoOf(repo),
    line: PLANNING_DEFINITION,
    open: true,
  });

  return Promise.all(open.map((run) => lineOfRun(floor, run)));
}

/** The visit parked on `merged` in the run whose spec PR this is. */
export async function visitParkedOnSpecPr(
  floor: PlanLineFloor,
  pr: { repo: string; prNumber: number },
): Promise<ParkedVisit | null> {
  const lines = await openPlanLines(floor, pr.repo);
  const waiting = lines.find((line) => line.prNumber === pr.prNumber);

  return waiting?.parkedMerged ?? null;
}

async function lineOfRun(
  floor: PlanLineFloor,
  run: RunView,
): Promise<FloorPlanLine> {
  return planLineOf(run, await floor.stationRuns.list({ run: run.id }));
}

export function planLineOf(run: RunView, visits: VisitView[]): FloorPlanLine {
  const open = isOpen(run);
  const prUrl = specPrUrlOf(visits);

  return {
    lineId: run.id,
    status: open ? "open" : "finished",
    outcome: run.outcome,
    prNumber: prNumberOf(prUrl),
    prUrl,
    branch: branchOf(run),
    open: open ? openNodeOf(visits) : null,
    parkedAuthor: open ? parkedVisit(visits, AUTHOR_NODE) : null,
    parkedMerged: open ? parkedVisit(visits, MERGED_NODE) : null,
    merged: visits.some(mergedSucceeded),
  };
}

// The newest visit of a node with no report yet is the one a person is answering; an older open one was passed by the walk.
function parkedVisit(visits: VisitView[], nodeId: string): ParkedVisit | null {
  const newest = visits.findLast((visit) => visit.nodeId === nodeId);

  return newest?.report === null
    ? {
        lineId: newest.runId,
        nodeId,
        iteration: newest.iteration,
        visitId: newest.id,
      }
    : null;
}

// Between two visits a run has none open; it is still on the node it last left, never on no node at all.
function openNodeOf(visits: VisitView[]): string {
  const newestOpen = visits.findLast((visit) => visit.report === null);

  return newestOpen?.nodeId ?? visits.at(-1)?.nodeId ?? ENTRY_NODE;
}

function mergedSucceeded({ nodeId, report }: VisitView): boolean {
  return nodeId === MERGED_NODE && report?.outcome === "success";
}

function specPrUrlOf(visits: VisitView[]): string | null {
  const urls = visits.flatMap(({ nodeId, report }) =>
    nodeId === SPEC_PR_NODE ? (report?.produced?.pr_url ?? []) : [],
  );

  return urls.at(-1) ?? null;
}

function prNumberOf(prUrl: string | null): number | null {
  const digits = prUrl ? PULL_NUMBER.exec(prUrl)?.[1] : undefined;

  return digits ? Number(digits) : null;
}

// A run started by hand may name no branch; the line then has none to report.
function branchOf(run: RunView): string | null {
  const ref = startValue(run, "repo");

  return ref?.includes("@") ? parseGitRef(ref).branch : null;
}

// A loop pull request stays the loop's to keep mergeable after its run has settled (specs/external-floor FR12.19): when main moves past it or its build goes red, the pull request's own events start the line again at `sync-pr`, keyed on the pull request, so the rebase and the fix run with the line's budgets and beside the repository's backlog run.
import type { RunView } from "@re-cinq/floor-client";
import type { CiConclusion } from "../../outbound/project/pulls/pull-requests-port.js";
import { parseGitRef } from "../../outbound/floor/floor-items.js";
import { startLoopRun, type LoopFloor } from "./floor-loop.js";
import { issueNumberFromLoopBranch } from "./loop-merge-success.js";
import { implementationTicketDescription } from "./ticket-description.js";

/** The node an upkeep run starts at: the sync before the end-of-line wait. */
export const UPKEEP_ENTRY = "sync-pr";

const UPKEEP_BACKLOG = "upkeep-";

/** What an upkeep run is keyed on: the pull request, so one run works it at a time and none holds the repository's backlog. */
export function upkeepBacklog(prNumber: number): string {
  return `${UPKEEP_BACKLOG}${prNumber}`;
}

/** The pull request as the upkeep decision reads it. */
export interface UpkeepPull {
  number: number;
  url: string;
  branch: string;
  state: "open" | "closed" | "merged";
}

/** A loop ticket's open pull request: on a loop branch, still open. */
export function isLoopPull(pull: UpkeepPull): boolean {
  return (
    pull.state === "open" && issueNumberFromLoopBranch(pull.branch) !== null
  );
}

export interface UpkeepFacts {
  /** Commits of the default branch the branch lacks; undefined when GitHub could not compare. */
  behindBy: number | undefined;
  /** GitHub's mergeability: false on a conflict. */
  mergeable: boolean | null;
  /** The repository's own checks on the head. */
  ci: CiConclusion;
}

/** `judge_parked`: a loop run is open on the branch, so its parked wait is judged now instead of at the next tick. `start`: no run is open and the pull request needs a rebase or a fix. `none`: nothing to do. */
export type UpkeepDecision = "judge_parked" | "start" | "none";

export function decideUpkeep(input: {
  openRun: boolean;
  facts: UpkeepFacts;
}): UpkeepDecision {
  if (input.openRun) {
    return "judge_parked";
  }

  return needsUpkeep(input.facts) ? "start" : "none";
}

function needsUpkeep({ behindBy, mergeable, ci }: UpkeepFacts): boolean {
  return (behindBy ?? 0) > 0 || mergeable === false || ci === "failure";
}

/** The open loop run working the branch, if any: the repository's backlog run or an upkeep run, both carry the branch in their `repo` start item. */
export function openRunOnBranch(
  runs: readonly RunView[],
  branch: string,
): RunView | undefined {
  return runs.find((run) => branchOf(run) === branch);
}

function branchOf(run: RunView): string | undefined {
  const ref = (run.startItems as Partial<Record<string, { ref?: string }>>).repo
    ?.ref;

  return ref ? parseGitRef(ref).branch : undefined;
}

export interface UpkeepStart {
  repo: string;
  pull: UpkeepPull;
  issue: { number: number; title: string; body?: string };
  taskId: string;
}

/** Starts the line at `sync-pr` for the pull request, with the ticket's text and task as the agents expect them. */
export async function startUpkeepRun(
  floor: LoopFloor,
  { repo, pull, issue, taskId }: UpkeepStart,
): Promise<void> {
  await startLoopRun(floor, {
    repo,
    taskId,
    branch: pull.branch,
    issue: { title: issue.title, number: issue.number },
    description: implementationTicketDescription(issue),
    backlog: upkeepBacklog(pull.number),
    openPr: { number: pull.number, url: pull.url },
    entry: UPKEEP_ENTRY,
  });
}

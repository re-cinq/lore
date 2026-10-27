// A loop pull request stays the loop's to keep mergeable after its run has settled (specs/external-floor FR12.19): when main moves past it or its build goes red, the pull request's own events start the line again at `sync-pr`, keyed on the pull request, so the rebase and the fix run with the line's budgets and beside the repository's backlog run.
import type { RunView } from "@re-cinq/floor-client";
import type {
  CiConclusion,
  IssueComment,
} from "../../outbound/project/pulls/pull-requests-port.js";
import { parseGitRef } from "../../outbound/floor/floor-items.js";
import { startLoopRun, type LoopFloor } from "./floor-loop.js";
import { LOOP_PARKING_PREFIX, LORE_BLOCKED_LABEL } from "./labels.js";
import { issueNumberFromLoopBranch } from "./loop-merge-success.js";
import { implementationTicketDescription } from "./ticket-description.js";

/** The node an upkeep run starts at: the sync before the end-of-line wait. */
export const UPKEEP_ENTRY = "sync-pr";

const UPKEEP_BACKLOG = "upkeep-";

/** What an upkeep run is keyed on: the pull request, so one run works it at a time and none holds the repository's backlog. */
export function upkeepBacklog(prNumber: number): string {
  return `${UPKEEP_BACKLOG}${prNumber}`;
}

const UPKEEP_SUBJECT = new RegExp(`^backlog:${UPKEEP_BACKLOG}(\\d+)$`);

/** When each pull request's newest upkeep run started, by pull request number, read from the loop line's runs. */
export function lastUpkeepStarts(
  runs: readonly RunView[],
): Map<number, string> {
  const starts = new Map<number, string>();

  for (const { number, createdAt } of runs.flatMap(upkeepStartOf)) {
    if (createdAt > (starts.get(number) ?? "")) {
      starts.set(number, createdAt);
    }
  }

  return starts;
}

function upkeepStartOf(
  run: RunView,
): Array<{ number: number; createdAt: string }> {
  const digits = UPKEEP_SUBJECT.exec(run.subjectKey ?? "")?.[1];

  return digits ? [{ number: Number(digits), createdAt: run.createdAt }] : [];
}

/** Upkeep runs in a row that ended `iteration_max` after which the loop stops starting them: a third would end the same way. */
export const UPKEEP_GIVE_UPS_IN_A_ROW = 2;

/** Upkeep runs one pull request gets in its life: past it the pull request is a person's to merge or close. */
export const UPKEEP_RUNS_PER_PULL = 10;

export type UpkeepExhaustion =
  { kind: "gave_up"; runs: number } | { kind: "lifetime"; runs: number };

/** Why the loop starts no further upkeep run on the pull request, or null while it still may: of its upkeep runs since the ticket's last park (`since`, null for all of them), the last `UPKEEP_GIVE_UPS_IN_A_ROW` all ended `iteration_max`, or there have been `UPKEEP_RUNS_PER_PULL`. Counting from the last park is what lets a person's removal of the label buy another go: the two give-ups before it would otherwise park the ticket again on the next event. Over the weekend of 2026-10-23 the loop started 77 more runs on pull requests whose last two had given up, $267 for 11 that got through (lore #2879 had 25 runs, #2880 27). */
export function upkeepExhausted(
  prNumber: number,
  runs: readonly RunView[],
  since: string | null = null,
): UpkeepExhaustion | null {
  const own = runs
    .filter((run) => run.subjectKey === `backlog:${upkeepBacklog(prNumber)}`)
    .filter((run) => since === null || run.createdAt > since)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const newest = own.slice(0, UPKEEP_GIVE_UPS_IN_A_ROW);

  if (own.length >= UPKEEP_RUNS_PER_PULL) {
    return { kind: "lifetime", runs: own.length };
  }

  return newest.length === UPKEEP_GIVE_UPS_IN_A_ROW &&
    newest.every((run) => run.outcome === "iteration_max")
    ? { kind: "gave_up", runs: own.length }
    : null;
}

/** When Lore last parked the ticket, read off its own parking comments (a person quoting one is not a park), or null when it never did. */
export function lastParkedAt(
  comments: readonly Pick<IssueComment, "user" | "body" | "created_at">[],
): string | null {
  const parks = comments
    .filter(
      ({ user, body }) =>
        user.endsWith("[bot]") && body.startsWith(LOOP_PARKING_PREFIX),
    )
    .map(({ created_at: at }) => at)
    .sort();

  return parks.at(-1) ?? null;
}

/** The comment that parks the ticket: why no further upkeep run starts, and that the label's removal lets one. */
export function upkeepExhaustedComment(
  pull: Pick<UpkeepPull, "url">,
  exhaustion: UpkeepExhaustion,
): string {
  const why =
    exhaustion.kind === "gave_up"
      ? `its last two upkeep runs on ${pull.url} gave up (\`iteration_max\`), so starting another would end the same way`
      : `${pull.url} has had ${exhaustion.runs} upkeep runs, the most the loop gives one pull request, so it is a person's to merge or close`;

  return (
    `${LOOP_PARKING_PREFIX} ${why}.\n\n` +
    `The pull request stays open for a human. Remove the \`${LORE_BLOCKED_LABEL}\` label to let the loop keep it up to date again.`
  );
}

/** The order upkeep runs start in: a pull request never upkept first, then the one upkept longest ago, then the oldest. Oldest first alone handed the same three failing pull requests every start on every push, and left the rest deferred for good (re-cinq/Otto, re-cinq/lore, 2026-10-24). */
export function upkeepOrder<T extends { number: number }>(
  pulls: readonly T[],
  lastStarts: ReadonlyMap<number, string>,
): T[] {
  const startOf = (pull: T) => lastStarts.get(pull.number) ?? "";

  return [...pulls].sort(
    (a, b) => startOf(a).localeCompare(startOf(b)) || a.number - b.number,
  );
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
  /** GitHub's `mergeable_state`: `behind` only when a branch rule asks the pull request to be up to date with its base. */
  mergeState: string;
  /** GitHub's mergeability: false on a conflict. */
  mergeable: boolean | null;
  /** The repository's own checks on the head. */
  ci: CiConclusion;
  /** Lore's review verdict on the head, from its `lore/code-review` check. */
  review: "approved" | "changes_requested" | "none";
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

/** A conflict, a red build, a branch GitHub calls behind, or changes Lore's own review asked for, which only the loop makes: GitHub refuses Lore's request for changes on a pull request it opened. A branch merely behind main is left alone: GitHub merges it as it is unless a branch rule asks it to be up to date, and rebasing it on every push to main gave lore #2879 24 upkeep runs in two days. */
function needsUpkeep({
  mergeState,
  mergeable,
  ci,
  review,
}: UpkeepFacts): boolean {
  return (
    mergeState === "behind" ||
    mergeable === false ||
    ci === "failure" ||
    review === "changes_requested"
  );
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

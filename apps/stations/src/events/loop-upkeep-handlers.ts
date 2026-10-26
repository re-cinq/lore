// A loop pull request's events, turned into the loop's own upkeep (specs/external-floor FR12.19): a push to the default branch and a finished check suite each ask whether the pull request is behind, conflicted or red, and judge the open run's parked wait now, or start the line again at sync-pr for a pull request whose run has settled. The retry and dead-lettering are the bus's.
import {
  LOOP_LINE,
  type LoopFloor,
  type LoopRunsFloor,
} from "@re-cinq/lore-shared/backlog/floor-loop.js";
import { LORE_BLOCKED_LABEL } from "@re-cinq/lore-shared/backlog/labels.js";
import { issueNumberFromLoopBranch } from "@re-cinq/lore-shared/backlog/loop-merge-success.js";
import {
  decideUpkeep,
  isLoopPull,
  lastUpkeepStarts,
  openRunOnBranch,
  startUpkeepRun,
  upkeepOrder,
  type UpkeepFacts,
} from "@re-cinq/lore-shared/backlog/loop-pr-upkeep.js";
import { floorRepoOf } from "@re-cinq/lore-shared/floor/floor-items.js";
import {
  ciConclusionOf,
  ciJudgedSha,
  externalCheckRuns,
  loreReviewVerdict,
} from "@re-cinq/lore-shared/project/pulls/check-runs.js";
import { implementationLoopEnabled } from "@re-cinq/lore-shared/loops/implementation-loop-enabled.js";
import type { EventHandler } from "@re-cinq/lore-shared/project/events/drain-loop.js";
import type { IssueRef } from "@re-cinq/lore-shared/project/lib/github-port.js";
import type {
  CheckRun,
  Mergeability,
  PullCommit,
  PullRef,
} from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";

/** The repository as the upkeep reads it. */
export interface UpkeepProject {
  pulls: {
    list(): Promise<PullRef[]>;
    get(number: number): Promise<PullRef | null>;
    getMergeability(number: number): Promise<Mergeability>;
    listCommits(number: number): Promise<PullCommit[]>;
    listChecks(ref: string): Promise<CheckRun[]>;
  };
  repo: {
    defaultBranch(): Promise<string>;
  };
  issues: { get(number: number): Promise<IssueRef | null> };
  settings: { rawSettings(): Promise<unknown> };
}

export interface LoopUpkeepDeps {
  floor(): LoopFloor & LoopRunsFloor;
  project(repo: string): Promise<UpkeepProject>;
  /** The newest loop task of the ticket: what the run carries as `task_id`. */
  latestLoopTaskByIssue(
    repo: string,
    issueNumber: number,
  ): Promise<{ id: string } | null>;
  /** Judges the parked wait of the open loop run on the pull request now. */
  judgeParked(repo: string, prNumber: number): Promise<string>;
}

const PUSH = "github.push";
const CHECK_SUITE = "github.check_suite.completed";

export const LOOP_UPKEEP_EVENTS: readonly string[] = [PUSH, CHECK_SUITE];

export function loopUpkeepHandlers(
  deps: LoopUpkeepDeps,
): Map<string, EventHandler> {
  return new Map<string, EventHandler>([
    [PUSH, onPush(deps)],
    [CHECK_SUITE, onCheckSuite(deps)],
  ]);
}

/** One event's repository, with its loop switched on. */
interface Scope {
  repo: string;
  project: UpkeepProject;
  deps: LoopUpkeepDeps;
}

/** Main moved: every open loop pull request based on it may now be behind or in conflict. */
function onPush(deps: LoopUpkeepDeps): EventHandler {
  return async (params) => {
    const { repo, branch } = params as { repo?: string; branch?: string };
    const scope = repo && branch ? await scopeOf(deps, repo) : null;

    if (!scope || branch !== (await defaultBranchOf(scope))) {
      return;
    }
    const { pulls } = scope.project;
    const concerned = (await pulls.list()).filter(
      (pull) => isLoopPull(pull) && (pull.baseBranch ?? branch) === branch,
    );

    await upkeepEach(scope, concerned);
  };
}

/** A check suite finished on the pull request's head: its build may be red. */
function onCheckSuite(deps: LoopUpkeepDeps): EventHandler {
  return async (params) => {
    const { repo, head_sha: headSha } = params as {
      repo?: string;
      head_sha?: string;
    };
    const scope = repo && headSha ? await scopeOf(deps, repo) : null;

    if (scope) {
      await upkeepEach(scope, await loopPulls(scope, params, headSha ?? ""));
    }
  };
}

/** The suite's pull requests by number, or, when GitHub delivered the suite with none named, the open pull requests on its head. */
async function loopPulls(
  { project }: Scope,
  params: Readonly<Record<string, unknown>>,
  headSha: string,
): Promise<PullRef[]> {
  const { pulls } = project;
  const numbers = Array.isArray(params.pr_numbers)
    ? params.pr_numbers.filter((n): n is number => typeof n === "number")
    : [];
  const read =
    numbers.length > 0
      ? await Promise.all(numbers.map((n) => pulls.get(n)))
      : (await pulls.list()).filter((pull) => pull.headSha === headSha);

  return read.filter(
    (pull): pull is PullRef => pull !== null && isLoopPull(pull),
  );
}

function defaultBranchOf({ project }: Scope): Promise<string> {
  const { repo } = project;

  return repo.defaultBranch();
}

/** Nothing for a repository whose implementation loop is off: its pull requests are nobody's to rebase. */
async function scopeOf(
  deps: LoopUpkeepDeps,
  repo: string,
): Promise<Scope | null> {
  const project = await deps.project(repo);
  const { settings } = project;

  return implementationLoopEnabled(await settings.rawSettings())
    ? { repo, project, deps }
    : null;
}

/** Rebase runs one event may start per repository, the pull request upkept longest ago first (`upkeepOrder`): after a merge every open loop pull request is behind, and a pod for each at once is a stampede. The rest wait for the next push or check suite. */
export const STARTS_PER_EVENT = 3;

async function upkeepEach(scope: Scope, pulls: PullRef[]): Promise<void> {
  if (pulls.length === 0) {
    return;
  }
  const openRuns = await openLoopRuns(scope);
  const working = pulls.filter((pull) =>
    openRunOnBranch(openRuns, pull.branch),
  );
  const settled = pulls.filter((pull) => !working.includes(pull));
  const outcomes = await Promise.all([
    ...working.map((pull) => judgeOpenRun(scope, pull)),
    upkeepSettled(scope, settled),
  ]);

  console.log(
    `[stations] loop-upkeep: ${scope.repo}: ${outcomes.flat().join("; ")}`,
  );
}

async function openLoopRuns({ repo, deps }: Scope) {
  const { runs } = deps.floor();
  const { items: openRuns } = await runs.list({
    repo: floorRepoOf(repo),
    line: LOOP_LINE,
    open: true,
  });

  return openRuns;
}

/** A run is working the branch: its parked wait hears the verdict now rather than at the next tick. */
async function judgeOpenRun(scope: Scope, pull: PullRef): Promise<string> {
  return `#${pull.number} ${await scope.deps.judgeParked(scope.repo, pull.number)}`;
}

/** No run is working these branches: each is read, and a run is started for the oldest few that need a rebase or a fix. */
async function upkeepSettled(
  scope: Scope,
  pulls: PullRef[],
): Promise<string[]> {
  const needing = await Promise.all(
    pulls.map(async (pull) => ((await needsUpkeep(scope, pull)) ? pull : null)),
  );
  const due = upkeepOrder(
    needing.filter((pull): pull is PullRef => pull !== null),
    lastUpkeepStarts(await loopRuns(scope)),
  );
  const started = await Promise.all(
    due.slice(0, STARTS_PER_EVENT).map((pull) => startOutcome(scope, pull)),
  );

  return [
    ...started,
    ...due.slice(STARTS_PER_EVENT).map((pull) => `#${pull.number} deferred`),
  ];
}

/** The loop line's runs of the repository, open and finished, newest first: where each pull request's last upkeep run is read from. */
async function loopRuns({ repo, deps }: Scope) {
  const { runs } = deps.floor();
  const { items: lineRuns } = await runs.list(
    { repo: floorRepoOf(repo), line: LOOP_LINE },
    { limit: 200 },
  );

  return lineRuns;
}

async function startOutcome(scope: Scope, pull: PullRef): Promise<string> {
  return `#${pull.number} ${await startFor(scope, pull)}`;
}

async function needsUpkeep(scope: Scope, pull: PullRef): Promise<boolean> {
  const [facts, parked] = await Promise.all([
    factsOf(scope.project, pull),
    ticketParked(scope.project, pull),
  ]);

  return !parked && decideUpkeep({ openRun: false, facts }) === "start";
}

/** The loop parked the pull request's ticket: a run on it ended blocked, and the ticket is a person's until they take the label off. Upkeep that ignored the label started a run on lore #2879 after every push to main, each ending in the same place. */
async function ticketParked(
  { issues }: UpkeepProject,
  pull: PullRef,
): Promise<boolean> {
  const number = issueNumberFromLoopBranch(pull.branch);
  const ticket = number === null ? null : await issues.get(number);

  return ticket?.labels.includes(LORE_BLOCKED_LABEL) ?? false;
}

async function factsOf(
  { pulls }: UpkeepProject,
  pull: PullRef,
): Promise<UpkeepFacts> {
  const [{ mergeable, state }, checks] = await Promise.all([
    pulls.getMergeability(pull.number),
    judgedChecks(pulls, pull.number),
  ]);

  return {
    mergeState: state,
    mergeable,
    ci: checks ? ciConclusionOf(externalCheckRuns(checks)) : "none",
    review: loreReviewVerdict(checks ?? []),
  };
}

/** The check runs on the commit CI judged, as the loop's waits read them: a `[skip ci]` commit on top is never mistaken for a build that did not start, and Lore's review check is read from the same commit. Null when every commit skipped CI. */
async function judgedChecks(
  pulls: UpkeepProject["pulls"],
  prNumber: number,
): Promise<CheckRun[] | null> {
  const judged = ciJudgedSha(await pulls.listCommits(prNumber));

  return judged ? pulls.listChecks(judged) : null;
}

/** The ticket's text and task ride along as on any loop run; a pull request whose ticket or task cannot be found is left for the next event. */
async function startFor(scope: Scope, pull: PullRef): Promise<string> {
  const issueNumber = issueNumberFromLoopBranch(pull.branch);
  const { issues } = scope.project;
  const [issue, task] = await Promise.all([
    issueNumber === null ? null : issues.get(issueNumber),
    issueNumber === null
      ? null
      : scope.deps.latestLoopTaskByIssue(scope.repo, issueNumber),
  ]);

  if (!issue || !task) {
    return `no ${issue ? "task" : "ticket"} for ${pull.branch}: not started`;
  }
  await startUpkeepRun(scope.deps.floor(), {
    repo: scope.repo,
    pull,
    issue: { number: issue.number, title: issue.title, body: issue.body },
    taskId: task.id,
  });

  return "upkeep run started at sync-pr";
}

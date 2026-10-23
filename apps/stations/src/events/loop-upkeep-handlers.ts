// A loop pull request's events, turned into the loop's own upkeep (specs/external-floor FR12.19): a push to the default branch and a finished check suite each ask whether the pull request is behind, conflicted or red, and judge the open run's parked wait now, or start the line again at sync-pr for a pull request whose run has settled. The retry and dead-lettering are the bus's.
import {
  LOOP_LINE,
  type LoopFloor,
  type LoopRunsFloor,
} from "@re-cinq/lore-shared/backlog/floor-loop.js";
import { issueNumberFromLoopBranch } from "@re-cinq/lore-shared/backlog/loop-merge-success.js";
import {
  decideUpkeep,
  isLoopPull,
  openRunOnBranch,
  startUpkeepRun,
  type UpkeepFacts,
} from "@re-cinq/lore-shared/backlog/loop-pr-upkeep.js";
import { floorRepoOf } from "@re-cinq/lore-shared/floor/floor-items.js";
import {
  ciConclusionOf,
  ciJudgedSha,
  externalCheckRuns,
} from "@re-cinq/lore-shared/project/pulls/check-runs.js";
import { implementationLoopEnabled } from "@re-cinq/lore-shared/loops/implementation-loop-enabled.js";
import type { EventHandler } from "@re-cinq/lore-shared/project/events/drain-loop.js";
import type { IssueRef } from "@re-cinq/lore-shared/project/lib/github-port.js";
import type {
  CheckRun,
  CiConclusion,
  PullCommit,
  PullRef,
} from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";

/** The repository as the upkeep reads it. */
export interface UpkeepProject {
  pulls: {
    list(): Promise<PullRef[]>;
    get(number: number): Promise<PullRef | null>;
    listCommits(number: number): Promise<PullCommit[]>;
    listChecks(ref: string): Promise<CheckRun[]>;
  };
  repo: {
    defaultBranch(): Promise<string>;
    branchBehindBy(branch: string): Promise<number | undefined>;
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

async function upkeepEach(scope: Scope, pulls: PullRef[]): Promise<void> {
  if (pulls.length === 0) {
    return;
  }
  const { runs } = scope.deps.floor();
  const { items: openRuns } = await runs.list({
    repo: floorRepoOf(scope.repo),
    line: LOOP_LINE,
    open: true,
  });
  const outcomes = await Promise.all(
    pulls.map(async (pull) => {
      const outcome = openRunOnBranch(openRuns, pull.branch)
        ? await judgeOpenRun(scope, pull)
        : await upkeepSettled(scope, pull);

      return `#${pull.number} ${outcome}`;
    }),
  );

  console.log(`[stations] loop-upkeep: ${scope.repo}: ${outcomes.join("; ")}`);
}

/** A run is working the branch: its parked wait hears the verdict now rather than at the next tick. */
function judgeOpenRun(scope: Scope, pull: PullRef): Promise<string> {
  return scope.deps.judgeParked(scope.repo, pull.number);
}

/** No run is working the branch: the pull request is read, and one is started only when it needs a rebase or a fix. */
async function upkeepSettled(scope: Scope, pull: PullRef): Promise<string> {
  const facts = await factsOf(scope.project, pull);
  const decision = decideUpkeep({ openRun: false, facts });

  return decision === "start" ? startFor(scope, pull) : "on main and green";
}

async function factsOf(
  { repo, pulls }: UpkeepProject,
  pull: PullRef,
): Promise<UpkeepFacts> {
  const [behindBy, fresh, ci] = await Promise.all([
    repo.branchBehindBy(pull.branch),
    pulls.get(pull.number),
    buildOf(pulls, pull.number),
  ]);

  return { behindBy, mergeable: fresh?.mergeable ?? null, ci };
}

/** The repository's own checks on the commit CI judged, as the loop's waits read them: Lore's checks left out, and a `[skip ci]` commit on top never mistaken for a build that did not start. */
async function buildOf(
  pulls: UpkeepProject["pulls"],
  prNumber: number,
): Promise<CiConclusion> {
  const judged = ciJudgedSha(await pulls.listCommits(prNumber));

  return judged
    ? ciConclusionOf(externalCheckRuns(await pulls.listChecks(judged)))
    : "none";
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

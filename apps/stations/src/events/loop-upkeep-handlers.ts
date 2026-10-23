// A loop pull request's events, turned into the loop's own upkeep (specs/external-floor FR12.19): a push to the default branch and a finished check suite each ask whether the pull request is behind, conflicted or red, and judge the open run's parked wait now, or start the line again at sync-pr for a pull request whose run has settled. The retry and dead-lettering are the bus's.
import type { FloorClient } from "@re-cinq/floor-client";
import {
  LOOP_LINE,
  type LoopFloor,
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
import { implementationLoopEnabled } from "@re-cinq/lore-shared/loops/implementation-loop-enabled.js";
import type { EventHandler } from "@re-cinq/lore-shared/project/events/drain-loop.js";
import type { IssueRef } from "@re-cinq/lore-shared/project/lib/github-port.js";
import type {
  CiConclusion,
  PullRef,
} from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";

/** The repository as the upkeep reads it. */
export interface UpkeepProject {
  pulls: {
    list(): Promise<PullRef[]>;
    get(number: number): Promise<PullRef | null>;
    ciConclusion(ref: string): Promise<CiConclusion>;
  };
  repo: {
    defaultBranch(): Promise<string>;
    branchBehindBy(branch: string): Promise<number | undefined>;
  };
  issues: { get(number: number): Promise<IssueRef | null> };
  settings: { rawSettings(): Promise<unknown> };
}

export interface LoopUpkeepDeps {
  floor(): LoopFloor & { runs: Pick<FloorClient["runs"], "list"> };
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

    if (!scope || branch !== (await scope.project.repo.defaultBranch())) {
      return;
    }
    const pulls = (await scope.project.pulls.list()).filter(
      (pull) => isLoopPull(pull) && (pull.baseBranch ?? branch) === branch,
    );

    await upkeepEach(scope, pulls);
  };
}

/** A check suite finished on the pull request's head: its build may be red. */
function onCheckSuite(deps: LoopUpkeepDeps): EventHandler {
  return async (params) => {
    const { repo, pr_numbers: numbers } = params as {
      repo?: string;
      pr_numbers?: unknown;
    };
    const scope =
      repo && Array.isArray(numbers) ? await scopeOf(deps, repo) : null;

    if (!scope) {
      return;
    }
    const pulls = await Promise.all(
      (numbers as unknown[])
        .filter((n): n is number => typeof n === "number")
        .map((n) => scope.project.pulls.get(n)),
    );

    await upkeepEach(
      scope,
      pulls.filter(
        (pull): pull is PullRef => pull !== null && isLoopPull(pull),
      ),
    );
  };
}

/** Nothing for a repository whose implementation loop is off: its pull requests are nobody's to rebase. */
async function scopeOf(
  deps: LoopUpkeepDeps,
  repo: string,
): Promise<Scope | null> {
  const project = await deps.project(repo);

  return implementationLoopEnabled(await project.settings.rawSettings())
    ? { repo, project, deps }
    : null;
}

async function upkeepEach(scope: Scope, pulls: PullRef[]): Promise<void> {
  if (pulls.length === 0) {
    return;
  }
  const { items: openRuns } = await scope.deps.floor().runs.list({
    repo: floorRepoOf(scope.repo),
    line: LOOP_LINE,
    open: true,
  });
  const outcomes = await Promise.all(
    pulls.map(async (pull) => {
      const open = openRunOnBranch(openRuns, pull.branch) !== undefined;

      return `#${pull.number} ${await upkeep(scope, pull, open)}`;
    }),
  );

  console.log(`[stations] loop-upkeep: ${scope.repo}: ${outcomes.join("; ")}`);
}

async function upkeep(
  scope: Scope,
  pull: PullRef,
  openRun: boolean,
): Promise<string> {
  const facts = openRun ? null : await factsOf(scope.project, pull);
  const decision = decideUpkeep({ openRun, facts: facts ?? ON_MAIN });

  if (decision === "judge_parked") {
    return scope.deps.judgeParked(scope.repo, pull.number);
  }

  return decision === "start" ? startFor(scope, pull) : "on main and green";
}

const ON_MAIN: UpkeepFacts = { behindBy: 0, mergeable: true, ci: "none" };

async function factsOf(
  project: UpkeepProject,
  pull: PullRef,
): Promise<UpkeepFacts> {
  const [behindBy, fresh, ci] = await Promise.all([
    project.repo.branchBehindBy(pull.branch),
    project.pulls.get(pull.number),
    project.pulls.ciConclusion(pull.headSha ?? pull.branch),
  ]);

  return { behindBy, mergeable: fresh?.mergeable ?? null, ci };
}

/** The ticket's text and task ride along as on any loop run; a pull request whose ticket or task cannot be found is left for the next event. */
async function startFor(scope: Scope, pull: PullRef): Promise<string> {
  const issueNumber = issueNumberFromLoopBranch(pull.branch);
  const [issue, task] = await Promise.all([
    issueNumber === null ? null : scope.project.issues.get(issueNumber),
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

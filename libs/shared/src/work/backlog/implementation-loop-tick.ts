import { implementationLoopBranch } from "../../outbound/project/assembly-runs/subject-keys.js";
import type { EventHandler } from "../../outbound/project/events/drain-loop.js";
import type { IssueRef } from "../../outbound/project/lib/github-port.js";
import { implementationLoopMaxParallel } from "../../domain/loops/implementation-loop-max-parallel.js";
import { decideBranchResume, type OpenPr } from "./resume-branch.js";
import { UPKEEP_ENTRY } from "./loop-pr-upkeep.js";
import { orderBacklog, type RankingCriterion } from "./select-next-issue.js";
import { candidateGuardOf, loopGuardOf } from "./ticket-guards.js";
import { implementationTicketDescription } from "./ticket-description.js";

/** Narrow data slice so the tick is testable without the kernel (specs/implementation-loop FR2). */
export interface LoopTickDeps {
  listRepos(): Promise<string[]>;
  rawSettings(repo: string): Promise<unknown>;
  /** Whether the repo's onboarding PR has merged; the loop never picks for a repo that has not finished onboarding. */
  isOnboarded(repo: string): Promise<boolean>;
  /** The repository's open ticket runs, under either key a ticket's run has had; upkeep runs and plan tasks are not counted. */
  countOpenTicketRuns(repo: string): Promise<number>;
  activeTaskByIssue(
    repo: string,
    issueNumber: number,
  ): Promise<{ id: string; status: string } | null>;
  listIssues(repo: string): Promise<IssueRef[]>;
  createTask(input: {
    description: string;
    taskType: string;
    targetRepo: string;
    createdBy: string;
    contextBundle: Record<string, unknown>;
  }): Promise<{ task_id: string }>;
  setTaskColumns(
    taskId: string,
    columns: Record<string, unknown>,
  ): Promise<void>;
  /** `undefined` when the port cannot answer — unknown must never read as "no branch". */
  branchExists(repo: string, branch: string): Promise<boolean | undefined>;
  /** `true` when the branch's head is already an ancestor of the base — every commit is on main, a resumed run cannot push anything new. `undefined` when the port cannot answer. */
  branchMerged(repo: string, branch: string): Promise<boolean | undefined>;
  openPrForBranch(
    repo: string,
    branch: string,
  ): Promise<{ number: number; url: string } | null>;
  /** Numbers of the open issues linked as blocking this one; asked only of a ticket that carries blocked-by links. */
  openBlockers(repo: string, issueNumber: number): Promise<number[]>;
  /** What happens once the ticket's task exists. Where Lore's own Floor walks the loop this does nothing, because its worker claims the pending task; where the external floor does, this starts the run. */
  started(ticket: StartedTicket): Promise<void>;
}

/** A ticket the tick has just minted a task for. */
export interface StartedTicket {
  repo: string;
  taskId: string;
  branch: string;
  issue: Pick<IssueRef, "number" | "title">;
  /** The ticket as the agents read it. */
  description: string;
  /** The pull request a resumed branch already has; null for a fresh branch, and for a resumed one nobody opened a pull request for. */
  openPr: OpenPr | null;
  /** Where the run starts; left out, the line's entry. */
  entry?: string;
}

/** One tick of the self-re-arming backlog loop (FR2): serialized per repo by the open-run subject key, per issue by `activeTaskByIssue` (FR1's "no open PR already referencing it"); a cross-issue race settles via the unique `(repo, subject_key)` index. */
export function createImplementationLoopTickHandler(
  deps: LoopTickDeps,
): EventHandler {
  return async (params) => {
    const repos =
      typeof params.repo === "string" && params.repo.length > 0
        ? [params.repo]
        : await deps.listRepos();

    for (const repo of repos) {
      try {
        await tickRepo(repo, deps);
      } catch (err) {
        console.error(
          `[implementation-loop] ${repo}: ${(err as Error).message}`,
        );
      }
    }
  };
}

interface BacklogPick {
  picked: IssueRef | null;
  guarded: number[];
}

async function tickRepo(repo: string, deps: LoopTickDeps): Promise<void> {
  const settings = await deps.rawSettings(repo);
  const free = await freeSlots(repo, settings, deps);

  if (free === 0) {
    return;
  }

  const criteria = rankingCriteriaFor(settings);
  const ordered = orderBacklog(
    await deps.listIssues(repo),
    criteria !== undefined ? { criteria } : undefined,
  );

  await startUpTo(free, { repo, ordered }, deps);
}

interface BacklogWalk {
  repo: string;
  ordered: IssueRef[];
}

/** Starts a run for each of the next `slots` unguarded tickets, in pick order; a ticket started is taken off the list, because its task may not show as active yet. */
async function startUpTo(
  slots: number,
  { repo, ordered }: BacklogWalk,
  deps: LoopTickDeps,
): Promise<void> {
  let candidates = ordered;

  for (let started = 0; started < slots; started++) {
    const { picked, guarded } = await pickBacklogTicket(repo, candidates, deps);

    if (!picked) {
      return logNoPick(repo, started === 0 ? guarded : []);
    }
    await startTicket(repo, picked, deps);
    candidates = candidates.filter(({ number }) => number !== picked.number);
  }
}

const VALID_RANKING_CRITERIA = new Set<string>([
  "priority",
  "age",
  "unblocks",
  "size",
]);

export function rankingCriteriaFor(
  settings: unknown,
): RankingCriterion[] | undefined {
  const rawCriteria = toRecord(toRecord(settings)?.backlog_ranking)?.criteria;

  if (!Array.isArray(rawCriteria)) {
    return undefined;
  }
  const filtered = rawCriteria.filter((crit): crit is RankingCriterion =>
    VALID_RANKING_CRITERIA.has(String(crit)),
  );

  return filtered.length > 0 ? filtered : undefined;
}

function toRecord(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }

  return raw as Record<string, unknown>;
}

/** How many runs this tick may start for the repo: nothing while a loop guard holds it, otherwise what `implementation_loop.max_parallel` leaves over the ticket runs already open. */
async function freeSlots(
  repo: string,
  settings: unknown,
  deps: LoopTickDeps,
): Promise<number> {
  if (await loopGuardOf(repo, settings, deps)) {
    return 0;
  }

  return Math.max(
    0,
    implementationLoopMaxParallel(settings) -
      (await deps.countOpenTicketRuns(repo)),
  );
}

/** Walks past guarded tickets rather than stopping on the first one — returning on the guarded HEAD froze the backlog behind one unmerged PR twice (27h 2026-08-30, overnight 2026-09-02). */
async function pickBacklogTicket(
  repo: string,
  ordered: IssueRef[],
  deps: LoopTickDeps,
): Promise<BacklogPick> {
  const guarded: number[] = [];

  for (const candidate of ordered) {
    const guard = await candidateGuardOf(repo, candidate, deps);

    if (guard === null) {
      return { picked: candidate, guarded };
    }

    if (guard === "active_task") {
      guarded.push(candidate.number);
    }
  }

  return { picked: null, guarded };
}

/** A backlog that EXISTS but can't be picked must say so — silence here once ate a morning of diagnosis. */
function logNoPick(repo: string, guarded: number[]): void {
  if (guarded.length === 0) {
    return;
  }

  console.log(
    `[implementation-loop] ${repo}: no pick — ${guarded.length} eligible ticket(s), all awaiting an earlier task (${guarded.map((n) => `#${n}`).join(", ")})`,
  );
}

/** Mints the ticket's task and hands it to whoever starts it, on its own branch and continuing the work the branch already has. */
export async function startTicket(
  repo: string,
  picked: IssueRef,
  deps: LoopTickDeps,
): Promise<void> {
  const branch = implementationLoopBranch(picked.number);
  const resume = await resolveResume(repo, picked, branch, deps);

  await dispatchLoopTask({ repo, picked, branch, resume }, deps);
}

interface LoopDispatchInput {
  repo: string;
  picked: IssueRef;
  branch: string;
  resume: ReturnType<typeof decideBranchResume>;
}

/** Creates the backlog task, stamps the issue link onto it, and hands it to whoever starts it. A ticket whose pull request is open and ready for review continues at `sync-pr`, where its pull request is: starting it at the line's entry made `dod` judge the finished branch and close re-cinq/Otto #326 as "already resolved" while its pull request still had review findings to address (2026-10-25). */
async function dispatchLoopTask(
  input: LoopDispatchInput,
  deps: LoopTickDeps,
): Promise<void> {
  const { repo, picked, branch, resume } = input;
  const description = implementationTicketDescription(picked);
  const taskId = await mintTask(input, description, deps);
  const openPr = resume.resume ? resume.openPr : null;

  logDispatch(input, taskId);
  await deps.started({
    repo,
    taskId,
    branch,
    issue: picked,
    description,
    openPr,
    ...(openPr?.draft === false ? { entry: UPKEEP_ENTRY } : {}),
  });
}

async function mintTask(
  input: LoopDispatchInput,
  description: string,
  deps: LoopTickDeps,
): Promise<string> {
  const { repo, picked } = input;
  const task = await deps.createTask({
    description,
    taskType: "implementation-loop",
    targetRepo: repo,
    createdBy: "implementation-loop",
    contextBundle: loopContextBundle(picked, input.branch),
  });

  await deps.setTaskColumns(task.task_id, {
    issue_number: picked.number,
    ...(picked.url ? { issue_url: picked.url } : {}),
  });

  return task.task_id;
}

function logDispatch(input: LoopDispatchInput, taskId: string): void {
  const { repo, picked, branch, resume } = input;

  console.log(
    `[implementation-loop] ${repo}: picked #${picked.number} as task ${taskId}` +
      (resume.resume ? ` (continuing ${branch})` : ""),
  );
}

function loopContextBundle(
  picked: IssueRef,
  branch: string,
): Record<string, unknown> {
  return {
    github_issue_number: picked.number,
    ...(picked.url ? { github_issue_url: picked.url } : {}),
    branch,
  };
}

/** Continuing a branch is silent by design: the run is started with the branch's pull request, and GitHub is told nothing. Deleting the branch is the owner's restart lever. */
async function resolveResume(
  repo: string,
  picked: IssueRef,
  branch: string,
  deps: LoopTickDeps,
): Promise<ReturnType<typeof decideBranchResume>> {
  const [branchExists, openPr, branchMerged] = await Promise.all([
    deps.branchExists(repo, branch),
    deps.openPrForBranch(repo, branch),
    deps.branchMerged(repo, branch),
  ]);

  return decideBranchResume({
    branchExists,
    branchMerged,
    issueLabels: picked.labels,
    openPr,
  });
}

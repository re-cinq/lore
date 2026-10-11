import { MAX_TASK_DESCRIPTION_CHARS } from "../../domain/task-description.js";
import {
  backlogSubject,
  implementationLoopBranch,
} from "../../outbound/project/assembly-runs/subject-keys.js";
import type { EventHandler } from "../../outbound/project/events/drain-loop.js";
import type { IssueRef } from "../../outbound/project/lib/github-port.js";
import { implementationLoopEnabled } from "./implementation-loop-enabled.js";
import { decideBranchResume, type OpenPr } from "./resume-branch.js";
import { orderBacklog } from "./select-next-issue.js";
import {
  implementationTicketDescription,
  ticketTextTooLong,
} from "./ticket-description.js";

/** Narrow data slice so the tick is testable without the kernel (specs/implementation-loop FR2). */
export interface LoopTickDeps {
  listRepos(): Promise<string[]>;
  rawSettings(repo: string): Promise<unknown>;
  /** Whether the repo's onboarding PR has merged; the loop never picks for a repo that has not finished onboarding. */
  isOnboarded(repo: string): Promise<boolean>;
  findOpenBySubject(
    repo: string,
    subjectKey: string,
  ): Promise<{ id: string } | null>;
  activeTaskByIssue(
    repo: string,
    issueNumber: number,
  ): Promise<{ id: string } | null>;
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
  if (!(await readyToPick(repo, deps))) {
    return;
  }

  const ordered = orderBacklog(await deps.listIssues(repo));
  const { picked, guarded } = await pickBacklogTicket(repo, ordered, deps);

  if (!picked) {
    logNoPick(repo, guarded);

    return;
  }

  const branch = implementationLoopBranch(picked.number);
  const resume = await resolveResume(repo, picked, branch, deps);

  await dispatchLoopTask({ repo, picked, branch, resume }, deps);
}

/** Whether this tick may pick for the repo: its loop is on, it has finished onboarding, and it is not already driving a run. A repo that is on but not onboarded says so, because a tick that only walked onboarded repos once skipped such a repo with no trace at all. */
async function readyToPick(repo: string, deps: LoopTickDeps): Promise<boolean> {
  if (!implementationLoopEnabled(await deps.rawSettings(repo))) {
    return false;
  }

  if (!(await deps.isOnboarded(repo))) {
    console.log(
      `[implementation-loop] ${repo}: loop enabled but the repo is not onboarded — its onboarding PR has not merged, so no ticket is picked`,
    );

    return false;
  }

  return !(await deps.findOpenBySubject(repo, backlogSubject()));
}

/** Walks past guarded tickets rather than stopping on the first one — returning on the guarded HEAD froze the backlog behind one unmerged PR twice (27h 2026-08-30, overnight 2026-09-02). */
async function pickBacklogTicket(
  repo: string,
  ordered: IssueRef[],
  deps: LoopTickDeps,
): Promise<BacklogPick> {
  const guarded: number[] = [];

  for (const candidate of ordered) {
    if (await walkedPast(repo, candidate, deps)) {
      continue;
    }

    if (await deps.activeTaskByIssue(repo, candidate.number)) {
      guarded.push(candidate.number);
      continue;
    }

    return { picked: candidate, guarded };
  }

  return { picked: null, guarded };
}

/** A ticket no pod could start on is walked past, not dispatched, and the driver logs why. */
async function walkedPast(
  repo: string,
  candidate: IssueRef,
  deps: LoopTickDeps,
): Promise<boolean> {
  if (ticketTextTooLong(candidate)) {
    logTextTooLong(repo, candidate.number);

    return true;
  }

  return waitsOnOpenBlockers(repo, candidate, deps);
}

/** A ticket whose blockers are still open is walked past, not dispatched: no pod can build on work that has not landed (run db0304bb). It is picked again on the first tick after its last blocker closes, with no label to lift. */
async function waitsOnOpenBlockers(
  repo: string,
  candidate: IssueRef,
  deps: LoopTickDeps,
): Promise<boolean> {
  if (!candidate.blockedByCount) {
    return false;
  }
  const open = await deps.openBlockers(repo, candidate.number);

  if (open.length === 0) {
    return false;
  }

  console.log(
    `[implementation-loop] ${repo}: skipped #${candidate.number} — waits on open blocker(s) ${open.map((n) => `#${n}`).join(", ")}`,
  );

  return true;
}

/** A ticket whose text is too long is walked past, not minted: task creation would refuse it, and a refusal thrown at the head froze re-cinq/Otto's backlog for two days. */
function logTextTooLong(repo: string, issueNumber: number): void {
  console.log(
    `[implementation-loop] ${repo}: skipped #${issueNumber} — ticket text too long: its title and body exceed the ${MAX_TASK_DESCRIPTION_CHARS}-char task description limit`,
  );
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

interface LoopDispatchInput {
  repo: string;
  picked: IssueRef;
  branch: string;
  resume: ReturnType<typeof decideBranchResume>;
}

/** Creates the backlog task, stamps the issue link onto it, and hands it to whoever starts it. */
async function dispatchLoopTask(
  input: LoopDispatchInput,
  deps: LoopTickDeps,
): Promise<void> {
  const { repo, picked, branch, resume } = input;
  const description = implementationTicketDescription(picked);
  const taskId = await mintTask(input, description, deps);

  logDispatch(input, taskId);
  await deps.started({
    repo,
    taskId,
    branch,
    issue: picked,
    description,
    openPr: resume.resume ? resume.openPr : null,
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
  const [branchExists, openPr] = await Promise.all([
    deps.branchExists(repo, branch),
    deps.openPrForBranch(repo, branch),
  ]);

  return decideBranchResume({
    branchExists,
    issueLabels: picked.labels,
    openPr,
  });
}

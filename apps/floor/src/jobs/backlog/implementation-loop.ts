import type { IssueRef } from "@re-cinq/lore-shared";
import { orderBacklog } from "@re-cinq/lore-shared";
import {
  backlogSubject,
  implementationLoopBranch,
} from "@re-cinq/lore-shared/project/assembly-runs/subject-keys.js";
import { decideBranchResume } from "./resume-branch.js";
import { implementationTicketDescription } from "./ticket-description.js";
import type { EventHandler } from "../../main-loop/types.js";
import { implementationLoopEnabled } from "./implementation-loop-enabled.js";

/** Narrow data slice so the tick is testable without the kernel (specs/implementation-loop FR2). */
export interface LoopTickDeps {
  listRepos(): Promise<string[]>;
  rawSettings(repo: string): Promise<unknown>;
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

/** Walks past guarded tickets rather than stopping on the first one — returning on the guarded HEAD froze the backlog behind one unmerged PR twice (27h 2026-08-30, overnight 2026-09-02). */
async function pickBacklogTicket(
  repo: string,
  ordered: IssueRef[],
  deps: LoopTickDeps,
): Promise<BacklogPick> {
  const guarded: number[] = [];

  for (const candidate of ordered) {
    if (await deps.activeTaskByIssue(repo, candidate.number)) {
      guarded.push(candidate.number);
      continue;
    }

    return { picked: candidate, guarded };
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

function buildLineArgs(
  picked: IssueRef,
  resume: ReturnType<typeof decideBranchResume>,
): Record<string, unknown> {
  return {
    pr_draft: true,
    // Rides onto the run's args so the PR footer can close the ticket on merge.
    issue_number: picked.number,
    // PR title from issue until pr-ready node updates it from the branch.
    issue_title: picked.title,
    ...(resume.resume ? resume.lineArgs : {}),
  };
}

interface LoopDispatchInput {
  repo: string;
  picked: IssueRef;
  branch: string;
  resume: ReturnType<typeof decideBranchResume>;
}

/** Creates the backlog task and stamps the issue link onto it; console-logs whether it resumed an existing branch. */
async function dispatchLoopTask(
  input: LoopDispatchInput,
  deps: LoopTickDeps,
): Promise<void> {
  const { repo, picked, branch, resume } = input;
  const task = await deps.createTask({
    description: implementationTicketDescription(picked),
    taskType: "implementation-loop",
    targetRepo: repo,
    createdBy: "implementation-loop",
    contextBundle: {
      github_issue_number: picked.number,
      ...(picked.url ? { github_issue_url: picked.url } : {}),
      branch,
      // Draft PR: the line declares the flag; a draft gets no Lore code review, avoiding twelve reviews on twelve round-pushes.
      line_args: buildLineArgs(picked, resume),
    },
  });

  await deps.setTaskColumns(task.task_id, {
    issue_number: picked.number,
    ...(picked.url ? { issue_url: picked.url } : {}),
  });
  console.log(
    `[implementation-loop] ${repo}: picked #${picked.number} as task ${task.task_id}` +
      (resume.resume ? ` (continuing ${branch})` : ""),
  );
}

async function tickRepo(repo: string, deps: LoopTickDeps): Promise<void> {
  if (!implementationLoopEnabled(await deps.rawSettings(repo))) {
    return;
  }

  if (await deps.findOpenBySubject(repo, backlogSubject())) {
    return;
  }

  const ordered = orderBacklog(await deps.listIssues(repo));
  const { picked, guarded } = await pickBacklogTicket(repo, ordered, deps);

  if (!picked) {
    logNoPick(repo, guarded);

    return;
  }

  const branch = implementationLoopBranch(picked.number);
  // Continuing a branch is silent by design: recorded on the run's args, not GitHub. Deleting the branch is the owner's restart lever.
  const [branchExists, openPr] = await Promise.all([
    deps.branchExists(repo, branch),
    deps.openPrForBranch(repo, branch),
  ]);
  const resume = decideBranchResume({
    branchExists,
    issueLabels: picked.labels,
    openPr,
  });

  await dispatchLoopTask({ repo, picked, branch, resume }, deps);
}

/** Production wiring for the `cron.implementation_loop.tick` handler. */
export const implementationLoopTick: EventHandler = async (params) => {
  const [{ pipeline, settings, taskStore }, { projectFor }] = await Promise.all(
    [
      import("../../kernel/queues.js"),
      import("../../composition/project-boot.js"),
    ],
  );

  await createImplementationLoopTickHandler({
    listRepos: async () =>
      (await settings().onboardedRepos()).map((r) => r.full_name),
    rawSettings: (repo) => settings().rawSettings(repo),
    findOpenBySubject: (repo, key) =>
      pipeline().assemblyRuns.findOpenBySubject(repo, key),
    activeTaskByIssue: (repo, issueNumber) =>
      pipeline().taskQueue.activeTaskByIssue(repo, issueNumber),
    listIssues: async (repo) =>
      (await projectFor(repo)).issues.list({ state: "open" }),
    createTask: (input) => taskStore().create(input),
    setTaskColumns: (taskId, columns) =>
      pipeline().taskQueue.setColumns(taskId, columns),
    // Passed straight through — decideBranchResume reads undefined as "unknown" and starts fresh.
    branchExists: async (repo, branch) =>
      (await projectFor(repo)).repo.branchExists(branch),
    openPrForBranch: async (repo, branch) => {
      const open = await (await projectFor(repo)).pulls.list();
      const forBranch = open.find((pr) => pr.branch === branch);

      return forBranch
        ? { number: forBranch.number, url: forBranch.url }
        : null;
    },
  })(params);
};

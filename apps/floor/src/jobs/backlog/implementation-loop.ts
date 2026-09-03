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

/** The loop driver's data slice — narrow so the tick is testable without the
 *  kernel (specs/implementation-loop FR2). */
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
  /** `undefined` when the port cannot answer — the shared port declares
   *  `branchExists` optional, and unknown must never read as "no branch". */
  branchExists(repo: string, branch: string): Promise<boolean | undefined>;
  openPrForBranch(
    repo: string,
    branch: string,
  ): Promise<{ number: number; url: string } | null>;
}

/**
 * One tick of the self-re-arming backlog loop (FR2): per enabled repo, pick
 * the highest-priority eligible issue and mint one `implementation-loop` task.
 * The standard machinery does the rest — the worker claims it, the assembly
 * line runs, the watcher opens the PR. Serialisation is the subject key: an
 * open run holding the repo's backlog subject skips the repo, and the picked
 * issue's task guard covers the rest: activeTaskByIssue counts every task not
 * failed/cancelled, so it spans the mint-to-run gap AND keeps an addressed
 * ticket — completed, PR open, awaiting a human merge — from being re-picked,
 * which is FR1's "no open Lore-authored PR already referencing it" clause in
 * practice. (A cross-issue race past both guards start-or-JOINs on the unique
 * `(repo, subject_key)` index and settles as a joined task.) An empty backlog
 * does nothing and leaves nothing behind. One broken repo never stops the
 * sweep.
 */
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

async function tickRepo(repo: string, deps: LoopTickDeps): Promise<void> {
  if (!implementationLoopEnabled(await deps.rawSettings(repo))) {
    return;
  }

  if (await deps.findOpenBySubject(repo, backlogSubject())) {
    return;
  }
  // Walk the queue in pick order, past tickets an earlier task still guards —
  // completed-awaiting-merge, mostly. Returning on the guarded HEAD froze the
  // whole backlog behind one unmerged PR twice (27h on 2026-08-30, overnight on
  // 2026-09-02), and the repo tab already promises the skip: its next-up list
  // filters guarded tickets out, so the first ticket it shows must be the one
  // this picks. Serial execution is not this gate's job — the open-run subject
  // check above is what holds the loop to one run at a time.
  const ordered = orderBacklog(await deps.listIssues(repo));
  const guarded: number[] = [];
  let picked: (typeof ordered)[number] | null = null;

  for (const candidate of ordered) {
    if (await deps.activeTaskByIssue(repo, candidate.number)) {
      guarded.push(candidate.number);
      continue;
    }
    picked = candidate;
    break;
  }

  // An empty backlog is a normal state and stays quiet; a backlog that EXISTS
  // but cannot be picked is the state that ate a morning of diagnosis when it
  // was silent — the loop must say what it is waiting for.
  if (!picked && guarded.length > 0) {
    console.log(
      `[implementation-loop] ${repo}: no pick — ${guarded.length} eligible ticket(s), all awaiting an earlier task (${guarded.map((n) => `#${n}`).join(", ")})`,
    );

    return;
  }

  if (!picked) {
    return;
  }
  const branch = implementationLoopBranch(picked.number);
  // Continuing a branch is silent by design: no issue comment, no PR comment. It
  // is recorded on the run's args instead, so the run page can say it and GitHub
  // stays quiet. Deleting the branch is the owner's restart lever.
  // Both reads hit GitHub and neither feeds the other, so they go together.
  const [branchExists, openPr] = await Promise.all([
    deps.branchExists(repo, branch),
    deps.openPrForBranch(repo, branch),
  ]);
  const resume = decideBranchResume({
    branchExists,
    issueLabels: picked.labels ?? [],
    openPr,
  });

  const task = await deps.createTask({
    description: implementationTicketDescription(picked),
    taskType: "implementation-loop",
    targetRepo: repo,
    createdBy: "implementation-loop",
    contextBundle: {
      github_issue_number: picked.number,
      ...(picked.url ? { github_issue_url: picked.url } : {}),
      branch,
      // The LINE declares it wants a draft PR; the Floor's decidePrDraft only
      // reads the flag, so it never learns which blueprints want one. A draft
      // gets no Lore code review, which is what stops twelve round-pushes
      // triggering twelve reviews.
      line_args: {
        pr_draft: true,
        // Rides onto the run's args so the PR footer can close the ticket on
        // merge. A `Refs #N` only links it; the issue stayed open and eligible
        // to be picked again on the next tick.
        issue_number: picked.number,
        ...(resume.resume ? resume.lineArgs : {}),
      },
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
    // `branchExists` is optional on the GitHub port, so the facade returns
    // undefined when the adapter cannot answer. Passed straight through —
    // decideBranchResume reads undefined as "unknown" and starts fresh.
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

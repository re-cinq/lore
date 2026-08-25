import type { IssueRef } from "@re-cinq/lore-shared";
import { selectNextIssue } from "@re-cinq/lore-shared";
import { backlogSubject } from "@re-cinq/lore-shared/project/assembly-runs/subject-keys.js";
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
  const picked = selectNextIssue(await deps.listIssues(repo));

  if (!picked) {
    return;
  }

  if (await deps.activeTaskByIssue(repo, picked.number)) {
    return;
  }
  const task = await deps.createTask({
    description: picked.title,
    taskType: "implementation-loop",
    targetRepo: repo,
    createdBy: "implementation-loop",
    contextBundle: {
      github_issue_number: picked.number,
      ...(picked.url ? { github_issue_url: picked.url } : {}),
    },
  });

  await deps.setTaskColumns(task.task_id, {
    issue_number: picked.number,
    ...(picked.url ? { issue_url: picked.url } : {}),
  });
  console.log(
    `[implementation-loop] ${repo}: picked #${picked.number} as task ${task.task_id}`,
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
  })(params);
};

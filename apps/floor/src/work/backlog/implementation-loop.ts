// Lore's own Floor as the driver of the implementation loop (specs/implementation-loop FR2): the tick's ports bound to this process. Where an external floor is configured the stations service runs the tick instead and this handler stands down, so one engine picks a repository's next ticket, never both.
import type { Project } from "@re-cinq/lore-shared";
import {
  createImplementationLoopTickHandler,
  type LoopTickDeps,
} from "@re-cinq/lore-shared/backlog/implementation-loop-tick.js";
import { floorConfigured } from "@re-cinq/lore-shared/floor/floor-client.js";
import type { EventHandler } from "../../domain/event-types.js";

type LoopQueues = typeof import("../../outbound/queues.js");

function tickDeps(
  queues: LoopQueues,
  projectFor: (repo: string) => Promise<Project>,
): LoopTickDeps {
  const { pipeline, settings, taskStore } = queues;

  return {
    listRepos: () => settings().allRepos(),
    rawSettings: (repo) => settings().rawSettings(repo),
    isOnboarded: (repo) => settings().isOnboarded(repo),
    findOpenBySubject: (repo, key) =>
      pipeline().assemblyRuns.findOpenBySubject(repo, key),
    activeTaskByIssue: (repo, issueNumber) =>
      pipeline().taskQueue.activeTaskByIssue(repo, issueNumber),
    createTask: (input) => taskStore().create(input),
    setTaskColumns: (taskId, columns) =>
      pipeline().taskQueue.setColumns(taskId, columns),
    ...repoPorts(projectFor),
    // The worker claims the pending task; nothing to start here.
    started: () => Promise.resolve(),
  };
}

/** What the tick reads from GitHub. `branchExists` is passed straight through: `decideBranchResume` reads an undefined answer as "unknown" and starts fresh, which is the safe direction — resuming a branch that is not there produces an empty PR. */
function repoPorts(projectFor: (repo: string) => Promise<Project>) {
  return {
    listIssues: async (repo: string) =>
      (await projectFor(repo)).issues.list({ state: "open" }),
    branchExists: async (repo: string, branch: string) =>
      (await projectFor(repo)).repo.branchExists(branch),
    openBlockers: async (repo: string, issueNumber: number) =>
      (await projectFor(repo)).issues.openBlockers(issueNumber),
    openPrForBranch: async (repo: string, branch: string) => {
      const open = await (await projectFor(repo)).pulls.list();
      const forBranch = open.find((pr) => pr.branch === branch);

      return forBranch
        ? { number: forBranch.number, url: forBranch.url }
        : null;
    },
  };
}

/** Production wiring for the `cron.implementation_loop.tick` handler. */
export const implementationLoopTick: EventHandler = async (params) => {
  if (floorConfigured()) {
    return;
  }
  const [queues, { projectFor }] = await Promise.all([
    import("../../outbound/queues.js"),
    import("../../outbound/project-boot.js"),
  ]);
  const handler = createImplementationLoopTickHandler(
    tickDeps(queues, projectFor),
  );

  await handler(params);
};

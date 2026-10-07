// The ports of the loop's driver that are the same whichever process runs it: Lore's own Floor and the stations service bind these once, and add only what differs between them (how a run is found open, and how a ticket is started).
import type { Project } from "../../outbound/project/index.js";
import type { LoopTickDeps } from "./implementation-loop-tick.js";
import type { LoopRunClosedDeps } from "./loop-run-closed.js";

type ProjectOf = (
  repo: string,
) => Promise<Pick<Project, "issues" | "repo" | "pulls">>;

export interface TickSources {
  settings: {
    allRepos: LoopTickDeps["listRepos"];
    rawSettings: LoopTickDeps["rawSettings"];
    isOnboarded: LoopTickDeps["isOnboarded"];
  };
  taskQueue: {
    activeTaskByIssue: LoopTickDeps["activeTaskByIssue"];
    setColumns: LoopTickDeps["setTaskColumns"];
  };
  tasks: { create: LoopTickDeps["createTask"] };
  projectOf: ProjectOf;
}

export function tickPortsOf({
  settings,
  taskQueue,
  tasks,
  projectOf,
}: TickSources): Omit<LoopTickDeps, "findOpenBySubject" | "started"> {
  return {
    listRepos: () => settings.allRepos(),
    rawSettings: (repo) => settings.rawSettings(repo),
    isOnboarded: (repo) => settings.isOnboarded(repo),
    activeTaskByIssue: (repo, issueNumber) =>
      taskQueue.activeTaskByIssue(repo, issueNumber),
    createTask: (input) => tasks.create(input),
    setTaskColumns: (taskId, columns) => taskQueue.setColumns(taskId, columns),
    ...repoPortsOf(projectOf),
  };
}

/** What the tick reads from GitHub. `branchExists` is passed straight through: `decideBranchResume` reads an undefined answer as "unknown" and starts fresh, which is the safe direction — resuming a branch that is not there produces an empty PR. */
function repoPortsOf(
  projectOf: ProjectOf,
): Pick<
  LoopTickDeps,
  "listIssues" | "branchExists" | "openBlockers" | "openPrForBranch"
> {
  return {
    listIssues: async (repo) =>
      (await projectOf(repo)).issues.list({ state: "open" }),
    branchExists: async (repo, branch) =>
      (await projectOf(repo)).repo.branchExists(branch),
    openBlockers: async (repo, issueNumber) =>
      (await projectOf(repo)).issues.openBlockers(issueNumber),
    openPrForBranch: async (repo, branch) =>
      openPrOn(await projectOf(repo), branch),
  };
}

async function openPrOn(
  project: Pick<Project, "pulls">,
  branch: string,
): Promise<{ number: number; url: string } | null> {
  const open = await project.pulls.list();
  const forBranch = open.find((pr) => pr.branch === branch);

  return forBranch ? { number: forBranch.number, url: forBranch.url } : null;
}

/** What settling a ticket writes to GitHub. */
export function ticketPortsOf(
  projectOf: ProjectOf,
): Pick<LoopRunClosedDeps, "addLabel" | "comment" | "closeIssue" | "closePr"> {
  return {
    addLabel: async (repo, issueNumber, label) =>
      (await projectOf(repo)).issues.addLabel(issueNumber, label),
    comment: async (repo, issueNumber, body) =>
      (await projectOf(repo)).issues.comment(issueNumber, body),
    closeIssue: async (repo, issueNumber) =>
      (await projectOf(repo)).issues.close(issueNumber, "completed"),
    closePr: async (repo, prNumber) =>
      (await projectOf(repo)).pulls.close(prNumber),
  };
}

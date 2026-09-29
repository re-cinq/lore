import { describe, it, expect } from "vitest";
import type { ReadySpecTask } from "@re-cinq/lore-shared/project/tasks/task-queue-port.js";
import { startSpecTaskAgent } from "./spec-task-executor.js";

const T001 = {
  id: "5e7c01d7-9147-4c50-a922-0e553463fd42",
  description: "Add `issue-triage.yaml` stub with empty nodes and edges.",
  target_repo: "re-cinq/lore",
  task_group_id: "18773dbb-5972-43f1-8a2a-5db8831bcc5a",
  context_bundle: {
    spec_slug: "issue-triage",
    spec_task_id: "T001",
    file_path: "libs/assembly-lines/src/assembly-lines/issue-triage.yaml",
  },
} as unknown as ReadySpecTask;

const BRANCH = "lore/spec-task/issue-triage-t001-5e7c01d7";

function fakeProject(existingBranches: string[] = []) {
  const steps: string[] = [];
  const runs: Array<{ taskId: string; opts: Record<string, unknown> }> = [];

  return {
    steps,
    runs,
    project: {
      repo: {
        branchExists: async (branch: string) =>
          existingBranches.includes(branch),
        createBranch: async (branch: string, base?: string) => {
          steps.push(`create ${branch} from ${base}`);
        },
        defaultBranch: async () => "main",
      },
      agentDefs: { resolve: async () => null },
      agents: {
        run: async (taskId: string, opts: Record<string, unknown>) => {
          steps.push(`run ${String(opts.branch)}`);
          runs.push({ taskId, opts });

          return { started: true };
        },
      },
    } as never,
  };
}

describe("startSpecTaskAgent", () => {
  it("creates T001's branch off main before running its agent on it", async () => {
    const fake = fakeProject();

    await startSpecTaskAgent(fake.project, T001);

    expect(fake.steps).toEqual([`create ${BRANCH} from main`, `run ${BRANCH}`]);
  });

  it("leaves an existing branch alone, so a re-dispatched task keeps its commits", async () => {
    const fake = fakeProject([BRANCH]);

    await startSpecTaskAgent(fake.project, T001);

    expect(fake.steps).toEqual([`run ${BRANCH}`]);
  });

  it("points the agent at the feature's spec-kit artifacts: spec.md, plan.md and tasks.md", async () => {
    const fake = fakeProject();

    await startSpecTaskAgent(fake.project, T001);

    expect(fake.runs[0]?.opts.description).toContain(
      "specs/issue-triage/spec.md, specs/issue-triage/plan.md and specs/issue-triage/tasks.md",
    );
  });
});

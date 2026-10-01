import { describe, it, expect } from "vitest";
import {
  PLAN_BLOB_HASH,
  recordedPlanFloor,
} from "../../outbound/floor/recorded-plan-floor.js";
import type { ReadySpecTask } from "../../outbound/project/tasks/task-queue-port.js";
import type { LiveIssue } from "./spec-task-brief.js";
import {
  runSpecTaskExecutor,
  type SpecTaskExecutorDeps,
} from "./spec-task-executor.js";

const YAML = "libs/assembly-lines/src/assembly-lines/issue-triage.yaml";

const T001 = {
  id: "5e7c01d7-9147-4c50-a922-0e553463fd42",
  description: "Add `issue-triage.yaml` stub with empty nodes and edges.",
  target_repo: "re-cinq/lore",
  task_group_id: "18773dbb-5972-43f1-8a2a-5db8831bcc5a",
  context_bundle: {
    spec_slug: "issue-triage",
    spec_task_id: "T001",
    file_path: YAML,
  },
} as unknown as ReadySpecTask;

const BRANCH = "lore/spec-task/issue-triage-t001-5e7c01d7";

function withBundle(extra: Record<string, unknown>): ReadySpecTask {
  return {
    ...T001,
    context_bundle: { ...T001.context_bundle, ...extra },
  } as unknown as ReadySpecTask;
}

interface Scene {
  ready?: ReadySpecTask[];
  liveIssues?: Record<number, LiveIssue>;
  overrides?: Partial<SpecTaskExecutorDeps>;
}

function scene({ ready = [T001], liveIssues = {}, overrides }: Scene = {}) {
  const recorded = recordedPlanFloor();
  const steps: string[] = [];
  const deps: SpecTaskExecutorDeps = {
    readyTasks: () => Promise.resolve(ready),
    runningTasks: () => Promise.resolve([]),
    creditsExhausted: async () => false,
    claim: async (taskId) => {
      steps.push(`claim ${taskId.substring(0, 8)}`);

      return true;
    },
    release: (taskId) => {
      steps.push(`release ${taskId.substring(0, 8)}`);

      return Promise.resolve();
    },
    liveIssue: (_repo, number) => Promise.resolve(liveIssues[number] ?? null),
    ensureBranch: (repo, branch) => {
      steps.push(`branch ${repo} ${branch}`);

      return Promise.resolve();
    },
    floor: recorded.floor,
    ...overrides,
  };
  const sent = (suffix: string) =>
    recorded.requests.filter(({ path }) => path.endsWith(suffix));

  return {
    deps,
    steps,
    started: () => sent("/start"),
    ticket: () => String(sent("/blobs").at(0)?.body),
  };
}

describe("runSpecTaskExecutor", () => {
  it("claims T001, makes its branch, then starts an implementation-loop run for it", async () => {
    const { deps, steps, started } = scene();

    const summary = await runSpecTaskExecutor(deps);

    expect(steps).toEqual(["claim 5e7c01d7", `branch re-cinq/lore ${BRANCH}`]);
    expect(started().map(({ path }) => path)).toEqual([
      "/assembly-lines/implementation-loop/start",
    ]);
    expect(summary).toBe("Started 1/1 ready spec-tasks");
  });

  it("keys T001's run on the task itself, on its branch, with the task issue #2261 as its ticket", async () => {
    const { deps, started } = scene({
      ready: [withBundle({ task_issue: 2261 })],
    });

    await runSpecTaskExecutor(deps);

    expect(started()[0].body).toEqual({
      repo: "github.com/re-cinq/lore",
      startItems: {
        repo: {
          kind: "git",
          ref: `github.com/re-cinq/lore@${BRANCH}`,
          by: "lore",
        },
        backlog: {
          kind: "value",
          ref: "spec-task-5e7c01d7-9147-4c50-a922-0e553463fd42",
          by: "lore",
        },
        task_id: {
          kind: "value",
          ref: "5e7c01d7-9147-4c50-a922-0e553463fd42",
          by: "lore",
        },
        ticket: { kind: "file", ref: PLAN_BLOB_HASH, by: "lore" },
        issue_title: {
          kind: "value",
          ref: "T001: Add `issue-triage.yaml` stub with empty nodes and edges.",
          by: "lore",
        },
        issue_number: { kind: "value", ref: "2261", by: "lore" },
      },
    });
  });

  it("starts a task that was never filed as an issue with a title and no issue number", async () => {
    const { deps, started } = scene();

    await runSpecTaskExecutor(deps);

    expect(
      Object.keys((started()[0].body as { startItems: object }).startItems),
    ).toEqual(["repo", "backlog", "task_id", "ticket", "issue_title"]);
  });

  it("points the agents at the feature's spec-kit artifacts: spec.md, plan.md and tasks.md", async () => {
    const { deps, ticket } = scene();

    await runSpecTaskExecutor(deps);

    expect(ticket()).toContain(
      "specs/issue-triage/spec.md, specs/issue-triage/plan.md and specs/issue-triage/tasks.md",
    );
  });

  it("briefs the agents with task issue #2261: the story it is part of, context, changes and acceptance criteria", async () => {
    const { deps, ticket } = scene({
      ready: [
        withBundle({
          story_issue: 2260,
          task_issue: 2261,
          title: "Add the issue-triage line stub",
          context: "Every later task fills this line in.",
          changes: "Create issue-triage.yaml with empty nodes and edges.",
          acceptance_criteria: ["the loader accepts the file"],
        }),
      ],
    });

    await runSpecTaskExecutor(deps);
    const description = ticket();

    expect({
      header: description.startsWith(
        "Implement spec-task T001 (issue #2261): Add the issue-triage line stub",
      ),
      story: description.includes("Part of #2260."),
      context: description.includes("Every later task fills this line in."),
      changes: description.includes(
        "Create issue-triage.yaml with empty nodes and edges.",
      ),
      criteria: description.includes("- [ ] the loader accepts the file"),
    }).toEqual({
      header: true,
      story: true,
      context: true,
      changes: true,
      criteria: true,
    });
  });

  it("titles T001's pull request after its task issue #2261 as it reads now", async () => {
    const { deps, started } = scene({
      ready: [withBundle({ task_issue: 2261 })],
      liveIssues: {
        2261: {
          title: "T001: Add the issue-triage line stub",
          body: "Part of #2260.",
        },
      },
    });

    await runSpecTaskExecutor(deps);

    expect(started()[0].body).toMatchObject({
      startItems: {
        issue_title: { ref: "T001: Add the issue-triage line stub" },
      },
    });
  });

  it("briefs the agents from task issue #2261 as it reads now, so a person's edit before the run reaches them", async () => {
    const { deps, ticket } = scene({
      ready: [
        withBundle({
          story_issue: 2260,
          task_issue: 2261,
          changes: "The detail as filed.",
        }),
      ],
      liveIssues: {
        2261: {
          title: "T001: Add the issue-triage line stub and its README",
          body: "Part of #2260.\n\n**Depends on:** #2259\n\n## What to change\n\nEdited by a maintainer: also update the README.",
        },
      },
    });

    await runSpecTaskExecutor(deps);
    const description = ticket();

    expect({
      header: description.startsWith(
        "Implement spec-task T001 (issue #2261): Add the issue-triage line stub and its README\n",
      ),
      edited: description.includes(
        "Edited by a maintainer: also update the README.",
      ),
      dependsOn: description.includes("**Depends on:** #2259"),
      staleCopy: description.includes("The detail as filed."),
    }).toEqual({
      header: true,
      edited: true,
      dependsOn: true,
      staleCopy: false,
    });
  });

  it("briefs from the filed detail when GitHub cannot be read", async () => {
    const { deps, ticket } = scene({
      ready: [
        withBundle({ task_issue: 2261, changes: "The detail as filed." }),
      ],
      overrides: { liveIssue: () => Promise.reject(new Error("GitHub 502")) },
    });

    await runSpecTaskExecutor(deps);

    expect(ticket()).toContain("The detail as filed.");
  });

  it("releases T001 back to pending when its branch cannot be made, and starts nothing", async () => {
    const { deps, steps, started } = scene({
      overrides: {
        ensureBranch: () => Promise.reject(new Error("GitHub 502")),
      },
    });

    const summary = await runSpecTaskExecutor(deps);

    expect(steps).toEqual(["claim 5e7c01d7", "release 5e7c01d7"]);
    expect(started()).toEqual([]);
    expect(summary).toBe("No ready spec-tasks");
  });

  it("starts nothing for a task another dispatcher claimed first", async () => {
    const { deps, started } = scene({
      overrides: { claim: async () => false },
    });

    await runSpecTaskExecutor(deps);

    expect(started()).toEqual([]);
  });

  it("starts nothing while the Anthropic account is out of credits", async () => {
    const { deps, steps } = scene({
      overrides: { creditsExhausted: async () => true },
    });

    expect(await runSpecTaskExecutor(deps)).toBe(
      "Skipped: API credits exhausted",
    );
    expect(steps).toEqual([]);
  });

  it("starts one of T001 and T002 when both edit issue-triage.yaml", async () => {
    const t002 = {
      ...withBundle({ spec_task_id: "T002" }),
      id: "b3b5b157-ef37-4bce-b9fe-d64426f26c7f",
    } as ReadySpecTask;
    const { deps, steps } = scene({ ready: [T001, t002] });

    const summary = await runSpecTaskExecutor(deps);

    expect(steps).toEqual(["claim 5e7c01d7", `branch re-cinq/lore ${BRANCH}`]);
    expect(summary).toBe("Started 1/2 ready spec-tasks");
  });

  it("answers that nothing is ready when no spec-task is", async () => {
    const { deps } = scene({ ready: [] });

    expect(await runSpecTaskExecutor(deps)).toBe("No ready spec-tasks");
  });
});

import { describe, it, expect } from "vitest";
import type {
  AssemblyRunRecord,
  StationRunRecord,
} from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import type { PipelineTask } from "@re-cinq/lore-shared";
import { failureContext, type FailureContextDeps } from "./failure-context.js";

function lineRow(
  overrides: Partial<AssemblyRunRecord> = {},
): AssemblyRunRecord {
  return {
    id: "al-1",
    graph: null,
    blueprintName: "implementation",
    taskId: "task-1",
    repo: "re-cinq/lore",
    branch: "fix/thing",
    subjectKey: null,
    args: {},
    status: "failed",
    outcome: "error",
    reason: null,
    blueprintHash: null,
    resumedFromRunId: null,
    resumedFromNodeId: null,
    inheritedNodeCount: 0,
    createdAt: new Date("2026-07-17T06:20:00Z"),
    startedAt: new Date("2026-07-17T06:20:01Z"),
    finishedAt: null,
    ...overrides,
  };
}

function visit(
  nodeId: string,
  outcome: string | null,
  failure: Partial<StationRunRecord> = {},
): StationRunRecord {
  return {
    nodeId,
    outcome,
    failureClass: null,
    failureDetail: null,
    ...failure,
  } as StationRunRecord;
}

function task(overrides: Partial<PipelineTask> = {}): PipelineTask {
  return {
    id: "task-1",
    created_by: "octo-fixture",
    ...overrides,
  } as PipelineTask;
}

function deps(overrides: Partial<FailureContextDeps> = {}): FailureContextDeps {
  return {
    stationRuns: async () => [],
    taskById: async () => null,
    slackNameOf: async () => null,
    ...overrides,
  };
}

describe("failureContext", () => {
  it("takes the last failed visit as the failing node", async () => {
    const context = await failureContext(
      lineRow(),
      deps({
        stationRuns: async () => [
          visit("implement", "failed", { failureClass: "infra" }),
          visit("implement", "success"),
          visit("validate", "failed", { failureDetail: "lint failed" }),
        ],
      }),
    );

    expect(context.failedNode).toEqual({
      nodeId: "validate",
      failureClass: null,
      failureDetail: "lint failed",
    });
  });

  it("returns no failing node when no visit failed", async () => {
    const context = await failureContext(
      lineRow(),
      deps({ stationRuns: async () => [visit("review", "success")] }),
    );

    expect(context.failedNode).toBeNull();
  });

  it("names the run's actor by Slack name", async () => {
    const context = await failureContext(
      lineRow({ args: { actor: "octo-fixture" } }),
      deps({
        slackNameOf: async (_repo, login) =>
          login === "octo-fixture" ? "Ada Fixture" : null,
      }),
    );

    expect(context.owner).toBe("Ada Fixture");
  });

  it("keeps the GitHub login when Slack does not know it", async () => {
    const context = await failureContext(
      lineRow({ args: { actor: "octo-fixture" } }),
      deps(),
    );

    expect(context.owner).toBe("octo-fixture");
  });

  it("falls back to the task's creator when the run has no actor", async () => {
    const context = await failureContext(
      lineRow(),
      deps({ taskById: async () => task({ created_by: "octo-fixture" }) }),
    );

    expect(context.owner).toBe("octo-fixture");
  });

  it("uses the Slack user name a Slack-created task recorded", async () => {
    const context = await failureContext(
      lineRow(),
      deps({ taskById: async () => task({ created_by: "slack:ada.fixture" }) }),
    );

    expect(context.owner).toBe("ada.fixture");
  });

  it("carries the task's PR and issue links", async () => {
    const context = await failureContext(
      lineRow(),
      deps({
        taskById: async () =>
          task({
            pr_url: "https://github.com/re-cinq/lore/pull/901",
            issue_url: "https://github.com/re-cinq/lore/issues/900",
          }),
      }),
    );

    expect(context).toMatchObject({
      prUrl: "https://github.com/re-cinq/lore/pull/901",
      issueUrl: "https://github.com/re-cinq/lore/issues/900",
    });
  });

  it("looks up no task for a run without one", async () => {
    const asked: string[] = [];

    const context = await failureContext(
      lineRow({ taskId: null }),
      deps({
        taskById: async (id) => {
          asked.push(id);

          return null;
        },
      }),
    );

    expect({ asked, context }).toEqual({
      asked: [],
      context: { failedNode: null, owner: null, prUrl: null, issueUrl: null },
    });
  });
});

import { describe, it, expect } from "vitest";
import type { Octokit } from "octokit";
import {
  dispatchWorkflow,
  enableWorkflow,
  workflowState,
} from "./platform-github-repo-config.js";

interface WorkflowParams {
  owner: string;
  repo: string;
  workflow_id: string;
  ref?: string;
}

function fakeOctokit(state: string | Error) {
  const calls: Array<{ op: string; params: WorkflowParams }> = [];
  const actions = {
    getWorkflow: async (params: WorkflowParams) => {
      calls.push({ op: "get", params });

      if (state instanceof Error) {throw state;}

      return { data: { state } };
    },
    enableWorkflow: async (params: WorkflowParams) => {
      calls.push({ op: "enable", params });
    },
    createWorkflowDispatch: async (params: WorkflowParams) => {
      calls.push({ op: "dispatch", params });
    },
  };

  return { ok: { rest: { actions } } as unknown as Octokit, calls };
}

function httpError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status });
}

describe("workflowState", () => {
  it("answers active for a workflow GitHub reports active", async () => {
    const { ok, calls } = fakeOctokit("active");

    expect(await workflowState(ok, "re-cinq/lore", "lore-ingest.yml")).toBe(
      "active",
    );
    expect(calls).toEqual([
      {
        op: "get",
        params: {
          owner: "re-cinq",
          repo: "lore",
          workflow_id: "lore-ingest.yml",
        },
      },
    ]);
  });

  it.each(["disabled_manually", "disabled_inactivity", "disabled_fork"])(
    "answers disabled for a workflow GitHub reports %s",
    async (state) => {
      const { ok } = fakeOctokit(state);

      expect(await workflowState(ok, "re-cinq/lore", "lore-ingest.yml")).toBe(
        "disabled",
      );
    },
  );

  it("answers missing when GitHub answers 404", async () => {
    const { ok } = fakeOctokit(httpError(404, "Not Found"));

    expect(await workflowState(ok, "re-cinq/lore", "lore-ingest.yml")).toBe(
      "missing",
    );
  });

  it("propagates a 500 from GitHub", async () => {
    const { ok } = fakeOctokit(httpError(500, "boom"));

    await expect(
      workflowState(ok, "re-cinq/lore", "lore-ingest.yml"),
    ).rejects.toThrow("boom");
  });
});

describe("enableWorkflow", () => {
  it("enables the workflow by file name", async () => {
    const { ok, calls } = fakeOctokit("active");

    await enableWorkflow(ok, "re-cinq/lore", "lore-ingest.yml");

    expect(calls).toEqual([
      {
        op: "enable",
        params: {
          owner: "re-cinq",
          repo: "lore",
          workflow_id: "lore-ingest.yml",
        },
      },
    ]);
  });
});

describe("dispatchWorkflow", () => {
  it("dispatches the workflow on the given ref", async () => {
    const { ok, calls } = fakeOctokit("active");

    await dispatchWorkflow(ok, "re-cinq/lore", "lore-ingest.yml", "main");

    expect(calls).toEqual([
      {
        op: "dispatch",
        params: {
          owner: "re-cinq",
          repo: "lore",
          workflow_id: "lore-ingest.yml",
          ref: "main",
        },
      },
    ]);
  });
});

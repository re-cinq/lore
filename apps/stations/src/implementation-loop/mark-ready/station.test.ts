import { describe, expect, it } from "vitest";
import type { Tools } from "@re-cinq/floor-station";
import { markReadyHandle, type MarkReadyPulls } from "./station.js";

const PR_URL = "https://github.com/re-cinq/app/pull/42";

function tools(prBody: string): Tools {
  return {
    read: () => Promise.resolve(Buffer.from(prBody)),
    produce: () => Promise.resolve(),
    modelCall: () => Promise.resolve(),
    signal: new AbortController().signal,
  };
}

function brief(needs: Record<string, string> = {}) {
  return {
    visitId: "visit-mark-ready",
    iteration: 1,
    needs: { pr_url: PR_URL, task_id: "task-1", ...needs },
  };
}

function scene(overrides: Partial<MarkReadyPulls> = {}) {
  const steps: unknown[] = [];
  const pulls: MarkReadyPulls = {
    update: (number, fields) => {
      steps.push({ update: number, ...fields });

      return Promise.resolve();
    },
    markReady: (number) => {
      steps.push({ ready: number });

      return Promise.resolve();
    },
    ...overrides,
  };

  return {
    handle: markReadyHandle({ pulls: () => Promise.resolve(pulls) }),
    steps,
  };
}

const WRITTEN = {
  pr_body: "blob-body",
  pr_title: "Export the report as CSV",
  issue_number: "77",
  issue_coverage: "full",
};

describe("the loop-mark-ready station", () => {
  it("rewrites pull request 42 with the agent's title and description and the Closes footer, then takes it out of draft", async () => {
    const { handle, steps } = scene();

    await handle(brief(WRITTEN), tools("What changed and why.\n"));

    expect(steps).toEqual([
      {
        update: 42,
        title: "Export the report as CSV",
        body: "What changed and why.\n\nCloses #77\nLore-Task: task-1",
      },
      { ready: 42 },
    ]);
  });

  it("writes Refs instead of Closes when the agent reported partial coverage of the issue", async () => {
    const { handle, steps } = scene();

    await handle(
      brief({ ...WRITTEN, issue_coverage: "partial" }),
      tools("Half of it."),
    );

    expect(steps[0]).toMatchObject({
      body: "Half of it.\n\nRefs #77\nLore-Task: task-1",
    });
  });

  it("keeps the pull request's title and body and only takes it out of draft when the agent wrote neither", async () => {
    const { handle, steps } = scene();

    expect(await handle(brief(), tools(""))).toEqual({ outcome: "success" });
    expect(steps).toEqual([{ ready: 42 }]);
  });

  it("reports failed with the error when the pull request cannot be marked ready", async () => {
    const { handle } = scene({
      markReady: () => Promise.reject(new Error("GraphQL: not found")),
    });

    expect(await handle(brief(), tools(""))).toEqual({
      outcome: "failed",
      error: "GraphQL: not found",
    });
  });
});

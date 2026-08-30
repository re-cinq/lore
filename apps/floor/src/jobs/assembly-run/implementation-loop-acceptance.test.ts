// Acceptance: the REAL implementation-loop blueprint walked through the real
// handlers, with the REAL terminal hook (handleLoopRunClosed) behind the
// onRunClosed seam — the composition implementation-loop-line.test.ts (pure
// replay) cannot see. The loop is deliberately not a back-edge: re-arm is a
// driver behavior on the run's terminal state (specs/implementation-loop FR2),
// so it only exists at this tier.

import { describe, it, expect } from "vitest";
import { handleLoopRunClosed } from "../backlog/loop-run-closed.js";
import { createLineHarness } from "./line-acceptance-harness.js";

const short = (id: string) => id.substring(0, 12);

function loopHarness() {
  const labeled: Array<{ issue: number; label: string }> = [];
  const comments: Array<{ issue: number; body: string }> = [];
  const ticks: string[] = [];
  const h = createLineHarness({
    onRunClosed: (run, outcome, reason) =>
      handleLoopRunClosed(run, outcome, reason, {
        getTaskIssueNumber: async () => 77,
        listStationRuns: (runId) => h.runs.listStationRuns(runId),
        addLabel: async (_repo, issue, label) => {
          labeled.push({ issue, label });
        },
        comment: async (_repo, issue, body) => {
          comments.push({ issue, body });
        },
        emitTick: async (repo) => {
          ticks.push(repo);
        },
      }),
  });

  return { ...h, labeled, comments, ticks };
}

async function parkedOnPr(h: ReturnType<typeof loopHarness>) {
  const id = await h.start("implementation-loop", { taskId: "task-1" });

  await h.completeAgentNode(id, "implement", { outcome: "success" });
  await h.completeAgentNode(id, "validate", { outcome: "success" });
  await h.completeAgentNode(id, "push", { outcome: "success" });

  return id;
}

async function retrospectiveReported(
  h: ReturnType<typeof loopHarness>,
  id: string,
) {
  expect(h.published.at(-1)?.params).toMatchObject({
    assemblyLineId: id,
    nodeId: "retrospective",
  });
  await h.resume(id, "retrospective", "success");
}

describe("implementation-loop acceptance: one ticket, cluster-free", () => {
  it("walks implement, validate, push and parks on the PR with no CR dispatched for it", async () => {
    const h = loopHarness();
    const id = await parkedOnPr(h);

    expect(h.enqueued.map((s) => s.name)).toEqual([
      `${short(id)}-implement`,
      `${short(id)}-validate`,
      `${short(id)}-push`,
    ]);
    expect(h.visits()).toEqual([
      ["implement", "success"],
      ["validate", "success"],
      ["push", "success"],
      ["await-pr", null],
    ]);
  });

  it("completes the run and re-arms the repo tick when the PR reports green", async () => {
    const h = loopHarness();
    const id = await parkedOnPr(h);

    await h.resume(id, "await-pr", "success");
    await retrospectiveReported(h, id);

    expect(await h.runs.getById(id)).toMatchObject({
      status: "finished",
      outcome: "completed",
    });
    expect(h.ticks).toEqual(["re-cinq/lore"]);
    expect(h.labeled).toEqual([]);
  });

  it("marks the ticket blocked and still re-arms when the PR stays not-ready", async () => {
    const h = loopHarness();
    const id = await parkedOnPr(h);

    await h.resume(id, "await-pr", "changes_requested");
    await retrospectiveReported(h, id);

    expect(h.labeled).toEqual([{ issue: 77, label: "lore:blocked" }]);
    expect(h.comments).toEqual([
      { issue: 77, body: expect.stringContaining("parking this ticket") },
    ]);
    expect(h.ticks).toEqual(["re-cinq/lore"]);
  });

  it("retries implement once, fails the run on the second failure, and blocks the ticket", async () => {
    const h = loopHarness();
    const id = await h.start("implementation-loop", { taskId: "task-1" });

    await h.completeAgentNode(id, "implement", {
      outcome: "failed",
      phase: "Failed",
    });
    await h.completeAgentNode(id, "implement", {
      outcome: "failed",
      phase: "Failed",
      iteration: 2,
    });

    expect(h.enqueued.map((s) => s.name)).toEqual([
      `${short(id)}-implement`,
      `${short(id)}-implement-2`,
    ]);
    expect((await h.runs.getById(id))?.outcome).toBe("iteration_max");
    expect(h.labeled).toEqual([{ issue: 77, label: "lore:blocked" }]);
    expect(h.ticks).toEqual(["re-cinq/lore"]);
  });
});

describe("implementation-loop acceptance: a boot crash is not worth a retry", () => {
  // Run 129235d4 (2026-08-28) cost two 25-minute implement attempts and ended
  // `iteration_max`, because the engine died before printing a result line and
  // the only string the classifier saw was the Job's BackoffLimitExceeded —
  // `infra`, which is retryable. The pod had said exactly what was wrong.
  const bootCrash = [
    '{"kind":"lifecycle","phase":"agent","status":"started"}',
    "[agent] Error: Settings file not found: /agent/.claude/settings.json",
    '{"kind":"lifecycle","exitCode":1,"phase":"agent","status":"failed"}',
  ].join("\n");

  it("fails the run on the first attempt and names the misconfiguration", async () => {
    const h = loopHarness();
    const id = await h.start("implementation-loop", { taskId: "task-1" });

    await h.completeAgentNode(id, "implement", {
      output: bootCrash,
      phase: "Failed",
    });

    expect(h.enqueued.map((s) => s.name)).toEqual([`${short(id)}-implement`]);
    expect(await h.runs.getById(id)).toMatchObject({
      status: "failed",
      outcome: "error",
      reason: expect.stringContaining("Settings file not found"),
    });
    expect(h.labeled).toEqual([{ issue: 77, label: "lore:blocked" }]);
  });
});

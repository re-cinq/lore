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

  await h.completeAgentNode(id, "dod", { outcome: "success" });
  await h.completeAgentNode(id, "open-pr", { outcome: "success" });
  await h.completeAgentNode(id, "tdd-round", { outcome: "success" });
  await h.completeAgentNode(id, "ready-for-review", { outcome: "success" });

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

describe("implementation-loop acceptance: one ticket, cluster-free, walked through the REAL blueprint and terminal hook (handleLoopRunClosed) that implementation-loop-line.test.ts's pure replay cannot see; the loop is deliberately not a back-edge (re-arm is a driver behavior, specs/implementation-loop FR2)", () => {
  it("walks the ticket to the PR and parks there with no CR dispatched for the wait", async () => {
    const h = loopHarness();
    const id = await parkedOnPr(h);

    expect(h.enqueued.map((s) => s.name)).toEqual([
      `${short(id)}-dod`,
      `${short(id)}-open-pr`,
      `${short(id)}-tdd-round`,
      `${short(id)}-ready-for-review`,
    ]);
    expect(h.visits()).toEqual([
      ["dod", "success"],
      ["open-pr", "success"],
      ["tdd-round", "success"],
      ["ready-for-review", "success"],
      ["await-pr", null],
    ]);
  });

  it("loops a round that reports work remaining, then leaves on success, numbering the review node past the run's highest recorded iteration rather than at 1", async () => {
    const h = loopHarness();
    const id = await h.start("implementation-loop", { taskId: "task-1" });

    await h.completeAgentNode(id, "dod", { outcome: "success" });
    await h.completeAgentNode(id, "open-pr", { outcome: "success" });
    await h.completeAgentNode(id, "tdd-round", {
      outcome: "changes_requested",
    });
    await h.completeAgentNode(id, "tdd-round", {
      outcome: "changes_requested",
      iteration: 2,
    });
    await h.completeAgentNode(id, "tdd-round", {
      outcome: "success",
      iteration: 3,
    });

    expect(h.enqueued.map((s) => s.name)).toEqual([
      `${short(id)}-dod`,
      `${short(id)}-open-pr`,
      `${short(id)}-tdd-round`,
      `${short(id)}-tdd-round-2`,
      `${short(id)}-tdd-round-3`,
      `${short(id)}-ready-for-review-3`,
    ]);
  });

  it("sends a red build to fix-ci and back to the wait, without blocking the ticket", async () => {
    const h = loopHarness();
    const id = await parkedOnPr(h);

    await h.resume(id, "await-pr", "changes_requested", {
      args: { reason: "ci_red" },
    });
    await h.completeAgentNode(id, "fix-ci", { outcome: "success" });

    expect(h.visits().at(-1)).toEqual(["await-pr", null]);
    expect(h.labeled).toEqual([]);
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

  it("marks the ticket blocked and still re-arms when review threads stay unresolved", async () => {
    const h = loopHarness();
    const id = await parkedOnPr(h);

    await h.resume(id, "await-pr", "failed", {
      args: { reason: "unresolved_threads" },
    });
    await retrospectiveReported(h, id);

    expect(h.labeled).toEqual([{ issue: 77, label: "lore:blocked" }]);
    expect(h.comments).toEqual([
      { issue: 77, body: expect.stringContaining("parking this ticket") },
    ]);
    expect(h.ticks).toEqual(["re-cinq/lore"]);
  });

  it("retries the definition of done once, then fails the run and blocks the ticket", async () => {
    const h = loopHarness();
    const id = await h.start("implementation-loop", { taskId: "task-1" });

    await h.completeAgentNode(id, "dod", {
      outcome: "failed",
      phase: "Failed",
    });
    await h.completeAgentNode(id, "dod", {
      outcome: "failed",
      phase: "Failed",
      iteration: 2,
    });

    expect(h.enqueued.map((s) => s.name)).toEqual([
      `${short(id)}-dod`,
      `${short(id)}-dod-2`,
    ]);
    expect((await h.runs.getById(id))?.outcome).toBe("iteration_max");
    expect(h.labeled).toEqual([{ issue: 77, label: "lore:blocked" }]);
    expect(h.ticks).toEqual(["re-cinq/lore"]);
  });
});

describe("implementation-loop acceptance: a boot crash is not worth a retry (run 129235d4, 2026-08-28, cost two 25-minute attempts on the retryable `infra` misclassification before this fix)", () => {
  const bootCrash = [
    '{"kind":"lifecycle","phase":"agent","status":"started"}',
    "[agent] Error: Settings file not found: /agent/.claude/settings.json",
    '{"kind":"lifecycle","exitCode":1,"phase":"agent","status":"failed"}',
  ].join("\n");

  it("fails the run on the first attempt and names the misconfiguration", async () => {
    const h = loopHarness();
    const id = await h.start("implementation-loop", { taskId: "task-1" });

    await h.completeAgentNode(id, "dod", {
      output: bootCrash,
      phase: "Failed",
    });

    expect(h.enqueued.map((s) => s.name)).toEqual([`${short(id)}-dod`]);
    expect(await h.runs.getById(id)).toMatchObject({
      status: "failed",
      outcome: "error",
      reason: expect.stringContaining("Settings file not found"),
    });
    expect(h.labeled).toEqual([{ issue: 77, label: "lore:blocked" }]);
  });
});

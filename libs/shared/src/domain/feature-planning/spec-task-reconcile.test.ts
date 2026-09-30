import { describe, it, expect } from "vitest";
import { planSpecTaskReconcile } from "./spec-task-reconcile.js";

const wanted = (specTaskId: string, issueNumber: number) => ({
  specTaskId,
  issueNumber,
});

describe("planSpecTaskReconcile", () => {
  it("re-queues failed T001 on its issue #2261, updates running T002 in place and creates T003 that has no spec-task yet", () => {
    expect(
      planSpecTaskReconcile(
        [
          { id: "a", status: "failed", issueNumber: 2261, specTaskId: "T001" },
          { id: "b", status: "running", issueNumber: 2262, specTaskId: "T002" },
        ],
        [wanted("T001", 2261), wanted("T002", 2262), wanted("T003", 2263)],
      ),
    ).toEqual({
      requeue: [{ id: "a", wanted: wanted("T001", 2261) }],
      update: [{ id: "b", wanted: wanted("T002", 2262) }],
      create: [wanted("T003", 2263)],
      cancel: [],
    });
  });

  it("reuses failed T001 filed before task issues existed, matching it by its task id", () => {
    expect(
      planSpecTaskReconcile(
        [
          {
            id: "old",
            status: "failed",
            issueNumber: null,
            specTaskId: "T001",
          },
        ],
        [wanted("T001", 2261)],
      ).requeue,
    ).toEqual([{ id: "old", wanted: wanted("T001", 2261) }]);
  });

  it("reuses failed T004 still on its first-attempt issue #2246, since that issue is none of the plan's current ones", () => {
    expect(
      planSpecTaskReconcile(
        [
          {
            id: "old",
            status: "failed",
            issueNumber: 2246,
            specTaskId: "T004",
          },
        ],
        [wanted("T004", 2262)],
      ).requeue,
    ).toEqual([{ id: "old", wanted: wanted("T004", 2262) }]);
  });

  it("never takes a row by task id when its issue belongs to another of the plan's current tasks", () => {
    const plan = planSpecTaskReconcile(
      [{ id: "t005", status: "failed", issueNumber: 2263, specTaskId: "T004" }],
      [wanted("T004", 2262), wanted("T005", 2263)],
    );

    expect({ requeue: plan.requeue, create: plan.create }).toEqual({
      requeue: [{ id: "t005", wanted: wanted("T005", 2263) }],
      create: [wanted("T004", 2262)],
    });
  });

  it("leaves merged T001 alone and files nothing for it", () => {
    expect(
      planSpecTaskReconcile(
        [{ id: "a", status: "merged", issueNumber: 2261, specTaskId: "T001" }],
        [wanted("T001", 2261)],
      ),
    ).toEqual({ requeue: [], update: [], create: [], cancel: [] });
  });

  it("cancels queued T008 the new decomposition dropped, before it starts", () => {
    expect(
      planSpecTaskReconcile(
        [
          {
            id: "queued",
            status: "queued",
            issueNumber: 2268,
            specTaskId: "T008",
          },
        ],
        [],
      ).cancel,
    ).toEqual(["queued"]);
  });

  it("cancels pending T009 the new decomposition dropped, and leaves running T010 to finish", () => {
    expect(
      planSpecTaskReconcile(
        [
          {
            id: "gone",
            status: "pending",
            issueNumber: 2269,
            specTaskId: "T009",
          },
          {
            id: "busy",
            status: "running",
            issueNumber: 2270,
            specTaskId: "T010",
          },
        ],
        [],
      ).cancel,
    ).toEqual(["gone"]);
  });
});

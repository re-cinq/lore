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

  it("leaves merged T001 alone and files nothing for it", () => {
    expect(
      planSpecTaskReconcile(
        [{ id: "a", status: "merged", issueNumber: 2261, specTaskId: "T001" }],
        [wanted("T001", 2261)],
      ),
    ).toEqual({ requeue: [], update: [], create: [], cancel: [] });
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

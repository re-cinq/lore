import { describe, it, expect } from "vitest";
import { PgSpecTaskRows } from "./spec-task-rows-pg.js";
import type { PgPool } from "../../memory-store.js";

type Query = { text: string; params?: unknown[] };

function fakePool(capture: Query[], rows: unknown[] = []): PgPool {
  return {
    query: async <T>(text: string, params?: unknown[]) => {
      capture.push({ text, params });

      return { rows: rows as T[] };
    },
  };
}

const noCreate = async () => ({});

describe("PgSpecTaskRows", () => {
  it("reads re-cinq/lore's spec-tasks of plan 3b3a67af or run 18773dbb, with each one's task id and issue", async () => {
    const capture: Query[] = [];
    const rows = new PgSpecTaskRows(
      fakePool(capture, [
        {
          id: "a",
          status: "failed",
          issue_number: null,
          spec_task_id: "T001",
          pr_number: 2271,
        },
      ]),
      noCreate,
    );

    const found = await rows.planSpecTasks("re-cinq/lore", {
      planId: "3b3a67af",
      groupId: "18773dbb-5972-43f1-8a2a-5db8831bcc5a",
    });

    expect({ found, params: capture[0]?.params }).toEqual({
      found: [
        {
          id: "a",
          status: "failed",
          issueNumber: null,
          specTaskId: "T001",
          prNumber: 2271,
        },
      ],
      params: [
        "re-cinq/lore",
        "3b3a67af",
        "18773dbb-5972-43f1-8a2a-5db8831bcc5a",
      ],
    });
  });

  it("rewrites spec-task a onto issue #2261 and puts it back to pending when re-queued", async () => {
    const capture: Query[] = [];
    const rows = new PgSpecTaskRows(fakePool(capture), noCreate);

    await rows.requeue("a", {
      description: "T001 again",
      issueNumber: 2261,
      issueUrl: "https://github.com/re-cinq/lore/issues/2261",
      taskGroupId: "18773dbb-5972-43f1-8a2a-5db8831bcc5a",
      contextBundle: { spec_task_id: "T001" },
    });

    expect({
      requeued: capture[0]?.text.includes("status = 'pending'"),
      params: capture[0]?.params,
    }).toEqual({
      requeued: true,
      params: [
        "a",
        "T001 again",
        { spec_task_id: "T001" },
        2261,
        "https://github.com/re-cinq/lore/issues/2261",
        "18773dbb-5972-43f1-8a2a-5db8831bcc5a",
      ],
    });
  });

  it("rewrites running spec-task b onto issue #2262 and keeps its status", async () => {
    const capture: Query[] = [];
    const rows = new PgSpecTaskRows(fakePool(capture), noCreate);

    await rows.update("b", { description: "T002 again", issueNumber: 2262 });

    expect(capture[0]?.text.includes("status")).toBe(false);
  });
});

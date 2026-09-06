import { describe, it, expect } from "vitest";
import {
  staleTaskCheckJob,
  type StaleTaskCheckDeps,
  type StaleTaskRow,
} from "./stale-task-check.js";

const task = (over: Partial<StaleTaskRow> = {}): StaleTaskRow => ({
  id: "task-1",
  task_type: "feature-planning",
  target_repo: "re-cinq/lore",
  created_at: "2026-01-01T00:00:00.000Z",
  issue_number: 42,
  age_hours: 9.2,
  ...over,
});

function harness(rows: StaleTaskRow[], openLines: string[] = []) {
  const escalated: Array<{ id: string; ageHours: number }> = [];
  const deps: StaleTaskCheckDeps = {
    findStaleRunning: async () => rows,
    hasOpenLine: async (taskId) => openLines.includes(taskId),
    escalate: async (row, ageHours) => {
      escalated.push({ id: row.id, ageHours });
    },
  };

  return { deps, escalated };
}

describe("staleTaskCheckJob", () => {
  it("escalates a 9.2h task whose line is closed", async () => {
    const h = harness([task()]);

    expect(await staleTaskCheckJob(h.deps)).toContain("Escalated 1/1");
    expect(h.escalated).toEqual([{ id: "task-1", ageHours: 9.2 }]);
  });

  it("leaves a task alone while its line is still open, since escalating it would strand it at needs-human-help forever (decideTaskSettlement only settles pending/queued/running)", async () => {
    const h = harness([task()], ["task-1"]);

    expect(await staleTaskCheckJob(h.deps)).toContain(
      "Escalated 0/1 stale tasks, 1 still walking",
    );
    expect(h.escalated).toEqual([]);
  });

  it("reports no stale tasks when the sweep finds none", async () => {
    const h = harness([]);

    expect(await staleTaskCheckJob(h.deps)).toBe(
      "No stale tasks (threshold 6h)",
    );
  });

  it("escalates the closed-line task and skips the open one in the same sweep", async () => {
    const h = harness(
      [task(), task({ id: "task-2", age_hours: 7 })],
      ["task-2"],
    );

    expect(await staleTaskCheckJob(h.deps)).toContain("Escalated 1/2");
    expect(h.escalated.map((e) => e.id)).toEqual(["task-1"]);
  });
});

import { describe, expect, it } from "vitest";
import { pickPlanRun } from "./pick-plan-run.js";

const run = (id: string, status: string, outcome: string | null = null) => ({
  id,
  status,
  outcome,
});

describe("pickPlanRun", () => {
  it("picks the open run-old over the newer finished run-new", () => {
    const runs = [
      run("run-new", "finished", "completed"),
      run("run-old", "running"),
    ];

    expect(pickPlanRun(runs)?.id).toBe("run-old");
  });

  it("picks run-real, the newest not cancelled, over the cancelled shell run-shell created after it", () => {
    const runs = [
      run("run-shell", "finished", "cancelled"),
      run("run-real", "finished", "completed"),
    ];

    expect(pickPlanRun(runs)?.id).toBe("run-real");
  });

  it("picks the newest run, run-new, when every run was cancelled", () => {
    const runs = [
      run("run-new", "finished", "cancelled"),
      run("run-old", "finished", "cancelled"),
    ];

    expect(pickPlanRun(runs)?.id).toBe("run-new");
  });

  it("picks nothing for a plan no run has started for", () => {
    expect(pickPlanRun([])).toBeNull();
  });
});

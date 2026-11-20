import { describe, it, expect } from "vitest";
import { setupOutcome } from "./update-setup-result";

describe("setupOutcome", () => {
  it("returns started with the task id when the re-onboard was queued", () => {
    expect(setupOutcome("re-cinq/a", { ok: true, taskId: "t1" })).toEqual({
      repo: "re-cinq/a",
      status: "started",
      taskId: "t1",
    });
  });

  it("returns running with the task id when a task is already in flight", () => {
    expect(
      setupOutcome("re-cinq/a", {
        ok: false,
        block: "in-flight",
        message: "busy",
        taskId: "t2",
      }),
    ).toEqual({ repo: "re-cinq/a", status: "running", taskId: "t2" });
  });

  it("returns refused with the reason when the refusal names no task", () => {
    expect(
      setupOutcome("re-cinq/a", {
        ok: false,
        block: "in-flight",
        message: "lore-api is down",
        taskId: null,
      }),
    ).toEqual({
      repo: "re-cinq/a",
      status: "refused",
      reason: "lore-api is down",
    });
  });
});

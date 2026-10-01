import { describe, expect, it } from "vitest";
import { namedTaskType } from "./retired-task-types.js";

describe("namedTaskType", () => {
  it("answers runbook for a task of type runbook", () => {
    expect(namedTaskType("runbook")).toBe("runbook");
  });

  it("refuses a task with no type, pointing at the implementation loop", () => {
    expect(() => namedTaskType(undefined)).toThrow(
      new Error(
        "task_type is required: a task with no type has nothing to run it. To have something implemented, open an issue with a priority:high, priority:medium or priority:low label and the implementation loop picks it up.",
      ),
    );
  });

  it.each(["implementation", "general"])(
    "refuses the removed %s task type, pointing at the implementation loop",
    (removed) => {
      expect(() => namedTaskType(removed)).toThrow(
        new Error(
          `The "${removed}" task type was removed. To have something implemented, open an issue with a priority:high, priority:medium or priority:low label and the implementation loop picks it up.`,
        ),
      );
    },
  );
});

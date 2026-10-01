import { describe, expect, it } from "vitest";
import { namedTaskType } from "./retired-task-types.js";

describe("namedTaskType", () => {
  it("answers onboard for a task of type onboard", () => {
    expect(namedTaskType("onboard")).toBe("onboard");
  });

  it("refuses a task with no type, pointing at the implementation loop", () => {
    expect(() => namedTaskType(undefined)).toThrow(
      new Error(
        "task_type is required: a task with no type has nothing to run it. To have something implemented, open an issue with a priority:high, priority:medium or priority:low label and the implementation loop picks it up.",
      ),
    );
  });

  it.each(["implementation", "general", "runbook", "gap-fill"])(
    "refuses the removed %s task type, pointing at the implementation loop",
    (removed) => {
      expect(() => namedTaskType(removed)).toThrow(
        new Error(
          `The "${removed}" task type was removed. To have something implemented, open an issue with a priority:high, priority:medium or priority:low label and the implementation loop picks it up.`,
        ),
      );
    },
  );

  it.each(["feature-request", "feature-finalize"])(
    "refuses the removed %s task type, pointing at the Plans page",
    (removed) => {
      expect(() => namedTaskType(removed)).toThrow(
        new Error(
          `The "${removed}" task type was removed. To have a feature specified, start a plan on the repository's Plans page.`,
        ),
      );
    },
  );

  it("refuses the removed review task type, saying every pull request is reviewed already", () => {
    expect(() => namedTaskType("review")).toThrow(
      new Error(
        'The "review" task type was removed. Every open pull request is reviewed already; comment `@lore review` on one to have it reviewed again.',
      ),
    );
  });
});

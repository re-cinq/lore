import { describe, it, expect } from "vitest";
import type { PipelineTask } from "@re-cinq/lore-shared";
import { assemblyLineFor } from "./dispatch-agent-cr.js";

const taskOf = (task_type: string) => ({ task_type }) as PipelineTask;

describe("assemblyLineFor", () => {
  it("walks the onboard line for an onboard task with dark mode off", () => {
    expect(
      assemblyLineFor({
        task: taskOf("onboard"),
        isFeaturePlanningType: false,
        darkFactoryEnabled: false,
      }),
    ).toBe("onboard");
  });

  it("dispatches an implementation task as a single agent with dark mode off", () => {
    expect(
      assemblyLineFor({
        task: taskOf("implementation"),
        isFeaturePlanningType: false,
        darkFactoryEnabled: false,
      }),
    ).toBeUndefined();
  });

  it("walks the implementation line for an implementation task with dark mode on", () => {
    expect(
      assemblyLineFor({
        task: taskOf("implementation"),
        isFeaturePlanningType: false,
        darkFactoryEnabled: true,
      }),
    ).toBe("implementation");
  });

  it("walks the feature-planning line for a feature-lifecycle task whatever dark mode says", () => {
    expect(
      assemblyLineFor({
        task: taskOf("feature-planning"),
        isFeaturePlanningType: true,
        darkFactoryEnabled: false,
      }),
    ).toBe("feature-planning");
  });
});

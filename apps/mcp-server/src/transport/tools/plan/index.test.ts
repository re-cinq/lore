import { describe, it, expect } from "vitest";
import { registerPlanTools } from "./index.js";

describe("registerPlanTools", () => {
  it("registers lore_plan_read before lore_plan_edit", () => {
    const registered: string[] = [];

    registerPlanTools({
      tool(name: string) {
        registered.push(name);
      },
    } as never);

    expect(registered).toEqual(["lore_plan_read", "lore_plan_edit"]);
  });
});

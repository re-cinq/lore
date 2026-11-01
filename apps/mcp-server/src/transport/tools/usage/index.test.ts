import { describe, it, expect } from "vitest";
import { registerUsageTools } from "./index.js";

describe("registerUsageTools", () => {
  it("registers lore_my_usage before lore_get_analytics", () => {
    const registered: string[] = [];

    registerUsageTools({
      tool(name: string) {
        registered.push(name);
      },
    } as never);

    expect(registered).toEqual(["lore_my_usage", "lore_get_analytics"]);
  });
});

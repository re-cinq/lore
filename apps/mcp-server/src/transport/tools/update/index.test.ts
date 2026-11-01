import { describe, it, expect } from "vitest";
import { toolHandlers } from "../shared/tool-test-helpers.js";
import { registerUpdateTools } from "./index.js";

describe("registerUpdateTools", () => {
  it("registers lore_update", () => {
    expect(Object.keys(toolHandlers(registerUpdateTools, "full"))).toEqual([
      "lore_update",
    ]);
  });
});

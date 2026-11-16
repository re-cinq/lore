import { describe, it, expect } from "vitest";
import { toolHandlers } from "../shared/tool-test-helpers.js";
import { registerVersionsTools } from "./index.js";

describe("registerVersionsTools", () => {
  it("registers lore_versions", () => {
    expect(Object.keys(toolHandlers(registerVersionsTools, "agent"))).toEqual([
      "lore_versions",
    ]);
  });
});

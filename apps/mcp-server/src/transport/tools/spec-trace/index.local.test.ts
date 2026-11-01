import { describe, it, expect } from "vitest";
import { registerSpecTraceLocalTools } from "./index.local.js";
import { toolHandlers } from "../shared/tool-test-helpers.js";

describe("registerSpecTraceLocalTools", () => {
  it("registers the domain's tools in order", () => {
    expect(
      Object.keys(toolHandlers(registerSpecTraceLocalTools, "full")),
    ).toEqual(["lore_list_tests", "lore_run_test"]);
  });
});

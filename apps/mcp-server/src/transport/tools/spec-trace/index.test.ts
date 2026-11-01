import { describe, it, expect } from "vitest";
import { registerSpecTraceTools } from "./index.js";
import { toolHandlers } from "../shared/tool-test-helpers.js";

describe("registerSpecTraceTools", () => {
  it("registers the domain's tools in order", () => {
    expect(Object.keys(toolHandlers(registerSpecTraceTools, "full"))).toEqual([
      "lore-query-trace",
    ]);
  });
});

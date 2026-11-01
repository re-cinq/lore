import { describe, it, expect } from "vitest";
import { toolHandlers } from "../shared/tool-test-helpers.js";
import { registerContextTools } from "./index.js";

describe("registerContextTools", () => {
  it("registers lore_search_context before lore_assemble_context", () => {
    expect(Object.keys(toolHandlers(registerContextTools, "full"))).toEqual([
      "lore_search_context",
      "lore_assemble_context",
    ]);
  });
});

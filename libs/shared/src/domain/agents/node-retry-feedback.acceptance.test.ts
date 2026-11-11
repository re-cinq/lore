import { describe, it, expect } from "vitest";
import { appendRuntimeContext } from "./recipe-prompt.js";

describe("node failure retry feedback", () => {
  it("appends the failing step's name and its own output to the prompt (spec: specs/implementation-loop/spec.md#L86)", () => {
    const result = appendRuntimeContext("Base prompt", {
      reported_changes: true,
      node_failure: {
        name: "validate",
        output: "TypeError: Cannot read property 'foo' of undefined",
      },
    });

    expect(result).toContain("Base prompt");
    expect(result).toContain("## The previous step validate failed");
    expect(result).toContain(
      "TypeError: Cannot read property 'foo' of undefined",
    );
  });
});

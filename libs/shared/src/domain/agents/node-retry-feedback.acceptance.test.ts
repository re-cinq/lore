import { describe, it, expect } from "vitest";
import { appendRuntimeContext } from "./recipe-prompt.js";

describe("node failure retry feedback", () => {
  it("appends the failing step's name and its own output to the prompt (spec: specs/implementation-loop/spec.md#L86)", () => {
    const failure = {
      name: "validate",
      output: "TypeError: Cannot read property 'foo' of undefined",
    };
    const expected =
      "Base prompt\n\n## The previous step validate failed\nTypeError: Cannot read property 'foo' of undefined";

    expect(appendRuntimeContext("Base prompt", { node_failure: failure })).toBe(
      expected,
    );
    expect(
      appendRuntimeContext("Base prompt", {
        reported_changes: false,
        node_failure: failure,
      }),
    ).toBe(expected);
    expect(
      appendRuntimeContext("Base prompt", {
        reported_changes: true,
        node_failure: failure,
      }),
    ).toBe("Base prompt");
  });
});

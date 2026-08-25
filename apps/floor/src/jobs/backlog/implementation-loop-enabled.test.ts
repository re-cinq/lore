import { describe, it, expect } from "vitest";
import { implementationLoopEnabled } from "./implementation-loop-enabled.js";

describe("implementationLoopEnabled", () => {
  it("returns true when implementation_loop.enabled is the boolean true", () => {
    expect(
      implementationLoopEnabled({ implementation_loop: { enabled: true } }),
    ).toBe(true);
  });

  it("returns false when enabled is explicitly false", () => {
    expect(
      implementationLoopEnabled({ implementation_loop: { enabled: false } }),
    ).toBe(false);
    expect(implementationLoopEnabled({ implementation_loop: {} })).toBe(false);
  });

  it("returns false when the implementation_loop block is absent", () => {
    expect(implementationLoopEnabled({})).toBe(false);
  });

  it("returns false when settings are null", () => {
    expect(implementationLoopEnabled(null)).toBe(false);
  });

  it("returns false for a truthy non-boolean enabled value", () => {
    expect(
      implementationLoopEnabled({ implementation_loop: { enabled: "yes" } }),
    ).toBe(false);
  });

  it("parses a JSON string settings blob", () => {
    expect(
      implementationLoopEnabled('{"implementation_loop":{"enabled":true}}'),
    ).toBe(true);
    expect(implementationLoopEnabled("not json")).toBe(false);
  });
});

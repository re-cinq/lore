import { describe, it, expect } from "vitest";
import { planPath } from "./plan-id.js";

describe("planPath", () => {
  it("leaves an ordinary plan id as it is", () => {
    expect(planPath("b4b2026f-1111-2222-3333-444455556666", "agent-view")).toBe(
      "/api/plans/b4b2026f-1111-2222-3333-444455556666/agent-view",
    );
  });

  it("keeps a plan id that holds a path inside one segment", () => {
    expect(planPath("x/../../repos/a/b?", "agent-view")).toBe(
      "/api/plans/x%2F..%2F..%2Frepos%2Fa%2Fb%3F/agent-view",
    );
  });

  it("refuses a dot segment as a plan id", () => {
    expect(() => planPath("..", "agent-view")).toThrow(
      "an id was expected, not a path",
    );
  });
});

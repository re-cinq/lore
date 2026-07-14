import { describe, it, expect } from "vitest";
import { ciOutcome } from "./github-action-handler.js";

describe("ciOutcome", () => {
  it("maps each CI conclusion", () => {
    expect(ciOutcome("success")).toBe("success");
    expect(ciOutcome("failure")).toBe("failed");
    expect(ciOutcome("none")).toBe("success");
    expect(ciOutcome("pending")).toBeNull();
  });
});

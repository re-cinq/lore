import { describe, it, expect } from "vitest";
import { isCancellable } from "./task-status";

describe("isCancellable", () => {
  it("returns false for completed", () => {
    expect(isCancellable("completed")).toBe(false);
  });

  it("returns false for merged, failed, cancelled", () => {
    expect(isCancellable("merged")).toBe(false);
    expect(isCancellable("failed")).toBe(false);
    expect(isCancellable("cancelled")).toBe(false);
  });

  it("returns true for running, pending, queued, review", () => {
    expect(isCancellable("running")).toBe(true);
    expect(isCancellable("pending")).toBe(true);
    expect(isCancellable("queued")).toBe(true);
    expect(isCancellable("review")).toBe(true);
  });
});

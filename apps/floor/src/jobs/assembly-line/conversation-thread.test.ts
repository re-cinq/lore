import { describe, it, expect } from "vitest";
import { resolveThread, mayContinue } from "./conversation-thread.js";

const ctx = {
  assemblyLineId: "line-1",
  taskId: "task-1",
  args: { feature_id: "feature-9", description: "plan it" },
};

describe("resolveThread", () => {
  it("keys a thread on the run for `line`", () => {
    expect(resolveThread("line", "address", ctx)).toEqual({
      ok: true,
      thread: { kind: "line", value: "line-1", nodeId: "address" },
    });
  });

  it("keys a thread on the task for `task`", () => {
    expect(resolveThread("task", "analyze", ctx)).toEqual({
      ok: true,
      thread: { kind: "task", value: "task-1", nodeId: "analyze" },
    });
  });

  it("keys a thread on a named arg, so the engine stays domain-free", () => {
    expect(resolveThread("args.feature_id", "analyze", ctx)).toEqual({
      ok: true,
      thread: { kind: "args", value: "feature-9", nodeId: "analyze" },
    });
  });

  it("errors when the run carries no such arg", () => {
    // Falling back to "no conversation" would silently start fresh forever, which
    // looks exactly like continuity that remembered nothing.
    expect(resolveThread("args.customer_id", "analyze", ctx)).toEqual({
      ok: false,
      error:
        'continues.key "args.customer_id" but the run carries no customer_id',
    });
  });

  it("errors when the arg is present but empty", () => {
    expect(
      resolveThread("args.feature_id", "analyze", {
        ...ctx,
        args: { feature_id: "" },
      }),
    ).toMatchObject({ ok: false });
  });

  it("errors on a task-keyed thread for a task-less line", () => {
    expect(
      resolveThread("task", "analyze", { ...ctx, taskId: null }),
    ).toMatchObject({ ok: false });
  });

  it("errors on a key the loader would never have accepted", () => {
    expect(resolveThread("feature", "analyze", ctx)).toMatchObject({
      ok: false,
    });
  });
});

describe("mayContinue", () => {
  it("continues on a node's first execution", () => {
    expect(mayContinue(1)).toBe(true);
  });

  it("never continues on a retry, so a rerun is reproducible", () => {
    // A retry exists because the last attempt failed; inheriting its context would
    // make the rerun path-dependent on whatever confused it.
    expect(mayContinue(2)).toBe(false);
    expect(mayContinue(3)).toBe(false);
  });
});

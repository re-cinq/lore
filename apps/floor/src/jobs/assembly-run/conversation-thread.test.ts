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

describe("mayContinue by why the node is being revisited", () => {
  it("continues when the node's previous visit succeeded — a next round, not a retry", () => {
    // The merged planning line revisits `analyze` for every round, so round 2 is
    // iteration 2. Refusing to continue at iteration > 1 silently killed continuity
    // for every round after the first.
    expect(mayContinue("success")).toBe(true);
  });

  it("continues when the previous visit asked for changes", () => {
    expect(mayContinue("changes_requested")).toBe(true);
  });

  it("refuses when the previous visit failed — a retry must be reproducible", () => {
    // A retry exists because the last attempt failed; inheriting that attempt's
    // context would make the rerun path-dependent.
    expect(mayContinue("failed")).toBe(false);
  });

  it("refuses when the previous visit failed for an infrastructure reason", () => {
    expect(mayContinue("review-failed")).toBe(false);
  });

  it("continues a node the walk has never visited", () => {
    expect(mayContinue(null)).toBe(true);
  });
});

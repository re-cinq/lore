import { describe, it, expect, vi } from "vitest";
import {
  executeGraph,
  resumeFromTrailers,
  type NodeHandlers,
  type NodeResult,
} from "../supervisor/graph-executor.js";
import { parseWorkflow, type Workflow } from "../workflow/loader.js";
import type { LeaseBackend } from "../supervisor/lease.js";

// ── Fixtures ────────────────────────────────────────────────────────────

const linearWorkflow: Workflow = parseWorkflow(`
name: linear
description: a → b → c
version: 1
entry: a
exit: c
nodes:
  - id: a
    type: agent
  - id: b
    type: validate
  - id: c
    type: retrospective
edges:
  - from: a
    to: b
    on: success
  - from: b
    to: c
    on: always
`);

const reviewLoopWorkflow: Workflow = parseWorkflow(`
name: review-loop
description: implement → validate → review → (changes → implement)
version: 1
entry: implement
exit: done
nodes:
  - id: implement
    type: agent
  - id: validate
    type: validate
  - id: review
    type: agent
  - id: done
    type: retrospective
edges:
  - from: implement
    to: validate
    on: success
  - from: validate
    to: review
    on: success
  - from: review
    to: done
    on: success
  - from: review
    to: implement
    on: changes_requested
    iteration_max: 2
`);

function noopBackend(): LeaseBackend {
  return {
    acquire: vi.fn(async () => ({ acquired: true })),
    refresh: vi.fn(async () => true),
    release: vi.fn(async () => true),
  };
}

interface RunCapture {
  visited: string[];
  commits: Array<{ subject: string; body: string }>;
}

function makeHandlers(
  outcomes: Partial<Record<string, NodeResult>>,
  capture: RunCapture,
): NodeHandlers {
  const dispatch = async (node: { id: string; type: string }) => {
    capture.visited.push(node.id);
    return outcomes[node.id] ?? { outcome: "success" as const };
  };
  return {
    agent: dispatch,
    validate: dispatch,
    gate: dispatch,
    retrospective: dispatch,
  };
}

// Pure executor tests use a fake committer so no real git is required.
function makeCapturingExecuteOpts(opts: {
  workflow: Workflow;
  outcomes?: Partial<Record<string, NodeResult>>;
}): {
  capture: RunCapture;
  run: () => Promise<ReturnType<typeof executeGraph> extends Promise<infer R> ? R : never>;
} {
  const capture: RunCapture = { visited: [], commits: [] };
  const run = () =>
    executeGraph({
      workflow: opts.workflow,
      taskId: "task-1",
      branchName: "branch-x",
      gitDir: "/dev/null",
      holder: "test",
      leaseBackend: noopBackend(),
      handlers: makeHandlers(opts.outcomes ?? {}, capture),
      gitCommit: async (_dir, subject, body) => {
        capture.commits.push({ subject, body });
      },
    });
  return { capture, run };
}

// ── executeGraph ────────────────────────────────────────────────────────

describe("executeGraph (linear)", () => {
  it("walks entry → ... → exit", async () => {
    const { capture, run } = makeCapturingExecuteOpts({
      workflow: linearWorkflow,
    });
    const summary = await run();
    expect(summary.reachedExit).toBe(true);
    expect(capture.visited).toEqual(["a", "b"]); // c is exit, not handled
    expect(capture.commits).toHaveLength(2);
    expect(capture.commits[0].subject).toBe("[stage:a] iter=1");
  });

  it("emits Lore-Stage / Lore-Iteration / Lore-Task / Lore-Outcome trailers", async () => {
    const { capture, run } = makeCapturingExecuteOpts({
      workflow: linearWorkflow,
    });
    await run();
    const body = capture.commits[0].body;
    expect(body).toContain("Lore-Stage: a");
    expect(body).toContain("Lore-Iteration: 1");
    expect(body).toContain("Lore-Task: task-1");
    expect(body).toContain("Lore-Outcome: success");
  });

  it("throws when no edge matches the outcome", async () => {
    const { run } = makeCapturingExecuteOpts({
      workflow: linearWorkflow,
      outcomes: { a: { outcome: "failed" } },
    });
    await expect(run()).rejects.toThrow(
      /no edge from "a" for outcome "failed"/,
    );
  });
});

describe("executeGraph (review loop)", () => {
  it("loops back through implement on changes_requested", async () => {
    let reviewCalls = 0;
    const handlers = (() => {
      const capture: RunCapture = { visited: [], commits: [] };
      const handlerOf = (id: string) => async (node: { id: string }) => {
        capture.visited.push(node.id);
        if (node.id === "review") {
          reviewCalls++;
          // First two reviews fail with changes_requested, third passes.
          return reviewCalls < 3
            ? { outcome: "changes_requested" as const }
            : { outcome: "success" as const };
        }
        return { outcome: "success" as const };
      };
      return { capture, handlerOf };
    })();

    const summary = await executeGraph({
      workflow: reviewLoopWorkflow,
      taskId: "t",
      branchName: "b",
      gitDir: "/dev/null",
      holder: "test",
      leaseBackend: noopBackend(),
      handlers: {
        agent: handlers.handlerOf("agent"),
        validate: handlers.handlerOf("validate"),
        gate: handlers.handlerOf("gate"),
        retrospective: handlers.handlerOf("retrospective"),
      },
      gitCommit: async () => {},
    });

    expect(summary.reachedExit).toBe(true);
    // implement, validate, review, implement, validate, review, implement, validate, review (success)
    expect(reviewCalls).toBe(3);
  });

  it("aborts when iteration_max is exceeded", async () => {
    let reviewCalls = 0;
    await expect(
      executeGraph({
        workflow: reviewLoopWorkflow,
        taskId: "t",
        branchName: "b",
        gitDir: "/dev/null",
        holder: "test",
        leaseBackend: noopBackend(),
        handlers: {
          agent: async (n) => {
            if (n.id === "review") reviewCalls++;
            return n.id === "review"
              ? { outcome: "changes_requested" }
              : { outcome: "success" };
          },
          validate: async () => ({ outcome: "success" }),
          gate: async () => ({ outcome: "success" }),
          retrospective: async () => ({ outcome: "success" }),
        },
        gitCommit: async () => {},
      }),
    ).rejects.toThrow(/iteration_max=2/);
    expect(reviewCalls).toBe(3); // 3rd attempt triggers the cap
  });
});

describe("executeGraph (lease)", () => {
  it("refreshes the lease before each node", async () => {
    const backend = noopBackend();
    const refresh = backend.refresh as ReturnType<typeof vi.fn>;
    await executeGraph({
      workflow: linearWorkflow,
      taskId: "t",
      branchName: "branch-x",
      gitDir: "/dev/null",
      holder: "holder-1",
      leaseBackend: backend,
      handlers: {
        agent: async () => ({ outcome: "success" }),
        validate: async () => ({ outcome: "success" }),
        gate: async () => ({ outcome: "success" }),
        retrospective: async () => ({ outcome: "success" }),
      },
      gitCommit: async () => {},
    });
    // 2 nodes executed (a, b); c is exit.
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenCalledWith("branch-x", "holder-1", undefined, "a");
    expect(refresh).toHaveBeenCalledWith("branch-x", "holder-1", undefined, "b");
  });
});

// ── resumeFromTrailers (T015 pure helper) ───────────────────────────────

describe("resumeFromTrailers", () => {
  it("returns next node from a successful prior stage", () => {
    const r = resumeFromTrailers(linearWorkflow, {
      stage: "a",
      iteration: 1,
      taskId: "t",
      extras: { "Lore-Outcome": "success" },
    });
    expect(r).toEqual({ nextNode: "b", iteration: 1 });
  });

  it("defaults outcome to success when no Lore-Outcome trailer", () => {
    const r = resumeFromTrailers(linearWorkflow, {
      stage: "a",
      iteration: 1,
      taskId: "t",
    });
    expect(r?.nextNode).toBe("b");
  });

  it("returns null when stage isn't in this workflow (stale branch)", () => {
    const r = resumeFromTrailers(linearWorkflow, {
      stage: "ghost-stage",
      iteration: 1,
      taskId: "t",
    });
    expect(r).toBeNull();
  });

  it("follows changes_requested back-edge", () => {
    const r = resumeFromTrailers(reviewLoopWorkflow, {
      stage: "review",
      iteration: 1,
      taskId: "t",
      extras: { "Lore-Outcome": "changes_requested" },
    });
    expect(r).toEqual({ nextNode: "implement", iteration: 1 });
  });

  it("returns null when no edge matches the outcome", () => {
    const r = resumeFromTrailers(linearWorkflow, {
      stage: "a",
      iteration: 1,
      taskId: "t",
      extras: { "Lore-Outcome": "failed" },
    });
    expect(r).toBeNull();
  });
});

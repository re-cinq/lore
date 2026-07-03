import { describe, it, expect, vi } from "vitest";
import {
  executeAssemblyLine,
  resumeFromTrailers,
  IterationMaxExceededError,
  type IterationMaxExceededInfo,
  type NodeHandlers,
  type NodeResult,
} from "./assembly-line-executor.js";
import { parseAssemblyLine, type AssemblyLine } from "./loader.js";
import type { LeaseBackend } from "@re-cinq/lore-shared";

// ── Fixtures ────────────────────────────────────────────────────────────

const linearAssemblyLine: AssemblyLine = parseAssemblyLine(`
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

const reviewLoopAssemblyLine: AssemblyLine = parseAssemblyLine(`
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
    reapExpired: vi.fn(async () => []),
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
  assemblyLine: AssemblyLine;
  outcomes?: Partial<Record<string, NodeResult>>;
}): {
  capture: RunCapture;
  run: () => Promise<ReturnType<typeof executeAssemblyLine> extends Promise<infer R> ? R : never>;
} {
  const capture: RunCapture = { visited: [], commits: [] };
  const run = () =>
    executeAssemblyLine({
      assemblyLine: opts.assemblyLine,
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

// ── executeAssemblyLine ────────────────────────────────────────────────────────

describe("executeAssemblyLine (linear)", () => {
  it("walks entry → ... → exit", async () => {
    const { capture, run } = makeCapturingExecuteOpts({
      assemblyLine: linearAssemblyLine,
    });
    const summary = await run();
    expect(summary.reachedExit).toBe(true);
    expect(capture.visited).toEqual(["a", "b"]); // c is exit, not handled
    expect(capture.commits).toHaveLength(2);
    expect(capture.commits[0].subject).toBe("[stage:a] iter=1");
  });

  it("emits Lore-Stage / Lore-Iteration / Lore-Task / Lore-Outcome trailers", async () => {
    const { capture, run } = makeCapturingExecuteOpts({
      assemblyLine: linearAssemblyLine,
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
      assemblyLine: linearAssemblyLine,
      outcomes: { a: { outcome: "failed" } },
    });
    await expect(run()).rejects.toThrow(
      /no edge from "a" for outcome "failed"/,
    );
  });
});

describe("executeAssemblyLine (review loop)", () => {
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

    const summary = await executeAssemblyLine({
      assemblyLine: reviewLoopAssemblyLine,
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

  it("aborts when iteration_max is exceeded with a typed error", async () => {
    let reviewCalls = 0;
    await expect(
      executeAssemblyLine({
        assemblyLine: reviewLoopAssemblyLine,
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
    ).rejects.toThrow(IterationMaxExceededError);
    expect(reviewCalls).toBe(3);
  });

  it("calls onIterationMaxExceeded hook before throwing (T040)", async () => {
    const escalations: IterationMaxExceededInfo[] = [];
    await expect(
      executeAssemblyLine({
        assemblyLine: reviewLoopAssemblyLine,
        taskId: "task-x",
        branchName: "branch-y",
        gitDir: "/dev/null",
        holder: "test",
        leaseBackend: noopBackend(),
        onIterationMaxExceeded: async (info) => {
          escalations.push(info);
        },
        handlers: {
          agent: async (n) =>
            n.id === "review"
              ? { outcome: "changes_requested" }
              : { outcome: "success" },
          validate: async () => ({ outcome: "success" }),
          gate: async () => ({ outcome: "success" }),
          retrospective: async () => ({ outcome: "success" }),
        },
        gitCommit: async () => {},
      }),
    ).rejects.toThrow(IterationMaxExceededError);

    expect(escalations).toHaveLength(1);
    expect(escalations[0]).toMatchObject({
      assemblyLineName: "review-loop",
      iterationMax: 2,
      taskId: "task-x",
      branchName: "branch-y",
      fromNode: "review",
      toNode: "implement",
    });
  });
});

describe("executeAssemblyLine (lease)", () => {
  it("refreshes the lease before each node", async () => {
    const backend = noopBackend();
    const refresh = backend.refresh as ReturnType<typeof vi.fn>;
    await executeAssemblyLine({
      assemblyLine: linearAssemblyLine,
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
    const r = resumeFromTrailers(linearAssemblyLine, {
      stage: "a",
      iteration: 1,
      taskId: "t",
      extras: { "Lore-Outcome": "success" },
    });
    expect(r).toEqual({ nextNode: "b", iteration: 1 });
  });

  it("defaults outcome to success when no Lore-Outcome trailer", () => {
    const r = resumeFromTrailers(linearAssemblyLine, {
      stage: "a",
      iteration: 1,
      taskId: "t",
    });
    expect(r?.nextNode).toBe("b");
  });

  it("returns null when stage isn't in this assembly line (stale branch)", () => {
    const r = resumeFromTrailers(linearAssemblyLine, {
      stage: "ghost-stage",
      iteration: 1,
      taskId: "t",
    });
    expect(r).toBeNull();
  });

  it("follows changes_requested back-edge", () => {
    const r = resumeFromTrailers(reviewLoopAssemblyLine, {
      stage: "review",
      iteration: 1,
      taskId: "t",
      extras: { "Lore-Outcome": "changes_requested" },
    });
    expect(r).toEqual({ nextNode: "implement", iteration: 1 });
  });

  it("returns null when no edge matches the outcome", () => {
    const r = resumeFromTrailers(linearAssemblyLine, {
      stage: "a",
      iteration: 1,
      taskId: "t",
      extras: { "Lore-Outcome": "failed" },
    });
    expect(r).toBeNull();
  });
});

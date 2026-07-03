import { describe, it, expect } from "vitest";
import type { AssemblyLineNode } from "./loader.js";
import type { NodeContext } from "./assembly-line-executor.js";
import {
  ciOutcome,
  createGithubActionHandler,
  type CiConclusion,
  type GithubActionDeps,
} from "./github-action-handler.js";

const node: AssemblyLineNode = { id: "ci", type: "github_action" };
const ctx: NodeContext = {
  taskId: "task-1",
  assemblyLineId: "al-test-1",
  branchName: "lore/impl-1",
  gitDir: "/work",
  iteration: 0,
  assemblyLineName: "implementation",
};

describe("ciOutcome", () => {
  it("maps each CI conclusion", () => {
    expect(ciOutcome("success")).toBe("success");
    expect(ciOutcome("failure")).toBe("failed");
    expect(ciOutcome("none")).toBe("success");
    expect(ciOutcome("pending")).toBeNull();
  });
});

function fakeDeps(queue: CiConclusion[], over: Partial<GithubActionDeps> = {}) {
  const calls = { heartbeat: [] as string[], sleep: 0 };
  const q = [...queue];
  const deps: GithubActionDeps = {
    ciConclusion: async () => (q.length ? q.shift()! : "pending"),
    heartbeat: async (_b, nodeId) => { calls.heartbeat.push(nodeId); },
    sleep: async () => { calls.sleep++; },
    ...over,
  };
  return { deps, calls };
}

describe("createGithubActionHandler", () => {
  it("waits through pending, heartbeats each poll, then returns the CI verdict", async () => {
    const { deps, calls } = fakeDeps(["pending", "success"]);
    expect(await createGithubActionHandler(deps)(node, ctx)).toEqual({
      outcome: "success",
      extras: { "Lore-CI-Conclusion": "success" },
    });
    expect(calls.heartbeat).toEqual(["ci", "ci"]);
    expect(calls.sleep).toBe(1);
  });

  it("maps a red build to failed", async () => {
    const { deps } = fakeDeps(["failure"]);
    expect((await createGithubActionHandler(deps)(node, ctx)).outcome).toBe("failed");
  });

  it("times out to failed when CI never concludes", async () => {
    const { deps, calls } = fakeDeps([], { maxPolls: 2, pollIntervalMs: 1 });
    const result = await createGithubActionHandler(deps)(node, ctx);
    expect(result).toMatchObject({ outcome: "failed", extras: { "Lore-CI-Conclusion": "timeout" } });
    expect(calls.heartbeat).toHaveLength(2);
  });
});

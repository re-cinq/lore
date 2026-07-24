// Paginated Agent-CR listing: the reconcile safety net and the watch catch-up
// must never hold the whole namespace in one parsed response — 180 accumulated
// CRs blew Node's heap and crash-looped the Floor (2026-07-24), and the pruner
// (which lives in the same pass) could then never shrink the pile again.
import { describe, it, expect, vi } from "vitest";
import type { CustomObjectsApi } from "@kubernetes/client-node";

const getById = vi.fn();
const getLineById = vi.fn();
const insertEvent = vi.fn();

vi.mock("../kernel/queues.js", () => ({
  taskStore: () => ({ getById }),
  assemblyLines: () => ({ getById: getLineById }),
}));
vi.mock("../main-loop/store.js", () => ({
  insertEvent: (...args: unknown[]) => insertEvent(...args),
}));
vi.mock("../jobs/watcher/agent-watcher.js", () => ({
  makeAgentsApi: () => {
    throw new Error("test must inject its own api");
  },
}));

const { forEachAgentPage, reconcileAgents } = await import("./k8s-watch.js");

interface FakePage {
  items?: unknown[];
  metadata?: Record<string, string>;
}

function fakeLister(pages: FakePage[]) {
  const calls: Array<Record<string, unknown>> = [];
  let next = 0;
  const k8sApi = {
    listNamespacedCustomObject: async (params: Record<string, unknown>) => {
      calls.push(params);

      return pages[next++] ?? { items: [] };
    },
    deleteNamespacedCustomObject: vi.fn(async () => ({})),
  };

  return { k8sApi, calls };
}

const terminalCr = (name: string, completedAt: string) => ({
  metadata: {
    name,
    labels: { "lore.re-cinq.com/task-id": `task-${name}` },
  },
  status: { phase: "Succeeded", completedAt },
});

describe("forEachAgentPage", () => {
  it("walks every page via the continue token and passes the page limit", async () => {
    const { k8sApi, calls } = fakeLister([
      { items: [1, 2], metadata: { continue: "next-1" } },
      { items: [3], metadata: { _continue: "next-2" } },
      { items: [4] },
    ]);
    const seen: unknown[] = [];

    await forEachAgentPage(k8sApi as never, "ai-agents", async (items) => {
      seen.push(...items);
    });

    expect(seen).toEqual([1, 2, 3, 4]);
    expect(calls.map((c) => c._continue)).toEqual([
      undefined,
      "next-1",
      "next-2",
    ]);
    expect(calls.every((c) => c.limit === 50)).toBe(true);
  });

  it("returns the list resourceVersion for watch seeding", async () => {
    const { k8sApi } = fakeLister([
      { items: [], metadata: { continue: "next", resourceVersion: "41" } },
      { items: [], metadata: { resourceVersion: "42" } },
    ]);

    const rv = await forEachAgentPage(
      k8sApi as never,
      "ai-agents",
      async () => {},
    );

    expect(rv).toBe("42");
  });
});

describe("reconcileAgents pagination", () => {
  it("prunes an hour-old terminal CR found on a later page", async () => {
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const { k8sApi } = fakeLister([
      { items: [], metadata: { continue: "next" } },
      { items: [terminalCr("stale", old)] },
    ]);

    getById.mockResolvedValue(undefined);
    await reconcileAgents({
      k8sApi: k8sApi as unknown as CustomObjectsApi,
      namespace: "ai-agents",
    });

    expect(k8sApi.deleteNamespacedCustomObject).toHaveBeenCalledWith(
      expect.objectContaining({ name: "stale", namespace: "ai-agents" }),
    );
  });

  it("re-emits a terminal CR whose task is still running", async () => {
    const now = new Date().toISOString();
    const { k8sApi } = fakeLister([{ items: [terminalCr("fresh", now)] }]);

    getById.mockResolvedValue({ status: "running" });
    insertEvent.mockResolvedValue(undefined);
    await reconcileAgents({
      k8sApi: k8sApi as unknown as CustomObjectsApi,
      namespace: "ai-agents",
    });

    expect(insertEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: "kubernetes.agent.succeeded" }),
    );
    expect(k8sApi.deleteNamespacedCustomObject).not.toHaveBeenCalled();
  });
});

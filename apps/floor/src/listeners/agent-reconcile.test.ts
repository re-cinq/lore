// Paginated Agent-CR listing: the reconcile safety net and the watch catch-up
// must never hold the whole namespace in one parsed response — 180 accumulated
// CRs blew Node's heap and crash-looped the Floor (2026-07-24), and the pruner
// (which lives in the same pass) could then never shrink the pile again.
import { describe, it, expect, vi } from "vitest";
import type { Agent as AgentCr } from "@re-cinq/agent-contracts";

const getById = vi.fn();
const getLineById = vi.fn();
const emitEvent = vi.fn();

vi.mock("../kernel/queues.js", () => ({
  // The logs route resolves the cluster agent from here.
  clusterAgent: () => ({}),
  taskStore: () => ({ getById }),
  assemblyRuns: () => ({ getById: getLineById }),
}));
vi.mock("../main-loop/store.js", () => ({
  emitEvent: (...args: unknown[]) => emitEvent(...args),
}));
const { forEachAgentPage, reconcileAgents } =
  await import("./agent-reconcile.js");

interface FakePage {
  items: AgentCr[];
  continueToken?: string;
}

/** A double for the narrowed seam: one page-fetch, plus the delete the prune
 *  makes. Faking two methods rather than a Kubernetes client is the point of
 *  narrowing it. */
function fakeLister(pages: FakePage[]) {
  const calls: Array<{ limit: number; continue?: string }> = [];
  let next = 0;
  const cluster = {
    listPage: async (opts: { limit: number; continue?: string }) => {
      calls.push(opts);

      return pages[next++] ?? { items: [] };
    },
    remove: vi.fn(async (_name: string) => {}),
  };

  return { cluster, calls };
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
    const { cluster, calls } = fakeLister([
      { items: [1, 2] as never, continueToken: "next-1" },
      { items: [3] as never, continueToken: "next-2" },
      { items: [4] as never },
    ]);
    const seen: unknown[] = [];

    await forEachAgentPage(cluster, async (items) => {
      seen.push(...items);
    });

    expect(seen).toEqual([1, 2, 3, 4]);
    expect(calls.map((c) => c.continue)).toEqual([
      undefined,
      "next-1",
      "next-2",
    ]);
    expect(calls.every((c) => c.limit === 50)).toBe(true);
  });
});

describe("reconcileAgents pagination", () => {
  it("prunes an hour-old terminal CR found on a later page", async () => {
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const { cluster } = fakeLister([
      { items: [], continueToken: "next" },
      { items: [terminalCr("stale", old)] as never },
    ]);

    getById.mockResolvedValue(undefined);
    await reconcileAgents(cluster as never);

    expect(cluster.remove).toHaveBeenCalledWith("stale");
  });

  it("re-emits a terminal CR whose task is still running", async () => {
    const now = new Date().toISOString();
    const { cluster } = fakeLister([
      { items: [terminalCr("fresh", now)] as never },
    ]);

    getById.mockResolvedValue({ status: "running" });
    emitEvent.mockResolvedValue(undefined);
    await reconcileAgents(cluster as never);

    expect(emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: "kubernetes.agent.succeeded" }),
    );
    expect(cluster.remove).not.toHaveBeenCalled();
  });
});

describe("a page whose CRs reconcile independently", () => {
  it("still prunes the other two CRs of a page when the first one throws", async () => {
    // Serial, one throwing CR abandoned the rest of the sweep — the worst
    // failure mode for a safety net, and it bites hardest in exactly the
    // pile-up this pass exists to clear.
    const old = new Date(Date.now() - 7 * 3600_000).toISOString();
    const { cluster } = fakeLister([
      {
        items: [
          terminalCr("a", old),
          terminalCr("b", old),
          terminalCr("c", old),
        ] as never,
      },
    ]);

    getById.mockReset();
    getById.mockRejectedValueOnce(new Error("db blip"));
    getById.mockResolvedValue({ status: "completed" });

    await reconcileAgents(cluster as never);

    // Expected now: the thrower's own reconcile died before its prune step, so
    // "a" is not pruned, while "b" and "c" are unaffected. Before, the throw
    // propagated out of the page callback and stopped the sweep, so none of the
    // three was pruned.
    expect(cluster.remove.mock.calls.map((c) => c[0])).toEqual(["b", "c"]);
  });
});

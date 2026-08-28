import { describe, it, expect } from "vitest";
import type { EventInsert } from "@re-cinq/lore-shared";
import {
  forEachAgentPage,
  reportForAgent,
  type AgentLister,
} from "./agent-reporting.js";

const TASK = "lore.re-cinq.com/task-id";

/** A lister over fixed pages, echoing the `continue` protocol the real API uses. */
function pagedLister(
  pages: { items: unknown[]; next?: string }[],
): AgentLister {
  return {
    listNamespacedCustomObject: (async (opts: { _continue?: string }) => {
      const index = opts._continue ? Number(opts._continue) : 0;
      const page = pages[index];

      return {
        items: page.items,
        metadata: { _continue: page.next, resourceVersion: "rv-1" },
      };
    }) as AgentLister["listNamespacedCustomObject"],
  };
}

describe("reportForAgent", () => {
  it("reports a terminal Agent CR as its kubernetes event", async () => {
    const reported: EventInsert[] = [];

    await reportForAgent(
      {
        metadata: { name: "cr-1", labels: { [TASK]: "task-1" } },
        status: { phase: "Succeeded" },
      } as never,
      {
        insert: async (e) => {
          reported.push(e);
        },
      },
    );

    expect(reported).toEqual([
      {
        eventName: "kubernetes.agent.succeeded",
        source: "kubernetes",
        params: {
          taskId: "task-1",
          agentName: "cr-1",
          phase: "Succeeded",
          status: { phase: "Succeeded" },
        },
        dedupeKey: "k8s:task-1:Succeeded",
      },
    ]);
  });

  it("reports nothing for a CR that has not reached a terminal phase", async () => {
    const reported: EventInsert[] = [];

    await reportForAgent(
      {
        metadata: { name: "cr-1", labels: { [TASK]: "task-1" } },
        status: { phase: "Running" },
      } as never,
      {
        insert: async (e) => {
          reported.push(e);
        },
      },
    );

    expect(reported).toEqual([]);
  });

  it("swallows a failed report so one bad CR cannot end the watch", async () => {
    const failing = {
      insert: async (): Promise<void> => {
        throw new Error("router unreachable");
      },
    };

    await expect(
      reportForAgent(
        {
          metadata: { name: "cr-1", labels: { [TASK]: "task-1" } },
          status: { phase: "Failed" },
        } as never,
        failing,
      ),
    ).resolves.toBeUndefined();
  });
});

describe("forEachAgentPage", () => {
  it("walks every page rather than holding the namespace at once", async () => {
    const seen: string[] = [];

    const resourceVersion = await forEachAgentPage(
      pagedLister([
        { items: [{ metadata: { name: "a" } }], next: "1" },
        { items: [{ metadata: { name: "b" } }] },
      ]),
      "ai-agents",
      async (items) => {
        for (const item of items) {
          seen.push((item as { metadata: { name: string } }).metadata.name);
        }
      },
    );

    expect(seen).toEqual(["a", "b"]);
    expect(resourceVersion).toBe("rv-1");
  });

  it("reads the raw `continue` token too, which is what the API actually sends", async () => {
    const seen: string[] = [];

    await forEachAgentPage(
      {
        listNamespacedCustomObject: (async (opts: { _continue?: string }) => {
          return opts._continue
            ? { items: [{ metadata: { name: "b" } }], metadata: {} }
            : {
                items: [{ metadata: { name: "a" } }],
                metadata: { continue: "1" },
              };
        }) as AgentLister["listNamespacedCustomObject"],
      },
      "ai-agents",
      async (items) => {
        for (const item of items) {
          seen.push((item as { metadata: { name: string } }).metadata.name);
        }
      },
    );

    expect(seen).toEqual(["a", "b"]);
  });

  it("reports no resourceVersion when a page carries none", async () => {
    const resourceVersion = await forEachAgentPage(
      {
        listNamespacedCustomObject:
          (async () => ({})) as AgentLister["listNamespacedCustomObject"],
      },
      "ai-agents",
      async () => {},
    );

    expect(resourceVersion).toBeUndefined();
  });
});

describe("reportForAgent over a network", () => {
  const succeeded = {
    metadata: { name: "a-1", labels: { "lore.re-cinq.com/task-id": "t-1" } },
    status: { phase: "Succeeded" },
  } as never;

  it("retries a failed insert, since the report now crosses a network", async () => {
    // The insert used to be a write on this process's own pool. It is now an
    // HTTP POST to the event-router, so a blip is expected rather than
    // exceptional — and a dropped terminal event leaves its node open until the
    // reaper, which is the failure the event bus exists to remove.
    let attempts = 0;

    await reportForAgent(succeeded, {
      insert: async () => {
        attempts++;

        return attempts < 3
          ? Promise.reject(new Error("ECONNREFUSED"))
          : Promise.resolve();
      },
      retry: { attempts: 5, delayMs: 1 },
    });

    expect(attempts).toBe(3);
  });

  it("gives up after the last attempt without throwing, so one bad report cannot stop the watch", async () => {
    let attempts = 0;

    await reportForAgent(succeeded, {
      insert: async () => {
        attempts++;

        return Promise.reject(new Error("ECONNREFUSED"));
      },
      retry: { attempts: 2, delayMs: 1 },
    });

    expect(attempts).toBe(2);
  });
});

describe("reportForAgent — a refused credential re-registers before the retry", () => {
  const succeeded = {
    metadata: { name: "run-1-review", labels: { [TASK]: "t-1" } },
    status: { phase: "Succeeded" },
  } as never;
  const unauthorized = Object.assign(new Error("event insert failed: 401"), {
    status: 401,
  });

  it("re-registers once on a 401 and the next attempt lands", async () => {
    // The satellite's per-agent token rotates whenever another instance of it
    // registers (a rollout overlap did exactly that on 2026-08-28). Retrying
    // with the same token five times lost run 595d2b0b's terminal event.
    let inserts = 0;
    let reRegistrations = 0;

    await reportForAgent(succeeded, {
      insert: async () => {
        inserts++;

        return inserts === 1 ? Promise.reject(unauthorized) : Promise.resolve();
      },
      onUnauthorized: async () => {
        reRegistrations++;
      },
      retry: { attempts: 5, delayMs: 1 },
    });

    expect({ inserts, reRegistrations }).toEqual({
      inserts: 2,
      reRegistrations: 1,
    });
  });

  it("re-registers on a 403 the same as a 401", async () => {
    const forbidden = Object.assign(new Error("event insert failed: 403"), {
      status: 403,
    });
    let inserts = 0;
    let reRegistrations = 0;

    await reportForAgent(succeeded, {
      insert: async () => {
        inserts++;

        return inserts === 1 ? Promise.reject(forbidden) : Promise.resolve();
      },
      onUnauthorized: async () => {
        reRegistrations++;
      },
      retry: { attempts: 5, delayMs: 1 },
    });

    expect({ inserts, reRegistrations }).toEqual({
      inserts: 2,
      reRegistrations: 1,
    });
  });

  it("does not re-register on an ordinary blip", async () => {
    let reRegistrations = 0;
    let inserts = 0;

    await reportForAgent(succeeded, {
      insert: async () => {
        inserts++;

        return inserts === 1
          ? Promise.reject(new Error("ECONNREFUSED"))
          : Promise.resolve();
      },
      onUnauthorized: async () => {
        reRegistrations++;
      },
      retry: { attempts: 3, delayMs: 1 },
    });

    expect(reRegistrations).toBe(0);
  });
});

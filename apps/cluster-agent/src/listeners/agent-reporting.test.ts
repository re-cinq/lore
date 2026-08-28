import { describe, it, expect } from "vitest";
import type { ProxyMessage } from "@re-cinq/lore-shared/project/events/event-input-port.js";
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
    const reported: ProxyMessage[] = [];

    await reportForAgent(
      {
        metadata: { name: "cr-1", labels: { [TASK]: "task-1" } },
        status: { phase: "Succeeded" },
      } as never,
      {
        emit: async (message) => {
          reported.push(message);
        },
      },
    );

    expect(reported).toEqual([
      {
        kind: "event",
        event: {
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
      },
    ]);
  });

  it("reports nothing for a CR that has not reached a terminal phase", async () => {
    const reported: ProxyMessage[] = [];

    await reportForAgent(
      {
        metadata: { name: "cr-1", labels: { [TASK]: "task-1" } },
        status: { phase: "Running" },
      } as never,
      {
        emit: async (message) => {
          reported.push(message);
        },
      },
    );

    expect(reported).toEqual([]);
  });

  it("swallows a failed emit so one bad CR cannot end the watch", async () => {
    const failing = {
      emit: async (): Promise<void> => {
        throw new Error("proxy refused the message");
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

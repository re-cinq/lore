import { describe, it, expect } from "vitest";
import { forEachAgentPage, type AgentLister } from "./agent-pages.js";

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

describe("forEachAgentPage", () => {
  it("walks every page rather than holding the namespace at once", async () => {
    const seen: string[] = [];

    const resourceVersion = await forEachAgentPage(
      pagedLister([
        { items: [{ metadata: { name: "a" } }], next: "1" },
        { items: [{ metadata: { name: "b" } }] },
      ]),
      "ai-agents",
      async (page) => {
        for (const agent of page) {
          seen.push((agent as { metadata: { name: string } }).metadata.name);
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
      async (page) => {
        for (const agent of page) {
          seen.push((agent as { metadata: { name: string } }).metadata.name);
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

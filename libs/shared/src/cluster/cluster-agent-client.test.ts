// The client's own paging. `listByLabel` is the one method that hides a loop
// from its caller, so the loop is what these assert: a selector matching more
// than one page must come back whole, not truncated to the first.
import { describe, it, expect, vi } from "vitest";
import { HttpAgentApi } from "./cluster-agent-client.js";
import type { Agent as AgentCr } from "@re-cinq/agent-contracts";

function cr(name: string): AgentCr {
  return { metadata: { name } } as AgentCr;
}

/** A transport answering as `GET /agents` would, one scripted page per call. */
function pagingTransport(
  pages: { items: AgentCr[]; continueToken?: string }[],
) {
  const paths: string[] = [];
  let next = 0;

  return {
    paths,
    call: vi.fn(async (_method: string, path: string) => {
      paths.push(path);

      return pages[next++];
    }),
  };
}

describe("HttpAgentApi.listByLabel", () => {
  it("returns every page's items, not just the first", async () => {
    const transport = pagingTransport([
      { items: [cr("a-1"), cr("a-2")], continueToken: "tok-1" },
      { items: [cr("a-3")] },
    ]);
    const api = new HttpAgentApi(transport as never);

    const found = await api.listByLabel("lore.dev/task=t-1");

    expect(found.map((c) => c.metadata?.name)).toEqual(["a-1", "a-2", "a-3"]);
  });

  it("carries the prior page's continue token into the next request", async () => {
    const transport = pagingTransport([
      { items: [cr("a-1")], continueToken: "tok-1" },
      { items: [] },
    ]);

    await new HttpAgentApi(transport as never).listByLabel("k=v");

    expect(transport.paths).toEqual([
      "/agents?labelSelector=k%3Dv&limit=100",
      "/agents?labelSelector=k%3Dv&limit=100&continue=tok-1",
    ]);
  });

  it("stops after one request when the first page is the last", async () => {
    const transport = pagingTransport([{ items: [cr("a-1")] }]);

    await new HttpAgentApi(transport as never).listByLabel("k=v");

    expect(transport.call).toHaveBeenCalledTimes(1);
  });

  it("returns an empty list when the agent answers with no items", async () => {
    const transport = pagingTransport([{ items: [] }]);

    expect(
      await new HttpAgentApi(transport as never).listByLabel("k=v"),
    ).toEqual([]);
  });
});

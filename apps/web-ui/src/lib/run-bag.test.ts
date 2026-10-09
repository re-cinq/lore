// @vitest-environment node

import { describe, it, expect, vi, afterEach } from "vitest";
import { bagRefreshKey, readRunBag } from "./run-bag";
import type { AssemblyRunNode } from "./assembly-run-rows";

const BAG = { task_id: { kind: "value", ref: "task-1", by: "lore" } };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("readRunBag", () => {
  it("reads the bag of run-1 through the session-authed proxy", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ bag: BAG }));

    vi.stubGlobal("fetch", fetchMock);

    expect(await readRunBag("run-1")).toEqual(BAG);
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "/api/assembly-runs/run-1/bag",
    );
  });

  it("is null when the proxy answers 404, as it does for a run Lore's own engine walked", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("{}", { status: 404 })),
    );

    expect(await readRunBag("run-1")).toBeNull();
  });

  it("is null for an answer with no bag in it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ events: [] })),
    );

    expect(await readRunBag("run-1")).toBeNull();
  });
});

const visit = (
  nodeId: string,
  iteration: number,
  outcome: string | null,
): AssemblyRunNode => ({
  nodeId,
  iteration,
  outcome,
  agentCrName: null,
  commitSha: null,
  durationSeconds: null,
});

describe("bagRefreshKey", () => {
  it("does not change when a visit starts, since nothing has been produced yet", () => {
    const before = bagRefreshKey("running", [visit("qa", 1, "success")]);
    const after = bagRefreshKey("running", [
      visit("qa", 1, "success"),
      visit("qa", 2, null),
    ]);

    expect(after).toBe(before);
  });

  it("changes when that visit finishes", () => {
    const running = bagRefreshKey("running", [visit("qa", 1, null)]);
    const finished = bagRefreshKey("running", [visit("qa", 1, "failed")]);

    expect(finished).not.toBe(running);
  });

  it("changes when the run's status does", () => {
    const nodes = [visit("qa", 1, "failed")];

    expect(bagRefreshKey("failed", nodes)).not.toBe(
      bagRefreshKey("running", nodes),
    );
  });
});

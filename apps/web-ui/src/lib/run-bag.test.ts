// @vitest-environment node

import { describe, it, expect, vi, afterEach } from "vitest";
import { readRunBag } from "./run-bag";

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

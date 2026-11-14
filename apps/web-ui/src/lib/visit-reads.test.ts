// @vitest-environment node

import { describe, it, expect, vi, afterEach } from "vitest";
import { readVisitEvents, readVisitModelCalls } from "./visit-reads";
import { liveRequestsFrom } from "@/lib/live-socket/answering-socket";

const CALL = {
  seq: 1,
  occurredAt: "2026-10-10T10:00:00.000Z",
  model: "gemini-3.1-pro",
  costUsd: 0.02,
  tokensIn: 1000,
  cacheReadTokens: 800,
  tokensOut: 120,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("visit reads", () => {
  it("reads visit-1's model calls over the live socket", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ calls: [CALL] }));

    liveRequestsFrom(fetchMock);

    expect({
      calls: await readVisitModelCalls("run-1", "visit-1"),
      url: String(fetchMock.mock.calls[0][0]),
    }).toEqual({
      calls: [CALL],
      url: "/api/assembly-runs/run-1/visits/visit-1/model-calls",
    });
  });

  it("answers no events on a 404, as for a run Lore's own engine walked", async () => {
    liveRequestsFrom(
      vi.fn().mockResolvedValue(new Response("{}", { status: 404 })),
    );

    expect(await readVisitEvents("run-1", "visit-1")).toEqual([]);
  });
});

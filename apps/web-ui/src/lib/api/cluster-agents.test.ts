// @vitest-environment node

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

const { getClusterAgents } = await import("./cluster-agents");

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.LORE_API_URL = "http://api:3000";
  process.env.LORE_ADMIN_TOKEN = "admin";
  fetchMock = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ agents: [], offline_events: [] })),
    );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.LORE_ADMIN_TOKEN;
});

describe("getClusterAgents", () => {
  it("fetches /api/cluster-agents from lore-api and returns the body", async () => {
    const result = await getClusterAgents();

    expect(String(fetchMock.mock.calls[0][0])).toEqual(
      "http://api:3000/api/cluster-agents",
    );
    expect(result).toEqual({
      status: "ok",
      data: { agents: [], offline_events: [] },
    });
  });
});

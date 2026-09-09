// @vitest-environment node

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

const { fetchDodProgress } = await import("./dod");

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.LORE_API_URL = "http://api:3000";
  process.env.LORE_ADMIN_TOKEN = "admin";
  fetchMock = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify({ present: false })));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.LORE_ADMIN_TOKEN;
});

describe("fetchDodProgress", () => {
  it("reads the run's definition of done from lore-api", async () => {
    const result = await fetchDodProgress("run-1");

    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "http://api:3000/api/assembly-runs/run-1/dod",
    );
    expect(result).toEqual({ status: "ok", data: { present: false } });
  });
});

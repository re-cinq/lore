// @vitest-environment node

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

const { getAutoMerge } = await import("./auto-merge");

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  process.env.LORE_API_URL = "http://api:3000";
  process.env.LORE_ADMIN_TOKEN = "admin";
  fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([])));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.LORE_ADMIN_TOKEN;
});

describe("getAutoMerge", () => {
  it("reads /api/repos/re-cinq/lore/auto-merge from lore-api", async () => {
    await getAutoMerge("re-cinq/lore");

    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "http://api:3000/api/repos/re-cinq/lore/auto-merge",
    );
  });
});

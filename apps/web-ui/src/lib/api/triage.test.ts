// @vitest-environment node

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

const { getIssueTriage } = await import("./triage");

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

describe("getIssueTriage", () => {
  it("reads /api/repos/re-cinq/lore/triage from lore-api", async () => {
    await getIssueTriage("re-cinq/lore");

    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "http://api:3000/api/repos/re-cinq/lore/triage",
    );
  });
});

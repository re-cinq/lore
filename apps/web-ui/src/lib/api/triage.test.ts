// @vitest-environment node

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

const { getIssueTriage } = await import("./triage");

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  process.env.LORE_API_URL = "http://api:3000";
  fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([])));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getIssueTriage", () => {
  it("reads /api/repos/re-cinq/lore/triage from lore-api", async () => {
    await getIssueTriage("re-cinq/lore");

    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "http://api:3000/api/repos/re-cinq/lore/triage",
    );
  });
});

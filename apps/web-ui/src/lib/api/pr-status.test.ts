// @vitest-environment node

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

const { fetchPrTitle } = await import("./pr-status");

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.LORE_API_URL = "http://api:3000";
  process.env.LORE_ADMIN_TOKEN = "admin";
  fetchMock = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ title: "spec: faster checkout" })),
    );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.LORE_ADMIN_TOKEN;
});

describe("fetchPrTitle", () => {
  it("reads PR #261's title from lore-api's pr-status route", async () => {
    const title = await fetchPrTitle("re-cinq/Otto", 261);

    expect({ url: String(fetchMock.mock.calls[0][0]), title }).toEqual({
      url: "http://api:3000/api/pr-status?repo=re-cinq%2FOtto&pr_number=261",
      title: "spec: faster checkout",
    });
  });

  it("answers null when lore-api cannot report the PR", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 502 }));

    expect(await fetchPrTitle("re-cinq/Otto", 261)).toBeNull();
  });
});

// @vitest-environment node

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

const { fetchPrStatus } = await import("./pr-status");

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.LORE_API_URL = "http://api:3000";
  process.env.LORE_ADMIN_TOKEN = "admin";
  fetchMock = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        title: "spec: faster checkout",
        unresolved_threads: 3,
      }),
    ),
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.LORE_ADMIN_TOKEN;
});

describe("fetchPrStatus", () => {
  it("reads PR #261's title and its 3 unresolved threads from lore-api's pr-status route", async () => {
    const pr = await fetchPrStatus("re-cinq/Otto", 261);

    expect({ url: String(fetchMock.mock.calls[0][0]), pr }).toEqual({
      url: "http://api:3000/api/pr-status?repo=re-cinq%2FOtto&pr_number=261",
      pr: { title: "spec: faster checkout", unresolved_threads: 3 },
    });
  });

  it("answers null when lore-api cannot report the PR", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 502 }));

    expect(await fetchPrStatus("re-cinq/Otto", 261)).toBeNull();
  });
});

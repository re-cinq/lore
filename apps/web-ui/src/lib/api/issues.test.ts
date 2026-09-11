// @vitest-environment node

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

const { fetchIssue } = await import("./issues");

const ISSUE = {
  number: 42,
  title: "Show the issue on the run page",
  state: "open",
  url: "https://github.com/re-cinq/lore/issues/42",
  body: "## Why",
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  process.env.LORE_API_URL = "http://api:3000";
  process.env.LORE_ADMIN_TOKEN = "admin";
  fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(ISSUE)));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.LORE_ADMIN_TOKEN;
});

describe("fetchIssue", () => {
  it("reads the issue from lore-api's issue route for the repo and number", async () => {
    const result = await fetchIssue("re-cinq/lore", 42);

    expect({ url: String(fetchMock.mock.calls[0][0]), result }).toEqual({
      url: "http://api:3000/api/repos/re-cinq/lore/issues/42",
      result: { status: "ok", data: ISSUE },
    });
  });
});

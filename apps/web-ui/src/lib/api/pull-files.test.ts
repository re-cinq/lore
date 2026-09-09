// @vitest-environment node

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

const { fetchPullFiles } = await import("./pull-files");

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.LORE_API_URL = "http://api:3000";
  process.env.LORE_ADMIN_TOKEN = "admin";
  fetchMock = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify({ files: [] })));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.LORE_ADMIN_TOKEN;
});

describe("fetchPullFiles", () => {
  it("reads the pull request's changed files from lore-api", async () => {
    const result = await fetchPullFiles("re-cinq/lore", 42);

    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "http://api:3000/api/repos/re-cinq/lore/pulls/42/files",
    );
    expect(result).toEqual({ status: "ok", data: { files: [] } });
  });
});

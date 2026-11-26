// @vitest-environment node

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

const { getRelease } = await import("./release");

let fetchMock: ReturnType<typeof vi.fn>;

const LATEST = {
  latest: "v1.3.0",
  url: "https://github.com/re-cinq/lore/releases/tag/v1.3.0",
  releasesUrl: "https://github.com/re-cinq/lore/releases",
  updateAvailable: true,
};

beforeEach(() => {
  process.env.LORE_API_URL = "http://api:3000";
  fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(LATEST)));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getRelease", () => {
  it("asks lore-api for the release newer than running v1.2.3", async () => {
    await getRelease("v1.2.3");

    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "http://api:3000/api/release?running=v1.2.3",
    );
  });

  it("returns the latest release lore-api answers", async () => {
    expect(await getRelease("v1.2.3")).toEqual(LATEST);
  });

  it("returns null when lore-api answers 500", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 500 }));

    expect(await getRelease("v1.2.3")).toBeNull();
  });
});

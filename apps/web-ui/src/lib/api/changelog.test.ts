// @vitest-environment node

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

const { getChangelog, writeChangelogIntro } = await import("./changelog");

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  process.env.LORE_API_URL = "http://api:3000";
  fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({})));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getChangelog", () => {
  it("reads the first page with no before", async () => {
    await getChangelog("re-cinq/lore");

    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "http://api:3000/api/repos/re-cinq/lore/changelog",
    );
  });

  it("reads the weeks before 2026-W42 for an older page", async () => {
    await getChangelog("re-cinq/lore", { before: "2026-W42" });

    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "http://api:3000/api/repos/re-cinq/lore/changelog?before=2026-W42",
    );
  });
});

describe("writeChangelogIntro", () => {
  it("posts to re-cinq/lore's 2026-W44 intro", async () => {
    await writeChangelogIntro("re-cinq/lore", "2026-W44");

    expect({
      url: String(fetchMock.mock.calls[0][0]),
      method: fetchMock.mock.calls[0][1].method,
    }).toEqual({
      url: "http://api:3000/api/repos/re-cinq/lore/changelog/2026-W44/intro",
      method: "POST",
    });
  });
});

describe("startRelease", () => {
  it("posts to re-cinq/lore's release", async () => {
    const { startRelease } = await import("./changelog");

    await startRelease("re-cinq/lore");

    expect({
      url: String(fetchMock.mock.calls[0][0]),
      method: fetchMock.mock.calls[0][1].method,
    }).toEqual({
      url: "http://api:3000/api/repos/re-cinq/lore/release",
      method: "POST",
    });
  });
});

describe("startRelease refused", () => {
  it("answers the error with code 409 when lore-api refuses a public mirror", async () => {
    const { startRelease } = await import("./changelog");

    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "is the public mirror" }), {
        status: 409,
      }),
    );

    expect(await startRelease("re-cinq/lore-public")).toMatchObject({
      status: "error",
      code: 409,
    });
  });
});

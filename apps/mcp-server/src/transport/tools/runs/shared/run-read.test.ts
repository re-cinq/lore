import { describe, it, expect, vi } from "vitest";
import { fakeLoreApi } from "./fake-lore-api.js";
import { readParts, readRun, RUNS_NEED_API } from "./run-read.js";

const api = fakeLoreApi();
const textOf = async (load: Parameters<typeof readRun>[0]["load"]) =>
  (await readRun({ tool: "lore_test", op: "testing", load })).content[0].text;

describe("readRun", () => {
  it("answers the require-URL message without fetching when LORE_API_URL is unset", async () => {
    vi.stubEnv("LORE_API_URL", "");

    expect(await textOf((get) => get("/a"))).toBe(RUNS_NEED_API);
    expect(api.requested).toEqual([]);
  });

  it("reports a denied error on a 403", async () => {
    api.refuse("/a", 403);

    expect(await textOf((get) => get("/a"))).toContain("denied access");
  });

  it("reports HTTP 404 Not Found as unreachable", async () => {
    expect(await textOf((get) => get("/a"))).toContain("HTTP 404 Not Found");
  });

  it("returns 'Error testing: connect ECONNREFUSED' when fetch throws", async () => {
    api.drop("/a");

    expect(await textOf((get) => get("/a"))).toBe(
      "Error testing: connect ECONNREFUSED",
    );
  });
});

describe("readParts", () => {
  it("merges parts a and b into {a, b}", async () => {
    api.answer("/a", 1);
    api.answer("/b", 2);

    expect(
      JSON.parse(
        await textOf((get) =>
          readParts(get, { required: { a: "/a", b: "/b" } }),
        ),
      ),
    ).toEqual({ a: 1, b: 2 });
  });

  it("keeps a missing optional part as {error: 'HTTP 404 Not Found'}", async () => {
    api.answer("/a", 1);

    expect(
      JSON.parse(
        await textOf((get) =>
          readParts(get, { required: { a: "/a" }, optional: { b: "/b" } }),
        ),
      ),
    ).toEqual({ a: 1, b: { error: "HTTP 404 Not Found" } });
  });

  it("fails the read when the required part answers 404", async () => {
    api.answer("/b", 2);

    expect(
      await textOf((get) =>
        readParts(get, { required: { a: "/a" }, optional: { b: "/b" } }),
      ),
    ).toContain("HTTP 404 Not Found");
  });

  it("keeps a not-configured optional part as {error: 'not_configured'}", async () => {
    api.answer("/a", 1);
    const get = async (path: string) =>
      path === "/a"
        ? { ok: true as const, body: "1" }
        : { ok: false as const, reason: "not_configured" as const };

    expect(
      JSON.parse(
        await textOf(() =>
          readParts(get, { required: { a: "/a" }, optional: { b: "/b" } }),
        ),
      ),
    ).toEqual({
      a: 1,
      b: { error: "not_configured" },
    });
  });
});

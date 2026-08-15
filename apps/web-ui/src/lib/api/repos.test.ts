// @vitest-environment node
//
// One repo read for nine call sites. The paths ARE the contract with lore-api.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

const {
  getRepo,
  listRepos,
  onboardRepo,
  getOrgSettings,
  putOrgSettings,
  putRepoSettings,
} = await import("./repos");

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.LORE_API_URL = "http://api:3000";
  process.env.LORE_ADMIN_TOKEN = "admin";
  fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({})));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.LORE_ADMIN_TOKEN;
});

const url = () => fetchMock.mock.calls[0][0];

describe("getRepo", () => {
  it("reads the record for an owner/name pair", async () => {
    await getRepo("re-cinq/lore");

    expect(url()).toEqual("http://api:3000/api/repos/re-cinq/lore");
  });

  it("returns the record on 200", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ full_name: "re-cinq/lore", team: "platform" }),
      ),
    );

    expect(await getRepo("re-cinq/lore")).toEqual({
      status: "ok",
      data: { full_name: "re-cinq/lore", team: "platform" },
    });
  });

  it("reports a missing repo as a 404 result rather than throwing", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "Repo not found" }), {
        status: 404,
      }),
    );

    expect(await getRepo("re-cinq/gone")).toMatchObject({
      status: "error",
      message: "Repo not found",
      code: 404,
    });
  });
});

describe("listRepos", () => {
  it("reads the onboarded repo list", async () => {
    await listRepos();

    expect(url()).toEqual("http://api:3000/api/repos");
  });

  it("returns the repos array on 200", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ repos: [{ full_name: "re-cinq/lore" }], total: 1 }),
      ),
    );

    const result = await listRepos();

    expect(result).toMatchObject({
      status: "ok",
      data: { repos: [{ full_name: "re-cinq/lore" }] },
    });
  });
});

describe("repo writes and org settings", () => {
  it("posts the repo (and only a true reonboard flag) to /api/onboard", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true })));

    await onboardRepo("re-cinq/lore");
    await onboardRepo("re-cinq/lore", { reonboard: true });

    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({
      repo: "re-cinq/lore",
    });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body as string)).toEqual({
      repo: "re-cinq/lore",
      reonboard: true,
    });
  });

  it("reads org settings from /api/settings", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ settings: [], repo_count: 0 })),
    );

    await getOrgSettings();

    expect(String(fetchMock.mock.calls[0][0])).toContain("/api/settings");
  });

  it("PUTs org settings entries by key", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true })));

    await putOrgSettings([{ key: "org_name", value: "re-cinq" }]);

    expect(fetchMock.mock.calls[0][1].method).toEqual("PUT");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({
      entries: [{ key: "org_name", value: "re-cinq" }],
    });
  });

  it("PUTs the general repo-settings patch to the repo's settings path", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true })));

    await putRepoSettings("re-cinq/lore", { team: "platform" });

    expect(String(fetchMock.mock.calls[0][0])).toContain(
      "/api/repos/re-cinq/lore/settings",
    );
    expect(fetchMock.mock.calls[0][1].method).toEqual("PUT");
  });
});

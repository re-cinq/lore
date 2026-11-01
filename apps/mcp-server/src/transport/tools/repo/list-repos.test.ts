import { describe, it, expect, afterEach, vi } from "vitest";

vi.mock("../shared/deps.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../shared/deps.js")>()),
  proxyGetApi: vi.fn(),
}));

import { proxyGetApi } from "../shared/deps.js";
import { registerListReposTool } from "./list-repos.js";
import type { ServerMode } from "../shared/repo-scope.js";
import { toolHandlers } from "../shared/tool-test-helpers.js";

function handlerFor(name: string, mode: ServerMode = "full") {
  return toolHandlers(registerListReposTool, mode)[name];
}

function page(repos: unknown[], total: number) {
  return {
    ok: true as const,
    body: JSON.stringify({ repos, total, limit: 100, offset: 0 }),
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("lore_list_repos", () => {
  it("pages through repos beyond the 100-row API cap", async () => {
    const first = Array.from({ length: 100 }, (_, i) => ({ id: i }));
    const second = Array.from({ length: 50 }, (_, i) => ({ id: 100 + i }));

    vi.mocked(proxyGetApi)
      .mockResolvedValueOnce(page(first, 150))
      .mockResolvedValueOnce(page(second, 150));
    const result = await handlerFor("lore_list_repos")({});

    const parsed = JSON.parse(result.content[0].text);

    expect({
      paths: vi.mocked(proxyGetApi).mock.calls.map((call) => call[0]),
      total: parsed.total,
      repoCount: parsed.repos.length,
    }).toEqual({
      paths: [
        "/api/repos?limit=100&offset=0",
        "/api/repos?limit=100&offset=100",
      ],
      total: 150,
      repoCount: 150,
    });
  });

  it("makes a single call when all repos fit in one page", async () => {
    vi.mocked(proxyGetApi).mockResolvedValueOnce(
      page([{ id: 1 }, { id: 2 }], 2),
    );
    const result = await handlerFor("lore_list_repos")({});

    expect(proxyGetApi).toHaveBeenCalledTimes(1);
    expect(JSON.parse(result.content[0].text)).toEqual({
      repos: [{ id: 1 }, { id: 2 }],
      total: 2,
    });
  });

  it("reports no repos when the first page is empty", async () => {
    vi.mocked(proxyGetApi).mockResolvedValueOnce(page([], 0));
    const result = await handlerFor("lore_list_repos")({});

    expect(proxyGetApi).toHaveBeenCalledTimes(1);
    expect(result.content[0].text).toEqual(
      "No repos onboarded yet. Use lore_onboard_repo to add one.",
    );
  });

  it("returns a config-required message when the proxy reports not_configured mid-page", async () => {
    vi.mocked(proxyGetApi).mockResolvedValueOnce({
      ok: false,
      reason: "not_configured",
    });

    const result = await handlerFor("lore_list_repos")({});

    expect(result.content[0].text).toEqual(
      "Repo management requires LORE_API_URL + LORE_INGEST_TOKEN. Run install.sh to configure.",
    );
  });

  it("returns a denied error when the proxy reports denied", async () => {
    vi.mocked(proxyGetApi).mockResolvedValueOnce({
      ok: false,
      reason: "denied",
      detail: "invalid token",
    });

    const result = await handlerFor("lore_list_repos")({});

    expect(result.content[0].text).toContain("invalid token");
  });

  it("counts 2 repos as the total when a page carries no total", async () => {
    vi.mocked(proxyGetApi).mockResolvedValueOnce({
      ok: true,
      body: JSON.stringify({ repos: [{ id: 1 }, { id: 2 }] }),
    });

    const result = await handlerFor("lore_list_repos")({});

    expect(JSON.parse(result.content[0].text)).toEqual({
      repos: [{ id: 1 }, { id: 2 }],
      total: 2,
    });
  });

  it("reports no repos when a page carries no repos list", async () => {
    vi.mocked(proxyGetApi).mockResolvedValueOnce({ ok: true, body: "{}" });

    const result = await handlerFor("lore_list_repos")({});

    expect(result.content[0].text).toBe(
      "No repos onboarded yet. Use lore_onboard_repo to add one.",
    );
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@re-cinq/lore-server-core/features/repo/repo-detect.js", () => ({
  detectCurrentRepo: vi.fn(),
}));

vi.mock("./deps.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./deps.js")>()),
  proxyGetApi: vi.fn(),
  proxyToApi: vi.fn(),
}));

import { detectCurrentRepo } from "@re-cinq/lore-server-core/features/repo/repo-detect.js";
import { proxyGetApi, proxyToApi } from "./deps.js";
import { registerRepoTools } from "./repo-tools.js";

type ToolHandler = (args: Record<string, unknown>) => Promise<{
  content: { type: string; text: string }[];
}>;

const originalEnv = { ...process.env };

function handlerFor(name: string): ToolHandler {
  const handlers: Record<string, ToolHandler> = {};
  const fakeServer = {
    tool(
      toolName: string,
      _desc: string,
      _schema: unknown,
      handler: ToolHandler,
    ) {
      handlers[toolName] = handler;
    },
  };

  registerRepoTools(fakeServer as never);

  return handlers[name];
}

function page(repos: unknown[], total: number) {
  return {
    ok: true as const,
    body: JSON.stringify({ repos, total, limit: 100, offset: 0 }),
  };
}

afterEach(() => {
  process.env = { ...originalEnv };
  vi.clearAllMocks();
});

describe("lore_ingest_files", () => {
  beforeEach(() => {
    delete process.env.LORE_API_URL;
    delete process.env.LORE_INGEST_TOKEN;
  });

  it("returns a detect-repo message when no repo is given and detection fails", async () => {
    vi.mocked(detectCurrentRepo).mockReturnValue(null);
    const handler = handlerFor("lore_ingest_files");
    const result = await handler({ files: ["CLAUDE.md"] });

    expect(result.content[0].text).toEqual(
      "Could not detect repo. Specify repo parameter (e.g., 're-cinq/my-service').",
    );
  });

  it("returns a config-required message when LORE_API_URL / token are unset", async () => {
    const handler = handlerFor("lore_ingest_files");
    const result = await handler({
      files: ["CLAUDE.md"],
      repo: "re-cinq/lore",
    });

    expect(result.content[0].text).toEqual(
      "Ingestion requires LORE_API_URL + LORE_INGEST_TOKEN. Run install.sh to configure.",
    );
  });
});

describe("lore_onboard_repo", () => {
  it("returns the guard's refusal body verbatim on a 409, not the unreachable-retry copy, since the caller needs task_id to poll", async () => {
    const body = JSON.stringify({
      blocked: "in-flight",
      error: "re-cinq/x is already in flight",
      task_id: "task-9",
    });

    vi.mocked(proxyToApi).mockResolvedValue({
      ok: false,
      reason: "unreachable",
      detail: "HTTP 409 Conflict: re-cinq/x is already in flight",
      status: 409,
      body,
    });
    const handler = handlerFor("lore_onboard_repo");
    const result = await handler({ full_name: "re-cinq/x" });

    expect(result.content[0].text).toBe(body);
  });

  it("still reports a genuine outage as unreachable", async () => {
    vi.mocked(proxyToApi).mockResolvedValue({
      ok: false,
      reason: "unreachable",
      detail: "request timed out (15s)",
    });
    const handler = handlerFor("lore_onboard_repo");
    const result = await handler({ full_name: "re-cinq/x" });

    expect(result.content[0].text).toContain("Lore API unreachable");
  });

  it("passes reonboard through to the API", async () => {
    vi.mocked(proxyToApi).mockResolvedValue({ ok: true, body: "{}" });
    const handler = handlerFor("lore_onboard_repo");

    await handler({ full_name: "re-cinq/x", reonboard: true });

    expect(proxyToApi).toHaveBeenCalledWith("/api/onboard", {
      repo: "re-cinq/x",
      reonboard: true,
    });
  });
});

describe("lore_list_repos", () => {
  it("pages through repos beyond the 100-row API cap", async () => {
    const first = Array.from({ length: 100 }, (_, i) => ({ id: i }));
    const second = Array.from({ length: 50 }, (_, i) => ({ id: 100 + i }));

    vi.mocked(proxyGetApi)
      .mockResolvedValueOnce(page(first, 150))
      .mockResolvedValueOnce(page(second, 150));
    const result = await handlerFor("lore_list_repos")({});

    expect(proxyGetApi).toHaveBeenNthCalledWith(
      1,
      "/api/repos?limit=100&offset=0",
    );
    expect(proxyGetApi).toHaveBeenNthCalledWith(
      2,
      "/api/repos?limit=100&offset=100",
    );
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.total).toBe(150);
    expect(parsed.repos).toHaveLength(150);
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
});

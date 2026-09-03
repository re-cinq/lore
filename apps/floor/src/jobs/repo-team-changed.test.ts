import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const team = vi.fn<(repo: string) => Promise<string | null>>();
const chunkSchemaOrOrgShared =
  vi.fn<
    (pool: unknown, candidate: string | null | undefined) => Promise<string>
  >();
const relocateLegacyChunks =
  vi.fn<
    (
      schema: string,
      repo: string,
    ) => Promise<{ moved: number; dropped: number }>
  >();

vi.mock("../kernel/queues.js", () => ({
  clusterAgent: () => ({}),
  settings: () => ({ team }),
  chunks: () => ({ relocateLegacyChunks }),
}));

vi.mock("../kernel/db.js", () => ({
  getPool: () => ({}),
}));

vi.mock("@re-cinq/lore-shared/project/chunks/chunk-schema.js", () => ({
  ORG_SHARED_SCHEMA: "org_shared",
  chunkSchemaOrOrgShared: (
    pool: unknown,
    candidate: string | null | undefined,
  ) => chunkSchemaOrOrgShared(pool, candidate),
}));

const { repoTeamChanged } = await import("./internal.js");

beforeEach(() => {
  team.mockReset().mockResolvedValue("platform");
  chunkSchemaOrOrgShared.mockReset().mockResolvedValue("platform");
  relocateLegacyChunks.mockReset().mockResolvedValue({ moved: 0, dropped: 0 });
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("repoTeamChanged", () => {
  it("relocates legacy chunks into the schema resolved from the team read from lore.repos", async () => {
    relocateLegacyChunks.mockResolvedValue({ moved: 5, dropped: 7 });

    await repoTeamChanged({ repo: "re-cinq/lore" });

    expect(team).toHaveBeenCalledWith("re-cinq/lore");
    expect(chunkSchemaOrOrgShared).toHaveBeenCalledWith(
      expect.anything(),
      "platform",
    );
    expect(relocateLegacyChunks).toHaveBeenCalledWith(
      "platform",
      "re-cinq/lore",
    );
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("moved 5 of 7 legacy org_shared rows"),
    );
  });

  it("logs when only stale duplicates were dropped and stays silent on a clean repo", async () => {
    relocateLegacyChunks.mockResolvedValueOnce({ moved: 0, dropped: 2 });
    await repoTeamChanged({ repo: "re-cinq/lore" });

    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("moved 0 of 2 legacy org_shared rows"),
    );

    vi.mocked(console.log).mockClear();
    await repoTeamChanged({ repo: "re-cinq/lore" });

    expect(relocateLegacyChunks).toHaveBeenCalledTimes(2);
    expect(console.log).not.toHaveBeenCalled();
  });

  it("does nothing when resolution falls back to org_shared", async () => {
    chunkSchemaOrOrgShared.mockResolvedValue("org_shared");

    await repoTeamChanged({ repo: "re-cinq/lore" });

    expect(relocateLegacyChunks).not.toHaveBeenCalled();
  });

  it("passes an unprovisioned or null team through the resolver rather than gating locally", async () => {
    team.mockResolvedValue(null);
    chunkSchemaOrOrgShared.mockResolvedValue("org_shared");

    await repoTeamChanged({ repo: "re-cinq/lore" });

    expect(chunkSchemaOrOrgShared).toHaveBeenCalledWith(
      expect.anything(),
      null,
    );
    expect(relocateLegacyChunks).not.toHaveBeenCalled();
  });

  it("propagates a relocation error so the event loop retries the idempotent move", async () => {
    relocateLegacyChunks.mockRejectedValue(new Error("connection reset"));

    await expect(repoTeamChanged({ repo: "re-cinq/lore" })).rejects.toThrow(
      "connection reset",
    );
  });
});

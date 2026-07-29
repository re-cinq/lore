import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const team = vi.fn<(repo: string) => Promise<string | null>>();
const schemaExists = vi.fn<(schema: string) => Promise<boolean>>();
const relocateLegacyChunks =
  vi.fn<
    (
      schema: string,
      repo: string,
    ) => Promise<{ moved: number; dropped: number }>
  >();

vi.mock("../kernel/queues.js", () => ({
  settings: () => ({ team }),
  chunks: () => ({ schemaExists, relocateLegacyChunks }),
  assemblyLines: () => ({}),
}));

const { repoTeamChanged } = await import("./internal.js");

beforeEach(() => {
  team.mockReset().mockResolvedValue("platform");
  schemaExists.mockReset().mockResolvedValue(true);
  relocateLegacyChunks.mockReset().mockResolvedValue({ moved: 0, dropped: 0 });
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("repoTeamChanged", () => {
  it("relocates legacy chunks into the provisioned team schema read from lore.repos", async () => {
    relocateLegacyChunks.mockResolvedValue({ moved: 5, dropped: 7 });

    await repoTeamChanged({ repo: "re-cinq/lore" });

    expect(team).toHaveBeenCalledWith("re-cinq/lore");
    expect(relocateLegacyChunks).toHaveBeenCalledWith(
      "platform",
      "re-cinq/lore",
    );
  });

  it("does nothing when the repo has no team", async () => {
    team.mockResolvedValue(null);

    await repoTeamChanged({ repo: "re-cinq/lore" });

    expect(relocateLegacyChunks).not.toHaveBeenCalled();
  });

  it("does nothing when the team is org_shared or injection-shaped", async () => {
    team.mockResolvedValueOnce("org_shared");
    await repoTeamChanged({ repo: "re-cinq/lore" });

    team.mockResolvedValueOnce("a; DROP TABLE");
    await repoTeamChanged({ repo: "re-cinq/lore" });

    expect(relocateLegacyChunks).not.toHaveBeenCalled();
  });

  it("does nothing when the team schema is not provisioned", async () => {
    team.mockResolvedValue("infra");
    schemaExists.mockResolvedValue(false);

    await repoTeamChanged({ repo: "re-cinq/lore" });

    expect(schemaExists).toHaveBeenCalledWith("infra");
    expect(relocateLegacyChunks).not.toHaveBeenCalled();
  });
});

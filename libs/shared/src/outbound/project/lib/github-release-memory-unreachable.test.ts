import { describe, it, expect } from "vitest";
import { InMemoryGitHubReleases } from "./github-release-memory.js";

describe("InMemoryGitHubReleases unreachable repositories", () => {
  it("rejects the LORE_MIRROR read of re-cinq/lore-mirror with status 404 when the App cannot reach it", async () => {
    const releases = new InMemoryGitHubReleases();

    releases.seedUnreachable("re-cinq/lore-mirror");

    await expect(
      releases.repoVariable("re-cinq/lore-mirror", "LORE_MIRROR"),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("still answers true for re-cinq/lore-other when only re-cinq/lore-mirror is unreachable", async () => {
    const releases = new InMemoryGitHubReleases();

    releases.seedVariable("re-cinq/lore-other", "LORE_MIRROR", "true");
    releases.seedUnreachable("re-cinq/lore-mirror");

    expect(
      await releases.repoVariable("re-cinq/lore-other", "LORE_MIRROR"),
    ).toBe("true");
  });
});

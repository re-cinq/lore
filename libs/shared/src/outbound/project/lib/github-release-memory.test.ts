import { describe, it, expect } from "vitest";
import { InMemoryGitHubReleases } from "./github-release-memory.js";

const REPO = "re-cinq/lore";
const SHA = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";

describe("InMemoryGitHubReleases", () => {
  it("answers null for tag v1.0.0 when no release was created", async () => {
    expect(
      await new InMemoryGitHubReleases().releaseByTag(REPO, "v1.0.0"),
    ).toBe(null);
  });

  it("answers the created release for v1.0.0 with its notes", async () => {
    const releases = new InMemoryGitHubReleases();
    const created = await releases.createRelease(REPO, {
      tag: "v1.0.0",
      name: "v1.0.0",
      body: "First",
    });

    expect(await releases.releaseByTag(REPO, "v1.0.0")).toEqual({
      id: created.id,
      tag: "v1.0.0",
      name: "v1.0.0",
      body: "First",
      draft: false,
      url: created.url,
    });
  });

  it("refuses a second release for v1.0.0 in the same repo", async () => {
    const releases = new InMemoryGitHubReleases();
    const input = { tag: "v1.0.0", name: "v1.0.0", body: "First" };

    await releases.createRelease(REPO, input);

    await expect(releases.createRelease(REPO, input)).rejects.toThrow(
      new Error("release for tag v1.0.0 already exists in re-cinq/lore"),
    );
  });

  it("keeps the same tag in another repo apart", async () => {
    const releases = new InMemoryGitHubReleases();

    await releases.createRelease(REPO, { tag: "v1.0.0", name: "a", body: "a" });

    expect(await releases.releaseByTag("re-cinq/other", "v1.0.0")).toBe(null);
  });

  it("rewrites the notes of release v1.0.0 and leaves its name", async () => {
    const releases = new InMemoryGitHubReleases();
    const created = await releases.createRelease(REPO, {
      tag: "v1.0.0",
      name: "Lore 1.0",
      body: "old",
    });

    expect(
      await releases.updateRelease(REPO, created.id, { body: "new" }),
    ).toMatchObject({ tag: "v1.0.0", name: "Lore 1.0", body: "new" });
  });

  it("refuses to update release 99 that does not exist", async () => {
    await expect(
      new InMemoryGitHubReleases().updateRelease(REPO, 99, { body: "x" }),
    ).rejects.toThrow(new Error("no release 99 in re-cinq/lore"));
  });

  it("creates tag v1.0.0 at a1b2 and lists it", async () => {
    const releases = new InMemoryGitHubReleases();

    await releases.createTagRef(REPO, "v1.0.0", SHA);

    expect(releases.tagsOf(REPO)).toEqual({ "v1.0.0": SHA });
  });

  it("refuses tag v1.0.0 a second time and keeps the first sha", async () => {
    const releases = new InMemoryGitHubReleases();

    await releases.createTagRef(REPO, "v1.0.0", SHA);

    await expect(releases.createTagRef(REPO, "v1.0.0", "ffff")).rejects.toThrow(
      new Error("tag v1.0.0 already exists in re-cinq/lore"),
    );
    expect(releases.tagsOf(REPO)).toEqual({ "v1.0.0": SHA });
  });

  it("answers null for variable LORE_MIRROR when none was set", async () => {
    expect(
      await new InMemoryGitHubReleases().repoVariable(REPO, "LORE_MIRROR"),
    ).toBe(null);
  });

  it("answers true for variable LORE_MIRROR once seeded with true", async () => {
    const releases = new InMemoryGitHubReleases();

    releases.seedVariable(REPO, "LORE_MIRROR", "true");

    expect(await releases.repoVariable(REPO, "LORE_MIRROR")).toBe("true");
  });
});

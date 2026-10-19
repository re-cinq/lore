import { describe, it, expect } from "vitest";
import type { MirrorOutcome } from "@re-cinq/lore-shared/utopia/mirror-document.js";
import { mirrorReleases, type ReleaseDeps } from "./utopia-releases.js";

const RELEASE = {
  tag: "v1.2.0",
  name: "Lore 1.2",
  body: "",
  author: "gedaiu",
  publishedAt: "2026-10-17T09:00:00Z",
};

function deps(outcome: () => MirrorOutcome) {
  const mirrored: Array<{ tags: string[]; releases: string[] }> = [];
  const releaseDeps: ReleaseDeps = {
    repo: "re-cinq/lore",
    published: {
      tags: async () => [
        { name: "v1.1.0", sha: "abc" },
        { name: "v1.2.0", sha: "def" },
      ],
      releases: async () => [RELEASE],
    },
    mirror: async (published) => {
      mirrored.push({
        tags: published.tags.map((tag) => tag.name),
        releases: published.releases.map((release) => release.tag),
      });

      return outcome();
    },
  };

  return { releaseDeps, mirrored };
}

describe("mirrorReleases", () => {
  it("pushes the repo's two tags and its one published release in one mirror, and answers the counts", async () => {
    const { releaseDeps, mirrored } = deps(() => ({
      items: 3,
      created: 2,
      updated: 0,
      unchanged: 1,
      failed: [],
    }));

    expect({
      summary: await mirrorReleases(releaseDeps),
      mirrored,
    }).toEqual({
      summary: {
        tags: 2,
        releases: 1,
        created: 2,
        updated: 0,
        unchanged: 1,
        failed: [],
      },
      mirrored: [{ tags: ["v1.1.0", "v1.2.0"], releases: ["v1.2.0"] }],
    });
  });

  it("names every item Utopia refused under failed while the others land", async () => {
    const { releaseDeps } = deps(() => ({
      items: 3,
      created: 2,
      updated: 0,
      unchanged: 0,
      failed: ["tag:v1.1.0: Utopia answered 503"],
    }));

    expect((await mirrorReleases(releaseDeps)).failed).toEqual([
      "tag:v1.1.0: Utopia answered 503",
    ]);
  });

  it("names the push under failed when it threw, so a backfill still answers", async () => {
    const { releaseDeps } = deps(() => {
      throw new Error("Utopia answered 401");
    });

    expect(await mirrorReleases(releaseDeps)).toEqual({
      tags: 2,
      releases: 1,
      created: 0,
      updated: 0,
      unchanged: 0,
      failed: ["releases: Utopia answered 401"],
    });
  });
});

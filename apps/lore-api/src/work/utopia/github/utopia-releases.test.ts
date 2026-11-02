import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import type { MirrorOutcome } from "@re-cinq/lore-shared/utopia/push-items.js";
import {
  poolHoldingSources,
  SETTINGS_WITH_BASE,
  startFakeUtopia,
} from "../walk-wiring.fixtures.js";

vi.mock("../../../outbound/project-boot.js", () => ({
  projectFor: async () => ({
    settings: { rawSettings: async () => SETTINGS_WITH_BASE },
  }),
}));

import {
  mirrorReleases,
  releaseDepsFor,
  type ReleaseDeps,
} from "./utopia-releases.js";

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

describe("releaseDepsFor", () => {
  let utopia: Awaited<ReturnType<typeof startFakeUtopia>>;

  beforeAll(async () => {
    utopia = await startFakeUtopia();
  });

  afterAll(() => utopia.stop());

  it("posts tag v1.2.0 and release v1.2.0 as text documents to the github source and as statements to the test-coverage source", async () => {
    const deps = releaseDepsFor({
      pool: poolHoldingSources(["github", "test-coverage"]),
      repo: "re-cinq/lore",
      files: { tags: async () => [], releases: async () => [] },
      settings: { rawSettings: async () => SETTINGS_WITH_BASE },
    });

    await deps.mirror({
      tags: [{ name: "v1.2.0", sha: "def" }],
      releases: [RELEASE],
    });

    expect([...utopia.pushes].sort()).toEqual([
      "/api/v1/sources/src-github/ingest release:v1.2.0",
      "/api/v1/sources/src-github/ingest tag:v1.2.0",
      "/api/v1/sources/src-test-coverage/statements release:v1.2.0",
      "/api/v1/sources/src-test-coverage/statements tag:v1.2.0",
    ]);
  });
});

import { describe, expect, it } from "vitest";
import type { Tools } from "@re-cinq/floor-station";
import { InMemoryGitHubReleases } from "@re-cinq/lore-shared/project/lib/github-release-memory.js";
import { releaseTagHandle, NOT_A_TAG_REQUEST } from "./station.js";

const REPO = "re-cinq/lore";
const RELEASE_SHA = "bbb222";

function scene(bumpFile: string) {
  const github = new InMemoryGitHubReleases();
  const tools: Tools = {
    read: () => Promise.resolve(Buffer.from(bumpFile)),
    produce: () => Promise.resolve(),
    modelCall: () => Promise.resolve(),
    signal: new AbortController().signal,
  };
  const handle = releaseTagHandle({
    tagSha: async (repo, tag) => github.tagsOf(repo)[tag] ?? null,
    createTag: (repo, tag, sha) => github.createTagRef(repo, tag, sha),
  });

  return { github, tools, handle };
}

const brief = (needs: Record<string, string>) => ({
  visitId: "0b0e6b1e-0000-4000-8000-000000000004",
  iteration: 1,
  needs: { release_repo: REPO, release_sha: RELEASE_SHA, ...needs },
});

describe("the release-tag station", () => {
  it("tags v1.3.0 at bbb222 for v1.2.4 and a minor bump, producing the version and the kind", async () => {
    const { github, tools, handle } = scene('{"bump":"minor"}');
    const report = await handle(brief({ previous_tag: "v1.2.4" }), tools);

    expect({ report, tags: github.tagsOf(REPO) }).toEqual({
      report: {
        outcome: "success",
        produced: { release_version: "v1.3.0", release_bump_kind: "minor" },
      },
      tags: { "v1.3.0": RELEASE_SHA },
    });
  });

  it("tags v0.1.0 for a repo with no previous tag", async () => {
    const { github, tools, handle } = scene('{"bump":"major"}');
    const report = await handle(brief({}), tools);

    expect({ report, tags: github.tagsOf(REPO) }).toEqual({
      report: {
        outcome: "success",
        produced: { release_version: "v0.1.0", release_bump_kind: "major" },
      },
      tags: { "v0.1.0": RELEASE_SHA },
    });
  });

  it("answers success without a second write when v1.3.0 already sits at bbb222", async () => {
    const { github, tools, handle } = scene('{"bump":"minor"}');

    await github.createTagRef(REPO, "v1.3.0", RELEASE_SHA);
    const report = await handle(brief({ previous_tag: "v1.2.4" }), tools);

    expect({ report, tags: github.tagsOf(REPO) }).toEqual({
      report: {
        outcome: "success",
        produced: { release_version: "v1.3.0", release_bump_kind: "minor" },
      },
      tags: { "v1.3.0": RELEASE_SHA },
    });
  });

  it("fails naming both commits when v1.3.0 sits at ccc333, and writes nothing", async () => {
    const { github, tools, handle } = scene('{"bump":"minor"}');

    await github.createTagRef(REPO, "v1.3.0", "ccc333");
    const report = await handle(brief({ previous_tag: "v1.2.4" }), tools);

    expect({ report, tags: github.tagsOf(REPO) }).toEqual({
      report: {
        outcome: "failed",
        error: "tag v1.3.0 already sits at ccc333, not at bbb222",
      },
      tags: { "v1.3.0": "ccc333" },
    });
  });

  it("requests changes with the parser reason for Minor, and creates no tag", async () => {
    const { github, tools, handle } = scene('{"bump":"Minor"}');
    const report = await handle(brief({ previous_tag: "v1.2.4" }), tools);

    expect({ report, tags: github.tagsOf(REPO) }).toEqual({
      report: {
        outcome: "changes_requested",
        error: "bump must be major, minor or patch",
      },
      tags: {},
    });
  });

  it("requests changes for an empty bump file, and creates no tag", async () => {
    const { github, tools, handle } = scene("");
    const report = await handle(brief({ previous_tag: "v1.2.4" }), tools);

    expect({ report, tags: github.tagsOf(REPO) }).toEqual({
      report: {
        outcome: "changes_requested",
        error: "the classification is not valid JSON",
      },
      tags: {},
    });
  });

  it("fails when previous_tag is nightly, which is not a version, and creates no tag", async () => {
    const { github, tools, handle } = scene('{"bump":"patch"}');
    const report = await handle(brief({ previous_tag: "nightly" }), tools);

    expect({ report, tags: github.tagsOf(REPO) }).toEqual({
      report: {
        outcome: "failed",
        error: "last release tag nightly is not of the form vX.Y.Z",
      },
      tags: {},
    });
  });

  it("fails when the run carries no release_sha", async () => {
    const { tools, handle } = scene('{"bump":"patch"}');

    expect(
      await handle(
        {
          visitId: "0b0e6b1e-0000-4000-8000-000000000005",
          iteration: 1,
          needs: { release_repo: REPO },
        },
        tools,
      ),
    ).toEqual({ outcome: "failed", error: NOT_A_TAG_REQUEST });
  });
});

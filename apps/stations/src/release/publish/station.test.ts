import { describe, expect, it } from "vitest";
import type { Tools } from "@re-cinq/floor-station";
import { InMemoryGitHubReleases } from "@re-cinq/lore-shared/project/lib/github-release-memory.js";
import { InMemorySettings } from "@re-cinq/lore-shared/project/settings/settings-memory.js";
import { repoCloneUrl } from "@re-cinq/lore-shared/project/workspace/git-auth.js";
import { InMemoryPulls } from "@re-cinq/lore-shared/project/pulls/pull-requests-memory.js";
import {
  syncMirrorMain,
  type TokenPermissions,
} from "@re-cinq/lore-shared/release/mirror-sync.js";
import { InMemoryMirrorPush } from "@re-cinq/lore-shared/project/workspace/mirror-push-memory.js";
import type { MirrorPushPort } from "@re-cinq/lore-shared/project/workspace/mirror-push-port.js";
import { releasePublishHandle } from "./station.js";

const SOURCE = "re-cinq/lore-security";
const MIRROR = "re-cinq/lore";
const SHA = "bbb222";
const VERSION = "v1.3.0";
const MIRROR_URL = repoCloneUrl(MIRROR);
const SOURCE_URL = repoCloneUrl(SOURCE);

function scene(options: { mirror?: string; push?: MirrorPushPort } = {}) {
  const mirrorPush = new InMemoryMirrorPush();
  const tokenRequests: Array<{ repo: string; permissions: unknown }> = [];
  const pulls = new InMemoryPulls();
  const mintToken = async (repo: string, permissions: TokenPermissions) => {
    tokenRequests.push({ repo, permissions });

    return `token-for-${repo}`;
  };
  const { mirror = MIRROR } = options;
  const releases = new InMemoryGitHubReleases();
  const settings = new InMemorySettings([
    { full_name: SOURCE, settings: mirror ? { public_mirror: mirror } : {} },
  ]);
  const handle = releasePublishHandle({
    settings,
    releases,
    mintToken,
    mirrorPush: () => options.push ?? mirrorPush,
    syncMirror: (repo) =>
      syncMirrorMain(
        {
          settings,
          pulls,
          defaultBranch: async () => "main",
          mintToken,
          mirrorPush: () => mirrorPush,
        },
        repo,
      ),
  });

  const tools: Tools = {
    read: () => Promise.resolve(Buffer.from("")),
    produce: () => Promise.resolve(),
    modelCall: () => Promise.resolve(),
    signal: new AbortController().signal,
  };

  return { handle, tools, releases, mirrorPush, tokenRequests, pulls };
}

const brief = (needs: Record<string, string> = {}) => ({
  visitId: "0b0e6b1e-0000-4000-8000-000000000010",
  iteration: 1,
  needs: {
    release_repo: SOURCE,
    release_sha: SHA,
    release_version: VERSION,
    ...needs,
  },
});

describe("the release-publish station", () => {
  it("succeeds producing nothing for a repo with no public_mirror, and pushes and mints nothing", async () => {
    const { handle, tools, mirrorPush, tokenRequests } = scene({ mirror: "" });

    expect({
      report: await handle(brief(), tools),
      target: mirrorPush.targetOf(MIRROR_URL),
      tokenRequests,
    }).toEqual({
      report: { outcome: "success" },
      target: { head: null, tags: {} },
      tokenRequests: [],
    });
  });

  it("fails asking to set LORE_MIRROR on re-cinq/lore when the variable read answers null, and pushes nothing", async () => {
    const { handle, tools, mirrorPush } = scene();

    expect({
      report: await handle(brief(), tools),
      target: mirrorPush.targetOf(MIRROR_URL),
    }).toEqual({
      report: {
        outcome: "failed",
        error:
          "re-cinq/lore has no Actions variable LORE_MIRROR: set it to true on that repository, and check the GitHub App is installed on it with Contents, Workflows and Variables access",
      },
      target: { head: null, tags: {} },
    });
  });

  it("fails naming the value false when LORE_MIRROR is false on re-cinq/lore, and pushes nothing", async () => {
    const { handle, tools, releases, mirrorPush, tokenRequests } = scene();

    releases.seedVariable(MIRROR, "LORE_MIRROR", "false");

    expect({
      report: await handle(brief(), tools),
      target: mirrorPush.targetOf(MIRROR_URL),
      tokenRequests,
    }).toMatchObject({
      report: {
        outcome: "failed",
        error: expect.stringContaining("LORE_MIRROR is false, not true"),
      },
      target: { head: null, tags: {} },
      tokenRequests: [],
    });
  });

  it("fails naming the missing installation when the App cannot read re-cinq/lore, and pushes nothing", async () => {
    const { handle, tools, releases, mirrorPush } = scene();

    releases.seedUnreachable(MIRROR);

    expect({
      report: await handle(brief(), tools),
      target: mirrorPush.targetOf(MIRROR_URL),
    }).toEqual({
      report: {
        outcome: "failed",
        error:
          "the GitHub App cannot read re-cinq/lore: install it on that repository with Contents, Workflows and Variables access",
      },
      target: { head: null, tags: {} },
    });
  });

  it("pushes bbb222 and v1.3.0 to an empty mirror with a read token for the source and a contents and workflows write token for the mirror", async () => {
    const { handle, tools, releases, mirrorPush, tokenRequests } = scene();

    releases.seedVariable(MIRROR, "LORE_MIRROR", "true");

    expect({
      report: await handle(brief(), tools),
      target: mirrorPush.targetOf(MIRROR_URL),
      tokenRequests,
    }).toEqual({
      report: { outcome: "success", produced: { published_to: MIRROR } },
      target: { head: SHA, tags: { [VERSION]: SHA } },
      tokenRequests: [
        { repo: SOURCE, permissions: { contents: "read" } },
        {
          repo: MIRROR,
          permissions: { contents: "write", workflows: "write" },
        },
      ],
    });
  });

  it("answers success with published_to on a second identical publish and leaves the mirror as it was", async () => {
    const { handle, tools, releases, mirrorPush } = scene();

    releases.seedVariable(MIRROR, "LORE_MIRROR", "true");
    await handle(brief(), tools);

    expect({
      report: await handle(brief(), tools),
      target: mirrorPush.targetOf(MIRROR_URL),
    }).toEqual({
      report: { outcome: "success", produced: { published_to: MIRROR } },
      target: { head: SHA, tags: { [VERSION]: SHA } },
    });
  });

  it("fails naming the sync pull request and a merge commit when re-cinq/lore main ddd444 is not an ancestor of bbb222, leaving the mirror as it was", async () => {
    const { handle, tools, releases, mirrorPush, pulls } = scene();
    const held = { head: "ddd444", tags: {} };

    releases.seedVariable(MIRROR, "LORE_MIRROR", "true");
    mirrorPush.seedTarget(MIRROR_URL, held);
    mirrorPush.seedTarget(SOURCE_URL, { head: "aaa111", tags: {} });
    mirrorPush.seedHistory("bbb222", ["aaa111"]);

    expect({
      report: await handle(brief(), tools),
      target: mirrorPush.targetOf(MIRROR_URL),
      opened: (await pulls.listByHead(SOURCE, "sync/public-main")).length,
    }).toEqual({
      report: {
        outcome: "failed",
        error:
          "the public main holds commits this repository lacks; merge https://github.com/re-cinq/lore-security/pull/1 with a merge commit, then release again",
      },
      target: held,
      opened: 1,
    });
  });

  it("fails naming re-cinq/lore and ddd444 with the mirror left as it was when the sync branch holds foreign commits and no pull request exists", async () => {
    const { handle, tools, releases, mirrorPush } = scene();

    releases.seedVariable(MIRROR, "LORE_MIRROR", "true");
    mirrorPush.seedTarget(MIRROR_URL, { head: "ddd444", tags: {} });
    mirrorPush.seedTarget(SOURCE_URL, { head: "aaa111", tags: {} });
    mirrorPush.seedBranch(SOURCE_URL, "sync/public-main", "x9");

    expect(await handle(brief(), tools)).toEqual({
      outcome: "failed",
      error:
        "re-cinq/lore main is at ddd444, which is not an ancestor of bbb222 from re-cinq/lore-security; the mirror was left as it was",
    });
  });

  it("fails naming v1.3.0 and ccc333 when the tag sits there on re-cinq/lore, leaving the mirror as it was", async () => {
    const { handle, tools, releases, mirrorPush } = scene();
    const held = { head: null, tags: { [VERSION]: "ccc333" } };

    releases.seedVariable(MIRROR, "LORE_MIRROR", "true");
    mirrorPush.seedTarget(MIRROR_URL, held);

    expect({
      report: await handle(brief(), tools),
      target: mirrorPush.targetOf(MIRROR_URL),
    }).toEqual({
      report: {
        outcome: "failed",
        error:
          "tag v1.3.0 already sits at ccc333 on re-cinq/lore, not at bbb222 from re-cinq/lore-security; the mirror was left as it was",
      },
      target: held,
    });
  });

  it("fails with the git message when the push throws", async () => {
    const { handle, tools, releases } = scene({
      push: {
        push: () => Promise.reject(new Error("git fetch failed")),
        pullBranch: () => Promise.reject(new Error("git fetch failed")),
      },
    });

    releases.seedVariable(MIRROR, "LORE_MIRROR", "true");

    expect(await handle(brief(), tools)).toEqual({
      outcome: "failed",
      error: "git fetch failed",
    });
  });

  it("fails naming release_sha when the run carries no release_sha", async () => {
    const { handle, tools } = scene();
    const { release_sha: _sha, ...needs } = brief().needs;

    expect(await handle({ ...brief(), needs }, tools)).toEqual({
      outcome: "failed",
      error: "the run lacks release_sha",
    });
  });
});

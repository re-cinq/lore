import { enforceTrue } from "../../lib/enforce.js";
import { describe, expect, it } from "vitest";
import { InMemoryPulls } from "../../outbound/project/pulls/pull-requests-memory.js";
import type { PullRef } from "../../outbound/project/pulls/pull-requests-port.js";
import { InMemorySettings } from "../../outbound/project/settings/settings-memory.js";
import { repoCloneUrl } from "../../outbound/project/workspace/git-auth.js";
import { InMemoryMirrorPush } from "../../outbound/project/workspace/mirror-push-memory.js";
import type { MirrorPullOutcome } from "../../outbound/project/workspace/mirror-push-port.js";
import {
  decideMirrorSync,
  mirrorOf,
  NOT_A_MERGE_COMMIT_MARKER,
  syncMirrorMain,
  type MirrorSyncDeps,
  type TokenPermissions,
} from "./mirror-sync.js";

const PRIVATE = "acme/private-app";
const MIRROR = "acme/public-app";
const PRIVATE_URL = repoCloneUrl(PRIVATE);
const PUBLIC_URL = repoCloneUrl(MIRROR);
const SYNC = "sync/public-main";
const MERGE_PARAGRAPH =
  "Merge this pull request with a merge commit. A squash or a rebase makes new commits: the public main is then still not part of this branch's history, and the next release cannot fast-forward the public repository.";

function scene(options: { mirror?: string | null } = {}) {
  const { mirror = MIRROR } = options;
  const mirrorPush = new InMemoryMirrorPush();
  const pulls = new InMemoryPulls();
  const tokenRequests: Array<{ repo: string; permissions: TokenPermissions }> =
    [];
  const deps: MirrorSyncDeps = {
    settings: new InMemorySettings([
      {
        full_name: PRIVATE,
        settings: mirror ? { public_mirror: mirror } : {},
      },
    ]),
    pulls,
    defaultBranch: async () => "main",
    mintToken: async (repo, permissions) => {
      tokenRequests.push({ repo, permissions });

      return `token-${repo}`;
    },
    mirrorPush: () => mirrorPush,
  };

  mirrorPush.seedTarget(PUBLIC_URL, { head: "p3", tags: {} });
  mirrorPush.seedTarget(PRIVATE_URL, { head: "c1", tags: {} });
  mirrorPush.seedHistory("p3", ["p2", "c1"]);
  mirrorPush.seedAhead(PUBLIC_URL, [
    { sha: "p3aaaaaaaa", subject: "third change" },
    { sha: "p2bbbbbbbb", subject: "second change" },
  ]);

  return { deps, mirrorPush, pulls, tokenRequests };
}

const pullRef = (state: PullRef["state"], headSha?: string): PullRef => ({
  repo: PRIVATE,
  number: 4,
  title: "t",
  branch: SYNC,
  state,
  labels: [],
  url: "https://github.com/acme/private-app/pull/4",
  headSha,
});

describe("decideMirrorSync", () => {
  const pushed: MirrorPullOutcome = {
    kind: "pushed",
    publicHead: "p3",
    ahead: 2,
    commits: [],
    mergedHeadOutsideTarget: false,
  };
  const squashed: MirrorPullOutcome = {
    ...pushed,
    kind: "already-pushed",
    mergedHeadOutsideTarget: true,
  };

  it("answers nothing when the public main is in sync", () => {
    expect(
      decideMirrorSync({
        pull: { kind: "in-sync" },
        openPr: null,
        lastMergedSync: null,
      }),
    ).toEqual("nothing");
  });

  it("answers open-pr when the branch was pushed and no pull request is open", () => {
    expect(
      decideMirrorSync({ pull: pushed, openPr: null, lastMergedSync: null }),
    ).toEqual("open-pr");
  });

  it("answers pr-already-open when a pull request is open from the sync branch", () => {
    expect(
      decideMirrorSync({
        pull: pushed,
        openPr: pullRef("open"),
        lastMergedSync: null,
      }),
    ).toEqual("pr-already-open");
  });

  it("answers report-branch-diverged when the sync branch holds foreign commits", () => {
    expect(
      decideMirrorSync({
        pull: { kind: "branch-diverged", branchHead: "x9" },
        openPr: null,
        lastMergedSync: null,
      }),
    ).toEqual("report-branch-diverged");
  });

  it("answers report-not-a-merge-commit when the newest sync pull request merged its head outside the private main", () => {
    expect(
      decideMirrorSync({
        pull: squashed,
        openPr: null,
        lastMergedSync: pullRef("merged", "p3"),
      }),
    ).toEqual("report-not-a-merge-commit");
  });

  it("answers open-pr when the merged sync pull request head is inside the private main", () => {
    expect(
      decideMirrorSync({
        pull: pushed,
        openPr: null,
        lastMergedSync: pullRef("merged", "p1"),
      }),
    ).toEqual("open-pr");
  });
});

describe("mirrorOf", () => {
  it("returns acme/public-app for settings with public_mirror, and null for none, null or a non-string", () => {
    expect([
      mirrorOf({ public_mirror: MIRROR }),
      mirrorOf({}),
      mirrorOf(null),
      mirrorOf({ public_mirror: 3 }),
    ]).toEqual([MIRROR, null, null, null]);
  });
});

describe("syncMirrorMain", () => {
  it("opens one pull request into main titled with the mirror, listing both commits and the merge commit paragraph", async () => {
    const { deps, pulls } = scene();
    const result = await syncMirrorMain(deps, PRIVATE);

    expect({
      kind: result.decision,
      url: result.pullRequestUrl,
      opened: await pulls.listByHead(PRIVATE, SYNC),
    }).toMatchObject({
      kind: "open-pr",
      url: "https://github.com/acme/private-app/pull/1",
      opened: [
        {
          title: "Merge public main (acme/public-app) into main",
          baseBranch: "main",
          body: [
            "The public main of acme/public-app holds 2 commits that this branch does not.",
            "Commits, newest first:\n- p3aaaaa third change\n- p2bbbbb second change",
            MERGE_PARAGRAPH,
          ].join("\n\n"),
        },
      ],
    });
  });

  it("opens no second pull request on a second run and points at the open one", async () => {
    const { deps, pulls } = scene();

    await syncMirrorMain(deps, PRIVATE);
    const second = await syncMirrorMain(deps, PRIVATE);

    expect({
      decision: second.decision,
      url: second.pullRequestUrl,
      count: (await pulls.listByHead(PRIVATE, SYNC)).length,
    }).toEqual({
      decision: "pr-already-open",
      url: "https://github.com/acme/private-app/pull/1",
      count: 1,
    });
  });

  it("names how many more commits there are when 25 are ahead and 20 are listed", async () => {
    const { deps, mirrorPush, pulls } = scene();

    mirrorPush.seedAhead(
      PUBLIC_URL,
      Array.from({ length: 25 }, (_, index) => ({
        sha: `s${String(index).padStart(6, "0")}`,
        subject: `change ${index}`,
      })),
    );
    await syncMirrorMain(deps, PRIVATE);

    expect((await pulls.listByHead(PRIVATE, SYNC))[0].body).toMatch(
      /holds 25 commits[\s\S]*- s000019 change 19\nand 5 more\n\nMerge this/,
    );
  });

  it("does nothing and mints no token for a repository with no public_mirror", async () => {
    const { deps, pulls, tokenRequests, mirrorPush } = scene({ mirror: null });

    expect({
      result: await syncMirrorMain(deps, PRIVATE),
      pulls: await pulls.listByHead(PRIVATE, SYNC),
      tokenRequests,
      branch: mirrorPush.branchOf(PRIVATE_URL, SYNC),
    }).toEqual({
      result: { decision: "no-mirror" },
      pulls: [],
      tokenRequests: [],
      branch: null,
    });
  });

  it("reads the public repository with contents read and writes the private branch with contents and workflows write", async () => {
    const { deps, tokenRequests } = scene();

    await syncMirrorMain(deps, PRIVATE);

    expect(tokenRequests).toEqual([
      { repo: MIRROR, permissions: { contents: "read" } },
      {
        repo: PRIVATE,
        permissions: { contents: "write", workflows: "write" },
      },
    ]);
  });

  it("opens no pull request and reports the diverged branch when someone pushed to the sync branch", async () => {
    const { deps, mirrorPush, pulls } = scene();

    mirrorPush.seedBranch(PRIVATE_URL, SYNC, "x9");

    expect({
      result: await syncMirrorMain(deps, PRIVATE),
      pulls: await pulls.listByHead(PRIVATE, SYNC),
    }).toEqual({
      result: {
        decision: "report-branch-diverged",
        pull: { kind: "branch-diverged", branchHead: "x9" },
      },
      pulls: [],
    });
  });

  it("does nothing when the public main is already on the private main", async () => {
    const { deps, mirrorPush, pulls } = scene();

    mirrorPush.seedTarget(PRIVATE_URL, { head: "m9", tags: {} });
    mirrorPush.seedHistory("m9", ["p3"]);

    expect({
      result: await syncMirrorMain(deps, PRIVATE),
      pulls: await pulls.listByHead(PRIVATE, SYNC),
    }).toEqual({
      result: { decision: "nothing", pull: { kind: "in-sync" } },
      pulls: [],
    });
  });

  it("posts a comment naming the merge commit on pull request 1 and opens pull request 2 when pull request 1 was merged at p2 outside the private main", async () => {
    const { deps, pulls } = scene();

    await syncMirrorMain(deps, PRIVATE);
    pulls.seedMerged(PRIVATE, 1, "p2");
    const result = await syncMirrorMain(deps, PRIVATE);
    const [comment] = await pulls.listIssueComments(PRIVATE, 1);

    expect({
      decision: result.decision,
      url: result.pullRequestUrl,
      comment: comment.body,
    }).toEqual({
      decision: "report-not-a-merge-commit",
      url: "https://github.com/acme/private-app/pull/2",
      comment: `${NOT_A_MERGE_COMMIT_MARKER}\nThis pull request was merged with a squash or a rebase, which makes new commits: the public commits are not in this branch's history. A new pull request from ${SYNC} has been opened and must be merged with a merge commit.`,
    });
  });

  it("posts the squash comment once when opening the new pull request failed on the first run and succeeded on the second", async () => {
    const { deps, pulls } = scene();
    let failOpening = false;
    const flaky: MirrorSyncDeps = {
      ...deps,
      pulls: {
        listByHead: (repo, branch) => pulls.listByHead(repo, branch),
        comment: (repo, number, body) => pulls.comment(repo, number, body),
        listIssueComments: (repo, number) =>
          pulls.listIssueComments(repo, number),
        open: async (repo, branch, draft) => {
          enforceTrue(!failOpening, Error, "GitHub is down");

          return pulls.open(repo, branch, draft);
        },
      },
    };

    await syncMirrorMain(flaky, PRIVATE);
    pulls.seedMerged(PRIVATE, 1, "p2");
    failOpening = true;
    await expect(syncMirrorMain(flaky, PRIVATE)).rejects.toThrow(
      new Error("GitHub is down"),
    );
    failOpening = false;
    await syncMirrorMain(flaky, PRIVATE);

    expect({
      comments: (await pulls.listIssueComments(PRIVATE, 1)).length,
      numbers: (await pulls.listByHead(PRIVATE, SYNC)).map(
        ({ number }) => number,
      ),
    }).toEqual({ comments: 1, numbers: [2, 1] });
  });
});

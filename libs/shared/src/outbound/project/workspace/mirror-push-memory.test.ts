import { describe, it, expect } from "vitest";
import { InMemoryMirrorPush } from "./mirror-push-memory.js";
import type {
  MirrorPullRequest,
  MirrorPushRequest,
} from "./mirror-push-port.js";

const request: MirrorPushRequest = {
  sourceUrl: "source",
  sourceAuthArgs: [],
  targetUrl: "target",
  targetAuthArgs: [],
  sha: "c2",
  tag: "v1.0.0",
};

describe("InMemoryMirrorPush", () => {
  it("moves target main to c2 and creates v1.0.0 when c1 is an ancestor of c2", async () => {
    const mirror = new InMemoryMirrorPush();

    mirror.seedTarget("target", { head: "c1", tags: {} });
    mirror.seedHistory("c2", ["c1"]);

    expect({
      outcome: await mirror.push(request),
      target: mirror.targetOf("target"),
    }).toEqual({
      outcome: { kind: "pushed", sha: "c2", tag: "v1.0.0" },
      target: { head: "c2", tags: { "v1.0.0": "c2" } },
    });
  });

  it("answers already up to date on a second identical push", async () => {
    const mirror = new InMemoryMirrorPush();

    mirror.seedHistory("c2", ["c1"]);
    await mirror.push(request);

    expect(await mirror.push(request)).toEqual({
      kind: "already-up-to-date",
      sha: "c2",
      tag: "v1.0.0",
    });
  });

  it("leaves target main at x9 when it is not an ancestor of c2", async () => {
    const mirror = new InMemoryMirrorPush();

    mirror.seedTarget("target", { head: "x9", tags: {} });
    mirror.seedHistory("c2", ["c1"]);

    expect({
      outcome: await mirror.push(request),
      target: mirror.targetOf("target"),
    }).toEqual({
      outcome: { kind: "target-diverged", targetHead: "x9" },
      target: { head: "x9", tags: {} },
    });
  });

  it("refuses and moves nothing when v1.0.0 sits at c1", async () => {
    const mirror = new InMemoryMirrorPush();

    mirror.seedTarget("target", { head: "c1", tags: { "v1.0.0": "c1" } });
    mirror.seedHistory("c2", ["c1"]);

    expect({
      outcome: await mirror.push(request),
      target: mirror.targetOf("target"),
    }).toEqual({
      outcome: { kind: "tag-at-other-sha", tagSha: "c1" },
      target: { head: "c1", tags: { "v1.0.0": "c1" } },
    });
  });
});

describe("InMemoryMirrorPush.pullBranch", () => {
  const pullRequest: MirrorPullRequest = {
    sourceUrl: "public",
    sourceAuthArgs: [],
    targetUrl: "private",
    targetAuthArgs: [],
    branch: "sync/public-main",
  };
  const aheadCommits = [
    { sha: "p3", subject: "third" },
    { sha: "p2", subject: "second" },
  ];

  function scene(): InMemoryMirrorPush {
    const mirror = new InMemoryMirrorPush();

    mirror.seedTarget("public", { head: "p3", tags: {} });
    mirror.seedTarget("private", { head: "c1", tags: {} });
    mirror.seedHistory("p3", ["p2", "c1"]);
    mirror.seedAhead("public", aheadCommits);

    return mirror;
  }

  it("creates sync/public-main at p3 and reports ahead 2 for a public main two commits ahead of c1", async () => {
    const mirror = scene();

    expect({
      outcome: await mirror.pullBranch(pullRequest),
      branch: mirror.branchOf("private", "sync/public-main"),
    }).toEqual({
      outcome: {
        kind: "pushed",
        publicHead: "p3",
        ahead: 2,
        commits: aheadCommits,
        mergedHeadOutsideTarget: false,
      },
      branch: "p3",
    });
  });

  it("answers already-pushed on the second pull", async () => {
    const mirror = scene();

    await mirror.pullBranch(pullRequest);

    expect(await mirror.pullBranch(pullRequest)).toMatchObject({
      kind: "already-pushed",
      publicHead: "p3",
    });
  });

  it("answers in-sync and creates no branch when p3 is an ancestor of the private head", async () => {
    const mirror = scene();

    mirror.seedTarget("private", { head: "m9", tags: {} });
    mirror.seedHistory("m9", ["p3"]);

    expect({
      outcome: await mirror.pullBranch(pullRequest),
      branch: mirror.branchOf("private", "sync/public-main"),
    }).toEqual({ outcome: { kind: "in-sync" }, branch: null });
  });

  it("answers branch-diverged naming x9 and keeps the branch when it is not an ancestor of p3", async () => {
    const mirror = scene();

    mirror.seedBranch("private", "sync/public-main", "x9");

    expect({
      outcome: await mirror.pullBranch(pullRequest),
      branch: mirror.branchOf("private", "sync/public-main"),
    }).toEqual({
      outcome: { kind: "branch-diverged", branchHead: "x9" },
      branch: "x9",
    });
  });

  it("flags merged head p2 as outside the private head c1", async () => {
    expect(
      await scene().pullBranch({ ...pullRequest, mergedHead: "p2" }),
    ).toMatchObject({ mergedHeadOutsideTarget: true });
  });
});

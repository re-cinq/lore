import { describe, it, expect } from "vitest";
import { decideMirrorPull, decideMirrorPush } from "./mirror-push-verdict.js";

const SHA = "a1b2c3";

describe("decideMirrorPush", () => {
  it("pushes when the target is empty and has no tag", () => {
    expect(
      decideMirrorPush({
        sha: SHA,
        targetHead: null,
        targetHeadIsAncestor: false,
        targetTagSha: null,
      }),
    ).toEqual({ kind: "push" });
  });

  it("pushes when the target head d4e5 is an ancestor of a1b2c3 and has no tag", () => {
    expect(
      decideMirrorPush({
        sha: SHA,
        targetHead: "d4e5",
        targetHeadIsAncestor: true,
        targetTagSha: null,
      }),
    ).toEqual({ kind: "push" });
  });

  it("pushes the tag alone when the target head is already a1b2c3 and the tag is absent", () => {
    expect(
      decideMirrorPush({
        sha: SHA,
        targetHead: SHA,
        targetHeadIsAncestor: true,
        targetTagSha: null,
      }),
    ).toEqual({ kind: "push" });
  });

  it("pushes when the tag already sits at a1b2c3 but the target head d4e5 is behind", () => {
    expect(
      decideMirrorPush({
        sha: SHA,
        targetHead: "d4e5",
        targetHeadIsAncestor: true,
        targetTagSha: SHA,
      }),
    ).toEqual({ kind: "push" });
  });

  it("is already up to date when the target head and the tag are both a1b2c3", () => {
    expect(
      decideMirrorPush({
        sha: SHA,
        targetHead: SHA,
        targetHeadIsAncestor: true,
        targetTagSha: SHA,
      }),
    ).toEqual({ kind: "already-up-to-date" });
  });

  it("refuses with target-diverged d4e5 when d4e5 is not an ancestor of a1b2c3", () => {
    expect(
      decideMirrorPush({
        sha: SHA,
        targetHead: "d4e5",
        targetHeadIsAncestor: false,
        targetTagSha: null,
      }),
    ).toEqual({ kind: "target-diverged", targetHead: "d4e5" });
  });

  it("refuses with tag-at-other-sha f6a7 when the tag sits at f6a7", () => {
    expect(
      decideMirrorPush({
        sha: SHA,
        targetHead: "d4e5",
        targetHeadIsAncestor: true,
        targetTagSha: "f6a7",
      }),
    ).toEqual({ kind: "tag-at-other-sha", tagSha: "f6a7" });
  });

  it("names the tag conflict first when the head is diverged and the tag sits at f6a7", () => {
    expect(
      decideMirrorPush({
        sha: SHA,
        targetHead: "d4e5",
        targetHeadIsAncestor: false,
        targetTagSha: "f6a7",
      }),
    ).toEqual({ kind: "tag-at-other-sha", tagSha: "f6a7" });
  });
});

describe("decideMirrorPull", () => {
  const facts = {
    publicHead: "p1",
    publicHeadIsOnTarget: false,
    branchHead: null,
    branchHeadIsOnPublic: false,
  };

  it("answers in-sync when public head p1 is already on the private main", () => {
    expect(
      decideMirrorPull({
        ...facts,
        publicHeadIsOnTarget: true,
        branchHead: "b1",
      }),
    ).toEqual({ kind: "in-sync" });
  });

  it("pushes when public head p1 is not on the private main and the sync branch is absent", () => {
    expect(decideMirrorPull(facts)).toEqual({ kind: "push" });
  });

  it("pushes when the sync branch sits at b0, an ancestor of public head p1", () => {
    expect(
      decideMirrorPull({
        ...facts,
        branchHead: "b0",
        branchHeadIsOnPublic: true,
      }),
    ).toEqual({ kind: "push" });
  });

  it("answers already-pushed when the sync branch already sits at public head p1", () => {
    expect(
      decideMirrorPull({
        ...facts,
        branchHead: "p1",
        branchHeadIsOnPublic: true,
      }),
    ).toEqual({ kind: "already-pushed" });
  });

  it("answers branch-diverged naming x9 when the sync branch holds a commit the public main lacks", () => {
    expect(decideMirrorPull({ ...facts, branchHead: "x9" })).toEqual({
      kind: "branch-diverged",
      branchHead: "x9",
    });
  });
});

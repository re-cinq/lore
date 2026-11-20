import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitMirrorPush } from "./mirror-push-git.js";
import type {
  MirrorPullRequest,
  MirrorPushRequest,
} from "./mirror-push-port.js";

const IDENTITY = {
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@t",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@t",
};
const env = { ...process.env, ...IDENTITY };

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, env, encoding: "utf8" }).trim();
}

function commit(workDir: string, file: string): string {
  writeFileSync(join(workDir, file), file);
  git(workDir, "add", "-A");
  git(workDir, "commit", "-m", file);

  return git(workDir, "rev-parse", "HEAD");
}

function refsOf(bareDir: string): string {
  return git(bareDir, "for-each-ref");
}

describe("GitMirrorPush (real bare repositories)", () => {
  let base: string;
  let sourceBare: string;
  let targetBare: string;
  let work: string;
  let firstSha: string;
  let secondSha: string;
  let request: MirrorPushRequest;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "mirror-push-"));
    sourceBare = join(base, "source.git");
    targetBare = join(base, "target.git");
    work = join(base, "work");
    git(base, "init", "--bare", "-b", "main", sourceBare);
    git(base, "init", "--bare", "-b", "main", targetBare);
    git(base, "clone", sourceBare, work);
    git(work, "checkout", "-b", "main");
    firstSha = commit(work, "one.txt");
    git(work, "push", "origin", "main");
    git(work, "push", targetBare, "main");
    secondSha = commit(work, "two.txt");
    git(work, "push", "origin", "main");
    request = {
      sourceUrl: sourceBare,
      sourceAuthArgs: [],
      targetUrl: targetBare,
      targetAuthArgs: [],
      sha: secondSha,
      tag: "v1.0.0",
    };
  });

  afterEach(() => rmSync(base, { recursive: true, force: true }));

  const mirror = () => new GitMirrorPush(join(base, "cache.git"), env);

  it("moves the target's main to the second commit and creates v1.0.0 there on a clean push", async () => {
    const outcome = await mirror().push(request);

    expect({
      outcome,
      main: git(targetBare, "rev-parse", "refs/heads/main"),
      tag: git(targetBare, "rev-parse", "refs/tags/v1.0.0"),
    }).toEqual({
      outcome: { kind: "pushed", sha: secondSha, tag: "v1.0.0" },
      main: secondSha,
      tag: secondSha,
    });
  });

  it("pushes into an empty target and creates its main and v1.0.0", async () => {
    const emptyTarget = join(base, "empty.git");

    git(base, "init", "--bare", "-b", "main", emptyTarget);
    const outcome = await mirror().push({
      ...request,
      targetUrl: emptyTarget,
    });

    expect({
      outcome,
      main: git(emptyTarget, "rev-parse", "refs/heads/main"),
    }).toEqual({
      outcome: { kind: "pushed", sha: secondSha, tag: "v1.0.0" },
      main: secondSha,
    });
  });

  it("answers already up to date and changes no ref when the same push runs twice", async () => {
    await mirror().push(request);
    const refsAfterFirst = refsOf(targetBare);
    const outcome = await mirror().push(request);

    expect({ outcome, refs: refsOf(targetBare) }).toEqual({
      outcome: { kind: "already-up-to-date", sha: secondSha, tag: "v1.0.0" },
      refs: refsAfterFirst,
    });
  });

  it("refuses with target-diverged and leaves the target's refs unchanged when the target holds a commit the source lacks", async () => {
    const other = join(base, "other");

    git(base, "clone", targetBare, other);
    const divergedHead = commit(other, "extra.txt");

    git(other, "push", "origin", "main");
    const refsBefore = refsOf(targetBare);
    const outcome = await mirror().push(request);

    expect({ outcome, refs: refsOf(targetBare) }).toEqual({
      outcome: { kind: "target-diverged", targetHead: divergedHead },
      refs: refsBefore,
    });
  });

  it("refuses with tag-at-other-sha and moves neither ref when v1.0.0 sits at the first commit on the target", async () => {
    git(work, "tag", "v1.0.0", firstSha);
    git(work, "push", targetBare, "refs/tags/v1.0.0");
    git(work, "tag", "-d", "v1.0.0");
    const refsBefore = refsOf(targetBare);
    const outcome = await mirror().push(request);

    expect({ outcome, refs: refsOf(targetBare) }).toEqual({
      outcome: { kind: "tag-at-other-sha", tagSha: firstSha },
      refs: refsBefore,
    });
  });

  it("fails with a git ls-remote error free of the token when the target cannot be reached", async () => {
    const message = await mirror()
      .push({
        ...request,
        targetUrl: join(base, "missing.git"),
        targetAuthArgs: ["-c", "http.extraheader=Authorization: Basic S3CR3T"],
      })
      .then(
        () => "no error",
        (error: Error) => error.message,
      );

    expect(message).toMatch(/^git ls-remote failed: (?!.*S3CR3T)/s);
  });
});

describe("GitMirrorPush.pullBranch (real bare repositories)", () => {
  let base: string;
  let publicBare: string;
  let privateBare: string;
  let publicWork: string;
  let privateWork: string;
  let request: MirrorPullRequest;

  const SYNC = "sync/public-main";
  const publicHead = () => git(publicBare, "rev-parse", "refs/heads/main");
  const syncHead = () => git(privateBare, "rev-parse", `refs/heads/${SYNC}`);
  const refsOfPrivate = () => refsOf(privateBare);
  const mirror = () => new GitMirrorPush(join(base, "cache.git"), env);

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "mirror-pull-"));
    publicBare = join(base, "public.git");
    privateBare = join(base, "private.git");
    publicWork = join(base, "public-work");
    privateWork = join(base, "private-work");
    git(base, "init", "--bare", "-b", "main", publicBare);
    git(base, "init", "--bare", "-b", "main", privateBare);
    git(base, "clone", publicBare, publicWork);
    git(publicWork, "checkout", "-b", "main");
    commit(publicWork, "base.txt");
    git(publicWork, "push", "origin", "main");
    git(publicWork, "push", privateBare, "main");
    commit(publicWork, "public-one.txt");
    commit(publicWork, "public-two.txt");
    git(publicWork, "push", "origin", "main");
    git(base, "clone", privateBare, privateWork);
    request = {
      sourceUrl: publicBare,
      sourceAuthArgs: [],
      targetUrl: privateBare,
      targetAuthArgs: [],
      branch: SYNC,
    };
  });

  afterEach(() => rmSync(base, { recursive: true, force: true }));

  it("pushes sync/public-main at the public head and reports ahead 2 with both subjects for a public main 2 commits ahead", async () => {
    const outcome = await mirror().pullBranch(request);

    expect({ outcome, branch: syncHead() }).toEqual({
      outcome: {
        kind: "pushed",
        publicHead: publicHead(),
        ahead: 2,
        commits: [
          { sha: publicHead(), subject: "public-two.txt" },
          {
            sha: git(publicBare, "rev-parse", "main~1"),
            subject: "public-one.txt",
          },
        ],
        mergedHeadOutsideTarget: false,
      },
      branch: publicHead(),
    });
  });

  it("answers already-pushed with the same payload and changes no ref when the pull runs twice", async () => {
    const first = await mirror().pullBranch(request);
    const refsAfterFirst = refsOfPrivate();
    const second = await mirror().pullBranch(request);

    expect({ second, refs: refsOfPrivate() }).toEqual({
      second: { ...first, kind: "already-pushed" },
      refs: refsAfterFirst,
    });
  });

  it("fast-forwards sync/public-main to a third public commit and reports ahead 3", async () => {
    await mirror().pullBranch(request);
    commit(publicWork, "public-three.txt");
    git(publicWork, "push", "origin", "main");
    const outcome = await mirror().pullBranch(request);

    expect({ kind: outcome.kind, branch: syncHead() }).toEqual({
      kind: "pushed",
      branch: publicHead(),
    });
    expect(outcome).toMatchObject({ ahead: 3 });
  });

  it("answers in-sync and creates no branch when the public main is an ancestor of the private main", async () => {
    commit(privateWork, "private-only.txt");
    git(privateWork, "fetch", publicBare, "main");
    git(privateWork, "merge", "--no-edit", "FETCH_HEAD");
    git(privateWork, "push", "origin", "main");
    const refsBefore = refsOfPrivate();
    const outcome = await mirror().pullBranch(request);

    expect({ outcome, refs: refsOfPrivate() }).toEqual({
      outcome: { kind: "in-sync" },
      refs: refsBefore,
    });
  });

  it("answers branch-diverged naming the foreign commit and leaves the sync branch unchanged when someone pushed to it", async () => {
    await mirror().pullBranch(request);
    git(privateWork, "fetch", "origin", SYNC);
    git(privateWork, "checkout", "-b", "foreign", "FETCH_HEAD");
    const foreignHead = commit(privateWork, "foreign.txt");

    git(privateWork, "push", "origin", `foreign:${SYNC}`);
    const outcome = await mirror().pullBranch(request);

    expect({ outcome, branch: syncHead() }).toEqual({
      outcome: { kind: "branch-diverged", branchHead: foreignHead },
      branch: foreignHead,
    });
  });

  it("answers in-sync and lets the release push fast-forward the public main after the sync branch is merged with a merge commit", async () => {
    await mirror().pullBranch(request);
    git(privateWork, "fetch", "origin", SYNC);
    git(privateWork, "merge", "--no-ff", "-m", "merge public", "FETCH_HEAD");
    git(privateWork, "push", "origin", "main");
    const privateHead = git(privateBare, "rev-parse", "refs/heads/main");
    const pulled = await mirror().pullBranch(request);
    const pushed = await mirror().push({
      sourceUrl: privateBare,
      sourceAuthArgs: [],
      targetUrl: publicBare,
      targetAuthArgs: [],
      sha: privateHead,
      tag: "v2.0.0",
    });

    expect({ pulled, pushed, public: publicHead() }).toEqual({
      pulled: { kind: "in-sync" },
      pushed: { kind: "pushed", sha: privateHead, tag: "v2.0.0" },
      public: privateHead,
    });
  });

  it("reports the public head as not in sync and the merged head as outside the private main after a squash of the sync branch", async () => {
    await mirror().pullBranch(request);
    const mergedHead = syncHead();

    git(privateWork, "fetch", "origin", SYNC);
    git(privateWork, "merge", "--squash", "FETCH_HEAD");
    git(privateWork, "commit", "-m", "squashed public");
    git(privateWork, "push", "origin", "main");
    const outcome = await mirror().pullBranch({ ...request, mergedHead });

    expect(outcome).toMatchObject({
      kind: "already-pushed",
      publicHead: publicHead(),
      mergedHeadOutsideTarget: true,
    });
  });

  it("reports the merged head as inside the private main after a merge commit and a later public commit", async () => {
    await mirror().pullBranch(request);
    const mergedHead = syncHead();

    git(privateWork, "fetch", "origin", SYNC);
    git(privateWork, "merge", "--no-ff", "-m", "merge public", "FETCH_HEAD");
    git(privateWork, "push", "origin", "main");
    commit(publicWork, "public-three.txt");
    git(publicWork, "push", "origin", "main");
    const outcome = await mirror().pullBranch({ ...request, mergedHead });

    expect(outcome).toMatchObject({
      kind: "pushed",
      ahead: 1,
      mergedHeadOutsideTarget: false,
    });
  });
});

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitMirrorPush } from "./mirror-push-git.js";
import type { MirrorPushRequest } from "./mirror-push-port.js";

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

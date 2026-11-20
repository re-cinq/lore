import type { MirrorGitRunner } from "./mirror-git-runner.js";
import type {
  MirrorCommit,
  MirrorPulled,
  MirrorPullOutcome,
  MirrorPullRequest,
} from "./mirror-push-port.js";
import {
  decideMirrorPull,
  type MirrorPullFacts,
} from "./mirror-push-verdict.js";

const MAX_LISTED_COMMITS = 20;
const MAIN = "refs/heads/main";

interface PullHeads {
  publicHead: string;
  privateHead: string;
  facts: MirrorPullFacts;
}

/** Copies the public main to the sync branch of the private repository when the private main lacks it; fast-forward only. */
export async function pullBranchWith(
  runner: MirrorGitRunner,
  request: MirrorPullRequest,
): Promise<MirrorPullOutcome> {
  const heads = await gatherHeads(runner, request);
  const verdict = decideMirrorPull(heads.facts);

  if (verdict.kind === "in-sync" || verdict.kind === "branch-diverged") {
    return verdict;
  }
  const pulled = await describePulled(runner, request, heads);

  if (verdict.kind === "push") {
    await publishBranch(runner, request, heads.publicHead);
  }

  return {
    kind: verdict.kind === "push" ? "pushed" : "already-pushed",
    ...pulled,
  };
}

async function gatherHeads(
  runner: MirrorGitRunner,
  request: MirrorPullRequest,
): Promise<PullHeads> {
  const { sourceUrl, sourceAuthArgs, targetUrl, targetAuthArgs } = request;

  await runner.ensureCache();
  const publicHead = await runner.fetchHead(sourceUrl, sourceAuthArgs, MAIN);
  const privateHead = await runner.fetchHead(targetUrl, targetAuthArgs, MAIN);
  const branchHead = await syncBranchHead(runner, request);
  const facts = await factsOf(runner, publicHead, privateHead, branchHead);

  return { publicHead, privateHead, facts };
}

async function factsOf(
  runner: MirrorGitRunner,
  publicHead: string,
  privateHead: string,
  branchHead: string | null,
): Promise<MirrorPullFacts> {
  return {
    publicHead,
    publicHeadIsOnTarget: await runner.isAncestor(publicHead, privateHead),
    branchHead,
    branchHeadIsOnPublic:
      branchHead !== null && (await runner.isAncestor(branchHead, publicHead)),
  };
}

async function syncBranchHead(
  runner: MirrorGitRunner,
  { targetUrl, targetAuthArgs, branch }: MirrorPullRequest,
): Promise<string | null> {
  const ref = `refs/heads/${branch}`;
  const exists = await runner.remoteRef(targetUrl, targetAuthArgs, ref);

  return exists ? runner.fetchHead(targetUrl, targetAuthArgs, ref) : null;
}

async function publishBranch(
  runner: MirrorGitRunner,
  request: MirrorPullRequest,
  publicHead: string,
): Promise<void> {
  const refspec = `${publicHead}:refs/heads/${request.branch}`;

  await runner.git(["push", "--atomic", request.targetUrl, refspec], {
    authArgs: request.targetAuthArgs,
  });
}

async function describePulled(
  runner: MirrorGitRunner,
  request: MirrorPullRequest,
  { publicHead, privateHead }: PullHeads,
): Promise<MirrorPulled> {
  const range = [publicHead, `^${privateHead}`];

  return {
    publicHead,
    ahead: Number(await runner.git(["rev-list", "--count", ...range])),
    commits: await aheadCommits(runner, range),
    mergedHeadOutsideTarget: await isOutside(
      runner,
      request.mergedHead,
      privateHead,
    ),
  };
}

async function aheadCommits(
  runner: MirrorGitRunner,
  range: string[],
): Promise<MirrorCommit[]> {
  const listing = await runner.git([
    "log",
    `-${MAX_LISTED_COMMITS}`,
    "--format=%H%x09%s",
    ...range,
  ]);

  return listing.split("\n").filter(Boolean).map(commitOf);
}

async function isOutside(
  runner: MirrorGitRunner,
  sha: string | undefined,
  privateHead: string,
): Promise<boolean> {
  const known =
    sha !== undefined &&
    (await runner.exitCodeOf(["cat-file", "-e", `${sha}^{commit}`])) === 0;

  return known && !(await runner.isAncestor(sha, privateHead));
}

function commitOf(line: string): MirrorCommit {
  const [sha, ...subject] = line.split("\t");

  return { sha, subject: subject.join("\t") };
}

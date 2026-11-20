// Commits on the public main come back to the private main through one pull request (specs/public-mirror): the public main is copied to a sync branch of the private repository and merged there with a merge commit, never pushed to the default branch.
import { enforceTrue } from "../../lib/enforce.js";
import type { SettingsPort } from "../../outbound/project/settings/settings-port.js";
import type {
  PullRef,
  SyncPulls,
} from "../../outbound/project/pulls/pull-requests-port.js";
import {
  gitAuthArgs,
  repoCloneUrl,
} from "../../outbound/project/workspace/git-auth.js";
import type {
  MirrorPulled,
  MirrorPullOutcome,
  MirrorPushPort,
} from "../../outbound/project/workspace/mirror-push-port.js";

export const SYNC_BRANCH = "sync/public-main";
export const NOT_A_MERGE_COMMIT_MARKER =
  "<!-- lore-mirror-sync: not-a-merge-commit -->";

const MAX_LISTED_COMMITS = 20;
const MERGE_COMMIT_PARAGRAPH =
  "Merge this pull request with a merge commit. A squash or a rebase makes new commits: the public main is then still not part of this branch's history, and the next release cannot fast-forward the public repository.";

export type TokenPermissions = Record<string, "read" | "write">;

export interface MirrorSyncDeps {
  settings: Pick<SettingsPort, "rawSettings">;
  pulls: SyncPulls;
  defaultBranch(repo: string): Promise<string>;
  mintToken(repo: string, permissions: TokenPermissions): Promise<string>;
  mirrorPush(repo: string): MirrorPushPort;
}

export type MirrorSyncDecision =
  | "nothing"
  | "open-pr"
  | "pr-already-open"
  | "report-branch-diverged"
  | "report-not-a-merge-commit";

export interface MirrorSyncResult {
  decision: MirrorSyncDecision | "no-mirror";
  pull?: MirrorPullOutcome;
  /** The pull request that carries the public commits, opened now or already open. */
  pullRequestUrl?: string;
}

/** The mirror a private repository publishes to, null when its settings name none. */
export function mirrorOf(
  settings: Record<string, unknown> | null,
): string | null {
  const mirror = settings?.public_mirror;

  return typeof mirror === "string" ? mirror : null;
}

export function decideMirrorSync(facts: {
  pull: MirrorPullOutcome;
  openPr: PullRef | null;
  lastMergedSync: PullRef | null;
}): MirrorSyncDecision {
  const { pull, openPr, lastMergedSync } = facts;

  if (pull.kind === "in-sync") {
    return "nothing";
  }

  if (pull.kind === "branch-diverged") {
    return "report-branch-diverged";
  }

  if (openPr) {
    return "pr-already-open";
  }

  return lastMergedSync && pull.mergedHeadOutsideTarget
    ? "report-not-a-merge-commit"
    : "open-pr";
}

export function syncPullBody(mirror: string, pulled: MirrorPulled): string {
  const listed = pulled.commits.slice(0, MAX_LISTED_COMMITS);
  const more = pulled.ahead - listed.length;
  const lines = listed.map(
    ({ sha, subject }) => `- ${sha.slice(0, 7)} ${subject}`,
  );
  const counted = pulled.ahead === 1 ? "1 commit" : `${pulled.ahead} commits`;

  return [
    `The public main of ${mirror} holds ${counted} that this branch does not.`,
    [
      "Commits, newest first:",
      ...lines,
      ...(more > 0 ? [`and ${more} more`] : []),
    ].join("\n"),
    MERGE_COMMIT_PARAGRAPH,
  ].join("\n\n");
}

interface SyncContext {
  repo: string;
  mirror: string;
  pull: MirrorPullOutcome;
  openPr: PullRef | null;
  lastMergedSync: PullRef | null;
}

/** Reads the mirror from the repository's own settings and brings the public commits to a pull request; a repository without a mirror is left alone. */
export async function syncMirrorMain(
  deps: MirrorSyncDeps,
  repo: string,
): Promise<MirrorSyncResult> {
  const mirror = mirrorOf(await deps.settings.rawSettings(repo));

  if (mirror === null) {
    return { decision: "no-mirror" };
  }
  const { openPr, lastMergedSync } = await syncPullsOf(deps, repo);
  const pull = await pullPublicMain(deps, repo, mirror, lastMergedSync);
  const context = { repo, mirror, pull, openPr, lastMergedSync };
  const decision = decideMirrorSync(context);

  return {
    decision,
    pull,
    pullRequestUrl: await carryOut(deps, decision, context),
  };
}

async function syncPullsOf(
  deps: MirrorSyncDeps,
  repo: string,
): Promise<Pick<SyncContext, "openPr" | "lastMergedSync">> {
  const syncPulls = await deps.pulls.listByHead(repo, SYNC_BRANCH);
  const newest = syncPulls.at(0);

  return {
    openPr: syncPulls.find(({ state }) => state === "open") ?? null,
    lastMergedSync: newest?.state === "merged" ? newest : null,
  };
}

async function pullPublicMain(
  deps: MirrorSyncDeps,
  repo: string,
  mirror: string,
  lastMergedSync: PullRef | null,
): Promise<MirrorPullOutcome> {
  const [publicToken, privateToken] = await Promise.all([
    deps.mintToken(mirror, { contents: "read" }),
    deps.mintToken(repo, { contents: "write", workflows: "write" }),
  ]);

  return deps.mirrorPush(repo).pullBranch({
    sourceUrl: repoCloneUrl(mirror),
    sourceAuthArgs: gitAuthArgs(publicToken),
    targetUrl: repoCloneUrl(repo),
    targetAuthArgs: gitAuthArgs(privateToken),
    branch: SYNC_BRANCH,
    mergedHead: lastMergedSync?.headSha,
  });
}

async function carryOut(
  deps: MirrorSyncDeps,
  decision: MirrorSyncDecision,
  context: SyncContext,
): Promise<string | undefined> {
  if (decision === "pr-already-open") {
    return context.openPr?.url;
  }

  if (decision === "report-not-a-merge-commit") {
    await commentOnce(deps, context.repo, context.lastMergedSync);
  }

  return decision === "open-pr" || decision === "report-not-a-merge-commit"
    ? openSyncPull(deps, context)
    : undefined;
}

async function openSyncPull(
  deps: MirrorSyncDeps,
  { repo, mirror, pull }: SyncContext,
): Promise<string | undefined> {
  if (pull.kind !== "pushed" && pull.kind !== "already-pushed") {
    return undefined;
  }
  const base = await deps.defaultBranch(repo);
  const opened = await deps.pulls.open(repo, SYNC_BRANCH, {
    title: `Merge public main (${mirror}) into ${base}`,
    body: syncPullBody(mirror, pull),
    base,
  });

  return opened.url;
}

async function commentOnce(
  deps: MirrorSyncDeps,
  repo: string,
  merged: PullRef | null,
): Promise<void> {
  enforceTrue(merged, Error, "a squash is reported against a merged pull");
  const { number } = merged;
  const comments = await deps.pulls.listIssueComments(repo, number);

  if (comments.some(({ body }) => body.includes(NOT_A_MERGE_COMMIT_MARKER))) {
    return;
  }
  await deps.pulls.comment(
    repo,
    number,
    `${NOT_A_MERGE_COMMIT_MARKER}\nThis pull request was merged with a squash or a rebase, which makes new commits: the public commits are not in this branch's history. A new pull request from ${SYNC_BRANCH} has been opened and must be merged with a merge commit.`,
  );
}

import type { Octokit } from "octokit";
import type {
  BranchHistoryOptions,
  CommitDetail,
  FileChange,
} from "./github-port.js";
import { enforceTrue } from "../../../lib/enforce.js";
import { split, defaultBranch } from "./platform-github-support.js";
import type { GitApi, ReposApi } from "./platform-github-api.js";

/** Repo tree/content/branch/commit read+write paths for PlatformGitHub. */

type ContentResponse = Awaited<
  ReturnType<Octokit["rest"]["repos"]["getContent"]>
>["data"];

export async function getFileContent(
  ok: Octokit,
  repo: string,
  path: string,
  ref?: string,
): Promise<string | null> {
  const [owner, name] = split(repo);
  const { repos } = ok.rest;

  try {
    const { data: content } = await repos.getContent({
      owner,
      repo: name,
      path,
      ...(ref ? { ref } : {}),
    });

    return decodeFileContent(content);
  } catch {
    return null;
  }
}

/** The utf-8 text of a getContent response, or null when it is not an inline file blob. */
function decodeFileContent(content: ContentResponse): string | null {
  if (!Array.isArray(content) && content.type === "file" && content.content) {
    return Buffer.from(content.content, "base64").toString("utf-8");
  }

  return null;
}

export async function listDirectory(
  ok: Octokit,
  repo: string,
  path: string,
): Promise<string[]> {
  const [owner, name] = split(repo);
  const { repos } = ok.rest;

  try {
    const { data: entries } = await repos.getContent({
      owner,
      repo: name,
      path,
    });

    return Array.isArray(entries) ? entries.map((e) => e.name) : [];
  } catch {
    return [];
  }
}

export async function listTree(
  ok: Octokit,
  repo: string,
  ref?: string,
): Promise<string[]> {
  const [owner, name] = split(repo);
  const branch = ref ?? (await defaultBranch(ok, repo));
  const { git } = ok.rest;
  const { data: tree } = await git.getTree({
    owner,
    repo: name,
    tree_sha: branch,
    recursive: "true",
  });

  return treeBlobPaths(repo, tree);
}

/** getTree is unpaginated (truncated past ~100k entries); a truncated tree must throw, not return — a partial list reads as mass deletion to the reindex prune pass. */
function treeBlobPaths(
  repo: string,
  tree: {
    truncated?: boolean;
    tree: Array<{ type?: string; path?: string }>;
  },
): string[] {
  enforceTrue(
    !tree.truncated,
    Error,
    `Recursive tree fetch for ${repo} was truncated by GitHub — refusing to return a partial file list`,
  );

  const entries = tree.tree;

  return entries
    .filter((e) => e.type === "blob" && typeof e.path === "string")
    .map((e) => e.path as string);
}

export async function commitEmailOf(
  ok: Octokit,
  repo: string,
  login: string,
): Promise<string | null> {
  const [owner, name] = split(repo);
  const { repos } = ok.rest;
  const { data: commits } = await repos.listCommits({
    owner,
    repo: name,
    author: login,
    per_page: 1,
  });
  const newest = commits.at(0);
  const author = newest?.commit.author;
  const email = author?.email ?? "";

  return email && !email.endsWith("@users.noreply.github.com") ? email : null;
}

/** The branch's commits above `until`, GitHub's newest-first pages walked until the cursor is seen (or the root without one), then the oldest `limit` read in detail and answered oldest-first, so a run that cannot finish the history leaves a cursor the next one continues from. */
export async function listBranchHistory(
  ok: Octokit,
  repo: string,
  branch: string,
  opts: BranchHistoryOptions,
): Promise<CommitDetail[]> {
  const [owner, name] = split(repo);
  const { repos } = ok.rest;
  const newestFirst = await shasAbove(ok, repo, branch, opts.until);
  const oldestFirst = newestFirst.reverse().slice(0, opts.limit);
  const details: CommitDetail[] = [];

  for (const sha of oldestFirst) {
    details.push(await commitDetail(repos, owner, name, sha));
  }

  return details;
}

async function shasAbove(
  ok: Octokit,
  repo: string,
  branch: string,
  until: string | undefined,
): Promise<string[]> {
  const [owner, name] = split(repo);
  const shas: string[] = [];

  for await (const page of ok.paginate.iterator(ok.rest.repos.listCommits, {
    owner,
    repo: name,
    sha: branch,
    per_page: 100,
  })) {
    for (const { sha } of page.data) {
      if (sha === until) {
        return shas;
      }
      shas.push(sha);
    }
  }

  return shas;
}

async function commitDetail(
  repos: ReposApi,
  owner: string,
  name: string,
  sha: string,
): Promise<CommitDetail> {
  const { data } = await repos.getCommit({ owner, repo: name, ref: sha });
  const [subject, ...rest] = data.commit.message.split("\n");

  return {
    sha: data.sha,
    parents: data.parents.map((parent) => parent.sha),
    subject: subject ?? "",
    body: rest.join("\n").trim(),
    author: data.commit.author?.name ?? "",
    authoredAt: data.commit.author?.date ?? "",
    files: (data.files ?? []).map((file) => ({
      path: file.filename,
      status: file.status,
    })),
  };
}

export async function branchExists(
  ok: Octokit,
  repo: string,
  branch: string,
): Promise<boolean> {
  const [owner, name] = split(repo);
  const { git } = ok.rest;

  try {
    await git.getRef({ owner, repo: name, ref: `heads/${branch}` });

    return true;
  } catch (err) {
    if ((err as { status?: number }).status === 404) {
      return false;
    }

    throw err;
  }
}

export async function branchMerged(
  ok: Octokit,
  repo: string,
  branch: string,
): Promise<boolean | undefined> {
  const [owner, name] = split(repo);
  const { repos } = ok.rest;

  try {
    const base = await defaultBranch(ok, repo);
    const { data: comparison } = await repos.compareCommitsWithBasehead({
      owner,
      repo: name,
      basehead: `${base}...${branch}`,
    });

    return comparison.status === "behind" || comparison.status === "identical";
  } catch {
    return undefined;
  }
}

export async function createBranch(
  ok: Octokit,
  repo: string,
  branch: string,
  base = "main",
): Promise<void> {
  const { git } = ok.rest;
  const sha = await branchHeadSha(git, repo, base);
  const create = refCreator(git, repo, branch, sha);

  try {
    await create();
  } catch (err) {
    await deleteConflictingRef(git, repo, branch, err);
    await create();
  }
}

/** The commit a branch points at; a new branch forks from its base's. */
export async function branchHeadSha(
  git: GitApi,
  repo: string,
  base: string,
): Promise<string> {
  const [owner, name] = split(repo);
  const { data: ref } = await git.getRef({
    owner,
    repo: name,
    ref: `heads/${base}`,
  });

  return ref.object.sha;
}

/** A thunk that creates `branch` at `sha`, so the same create can be retried after a conflicting ref is cleared. */
function refCreator(
  git: GitApi,
  repo: string,
  branch: string,
  sha: string,
): () => Promise<unknown> {
  const [owner, name] = split(repo);

  return () =>
    git.createRef({
      owner,
      repo: name,
      ref: `refs/heads/${branch}`,
      sha,
    });
}

/** 422 means the branch is already there. A retry of the same task must start from base again, so the old ref is deleted rather than reused — resuming on top of a half-finished attempt is how a run inherits work it never did. */
async function deleteConflictingRef(
  git: GitApi,
  repo: string,
  branch: string,
  err: unknown,
): Promise<void> {
  if ((err as { status?: number }).status !== 422) {
    throw err;
  }
  const [owner, name] = split(repo);

  await git.deleteRef({ owner, repo: name, ref: `heads/${branch}` });
}

interface BlobLocation {
  owner: string;
  name: string;
  path: string;
}

export async function commitFile(
  ok: Octokit,
  repo: string,
  branch: string,
  { path, content, message }: FileChange,
): Promise<void> {
  const [owner, name] = split(repo);
  const { repos } = ok.rest;
  const refs = [branch, "main"];
  const sha = await existingBlobSha(repos, { owner, name, path }, refs);

  await repos.createOrUpdateFileContents({
    owner,
    repo: name,
    path,
    branch,
    message,
    content: Buffer.from(content).toString("base64"),
    ...(sha ? { sha } : {}),
  });
}

/** The sha of the file as it already exists, from the first of `refs` that has it. GitHub rejects an update that does not name the blob being replaced, and main is checked after the branch so a file that exists upstream but not yet on the branch is still an UPDATE rather than a create that 422s. */
async function existingBlobSha(
  repos: ReposApi,
  loc: BlobLocation,
  refs: string[],
): Promise<string | undefined> {
  for (const ref of refs) {
    const sha = await blobShaAtRef(repos, loc, ref);

    if (sha) {
      return sha;
    }
  }

  return undefined;
}

/** The blob sha at one ref, or undefined when the path is absent or is a directory there. */
async function blobShaAtRef(
  repos: ReposApi,
  loc: BlobLocation,
  ref: string,
): Promise<string | undefined> {
  try {
    const { data: existing } = await repos.getContent({
      owner: loc.owner,
      repo: loc.name,
      path: loc.path,
      ref,
    });

    return !Array.isArray(existing) && "sha" in existing
      ? existing.sha
      : undefined;
  } catch {
    return undefined;
  }
}

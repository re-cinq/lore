import type { Octokit } from "octokit";
import type { FileChange } from "./github-port.js";
import { enforceTrue } from "../../../lib/enforce.js";
import { split, defaultBranch } from "./platform-github-support.js";

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

  try {
    const { data: content } = await ok.rest.repos.getContent({
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

  try {
    const { data: entries } = await ok.rest.repos.getContent({
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
  const { data: tree } = await ok.rest.git.getTree({
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

  return tree.tree
    .filter((e) => e.type === "blob" && typeof e.path === "string")
    .map((e) => e.path as string);
}

export async function listCommitsSince(
  ok: Octokit,
  repo: string,
  since: string,
): Promise<Array<{ sha: string; files: string[] }>> {
  const [owner, name] = split(repo);
  const commits = await ok.paginate(ok.rest.repos.listCommits, {
    owner,
    repo: name,
    since,
    per_page: 100,
  });
  const result: Array<{ sha: string; files: string[] }> = [];

  for (const c of commits) {
    result.push({ sha: c.sha, files: await commitFiles(ok, repo, c.sha) });
  }

  return result;
}

/** The changed paths of one commit; a commit whose detail cannot be read contributes none. */
async function commitFiles(
  ok: Octokit,
  repo: string,
  sha: string,
): Promise<string[]> {
  const [owner, name] = split(repo);

  try {
    const { data: detail } = await ok.rest.repos.getCommit({
      owner,
      repo: name,
      ref: sha,
    });

    return (detail.files ?? []).map((f) => f.filename);
  } catch {
    return [];
  }
}

export async function branchExists(
  ok: Octokit,
  repo: string,
  branch: string,
): Promise<boolean> {
  const [owner, name] = split(repo);

  try {
    await ok.rest.git.getRef({ owner, repo: name, ref: `heads/${branch}` });

    return true;
  } catch (err) {
    if ((err as { status?: number }).status === 404) {
      return false;
    }

    throw err;
  }
}

export async function createBranch(
  ok: Octokit,
  repo: string,
  branch: string,
  base = "main",
): Promise<void> {
  const sha = await baseSha(ok, repo, base);
  const create = refCreator(ok, repo, branch, sha);

  try {
    await create();
  } catch (err) {
    await deleteConflictingRef(ok, repo, branch, err);
    await create();
  }
}

/** The head sha of the base branch a new branch forks from. */
async function baseSha(
  ok: Octokit,
  repo: string,
  base: string,
): Promise<string> {
  const [owner, name] = split(repo);
  const { data: ref } = await ok.rest.git.getRef({
    owner,
    repo: name,
    ref: `heads/${base}`,
  });

  return ref.object.sha;
}

/** A thunk that creates `branch` at `sha`, so the same create can be retried after a conflicting ref is cleared. */
function refCreator(
  ok: Octokit,
  repo: string,
  branch: string,
  sha: string,
): () => Promise<unknown> {
  const [owner, name] = split(repo);

  return () =>
    ok.rest.git.createRef({
      owner,
      repo: name,
      ref: `refs/heads/${branch}`,
      sha,
    });
}

/** 422 means the branch is already there. A retry of the same task must start from base again, so the old ref is deleted rather than reused — resuming on top of a half-finished attempt is how a run inherits work it never did. */
async function deleteConflictingRef(
  ok: Octokit,
  repo: string,
  branch: string,
  err: unknown,
): Promise<void> {
  if ((err as { status?: number }).status !== 422) {
    throw err;
  }
  const [owner, name] = split(repo);

  await ok.rest.git.deleteRef({ owner, repo: name, ref: `heads/${branch}` });
}

interface BlobLocation {
  owner: string;
  name: string;
  path: string;
}

/** The sha of the file as it already exists, from the first of `refs` that has it. GitHub rejects an update that does not name the blob being replaced, and main is checked after the branch so a file that exists upstream but not yet on the branch is still an UPDATE rather than a create that 422s. */
async function existingBlobSha(
  ok: Octokit,
  loc: BlobLocation,
  refs: string[],
): Promise<string | undefined> {
  for (const ref of refs) {
    const sha = await blobShaAtRef(ok, loc, ref);

    if (sha) {
      return sha;
    }
  }

  return undefined;
}

/** The blob sha at one ref, or undefined when the path is absent or is a directory there. */
async function blobShaAtRef(
  ok: Octokit,
  loc: BlobLocation,
  ref: string,
): Promise<string | undefined> {
  try {
    const { data: existing } = await ok.rest.repos.getContent({
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

export async function commitFile(
  ok: Octokit,
  repo: string,
  branch: string,
  { path, content, message }: FileChange,
): Promise<void> {
  const [owner, name] = split(repo);
  const refs = [branch, "main"];
  const sha = await existingBlobSha(ok, { owner, name, path }, refs);

  await ok.rest.repos.createOrUpdateFileContents({
    owner,
    repo: name,
    path,
    branch,
    message,
    content: Buffer.from(content).toString("base64"),
    ...(sha ? { sha } : {}),
  });
}

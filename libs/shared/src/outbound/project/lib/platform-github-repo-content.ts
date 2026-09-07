import type { Octokit } from "octokit";
import type { FileChange } from "./github-port.js";
import { enforceTrue } from "../../../lib/enforce.js";
import { split, defaultBranch } from "./platform-github-support.js";

/** Repo tree/content/branch/commit read+write paths for PlatformGitHub. */

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

    if (!Array.isArray(content) && content.type === "file" && content.content) {
      return Buffer.from(content.content, "base64").toString("utf-8");
    }

    return null;
  } catch {
    return null;
  }
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
  // getTree is unpaginated (truncated past ~100k entries); a truncated tree must throw, not return — a partial list reads as mass deletion to the reindex prune pass.
  const { data: tree } = await ok.rest.git.getTree({
    owner,
    repo: name,
    tree_sha: branch,
    recursive: "true",
  });

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
    try {
      const { data: detail } = await ok.rest.repos.getCommit({
        owner,
        repo: name,
        ref: c.sha,
      });

      result.push({
        sha: c.sha,
        files: (detail.files ?? []).map((f) => f.filename),
      });
    } catch {
      result.push({ sha: c.sha, files: [] });
    }
  }

  return result;
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
  const [owner, name] = split(repo);
  const { data: ref } = await ok.rest.git.getRef({
    owner,
    repo: name,
    ref: `heads/${base}`,
  });

  const create = () =>
    ok.rest.git.createRef({
      owner,
      repo: name,
      ref: `refs/heads/${branch}`,
      sha: ref.object.sha,
    });

  try {
    await create();
  } catch (err) {
    // 422 means the branch is already there. A retry of the same task must start from base again, so the old ref is deleted rather than reused — resuming on top of a half-finished attempt is how a run inherits work it never did.
    if ((err as { status?: number }).status !== 422) {
      throw err;
    }
    await ok.rest.git.deleteRef({ owner, repo: name, ref: `heads/${branch}` });
    await create();
  }
}

/** The sha of the file as it already exists, from the first of `refs` that has it. GitHub rejects an update that does not name the blob being replaced, and main is checked after the branch so a file that exists upstream but not yet on the branch is still an UPDATE rather than a create that 422s. */
async function existingBlobSha(
  ok: Octokit,
  { owner, name, path }: { owner: string; name: string; path: string },
  refs: string[],
): Promise<string | undefined> {
  for (const ref of refs) {
    try {
      const { data: existing } = await ok.rest.repos.getContent({
        owner,
        repo: name,
        path,
        ref,
      });

      if (!Array.isArray(existing) && "sha" in existing) {
        return existing.sha;
      }
    } catch {
      /* not found on this ref */
    }
  }

  return undefined;
}

export async function commitFile(
  ok: Octokit,
  repo: string,
  branch: string,
  { path, content, message }: FileChange,
): Promise<void> {
  const [owner, name] = split(repo);
  const sha = await existingBlobSha(ok, { owner, name, path }, [
    branch,
    "main",
  ]);

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

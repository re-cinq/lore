/** Installing (or repairing) a GitHub Actions workflow file via an idempotent PR. */

import { isGitHubConfigured, octokit, split } from "./github";

const isAlreadyExists = (e: unknown): boolean =>
  (e as { status?: number }).status === 422;

/** Create the branch, or commit onto the one already there — a repeat install is a second commit, not a failure. */
async function ensureBranch(
  ok: Awaited<ReturnType<typeof octokit>>,
  at: { owner: string; name: string; branch: string; base: string },
): Promise<void> {
  const { data: baseRef } = await ok.rest.git.getRef({
    owner: at.owner,
    repo: at.name,
    ref: `heads/${at.base}`,
  });

  try {
    await ok.rest.git.createRef({
      owner: at.owner,
      repo: at.name,
      ref: `refs/heads/${at.branch}`,
      sha: baseRef.object.sha,
    });
  } catch (e) {
    if (!isAlreadyExists(e)) {
      throw e;
    }
  }
}

/** `{ sha }` when the file is already on the branch, `{}` when it is not — the shape the contents API wants for update vs create. */
async function existingBlobSha(
  ok: Awaited<ReturnType<typeof octokit>>,
  at: { owner: string; name: string; path: string; branch: string },
): Promise<{ sha?: string }> {
  try {
    const { data: contents } = await ok.rest.repos.getContent({
      owner: at.owner,
      repo: at.name,
      path: at.path,
      ref: at.branch,
    });

    return !Array.isArray(contents) && "sha" in contents
      ? { sha: contents.sha }
      : {};
  } catch {
    // file not on the branch yet — create it fresh
    return {};
  }
}

/** Opening a PR for a branch that already has one is not an error; the existing PR is the answer. */
async function openOrFindPr(
  ok: Awaited<ReturnType<typeof octokit>>,
  pr: {
    owner: string;
    name: string;
    branch: string;
    base: string;
    title: string;
    body: string;
  },
): Promise<{ url: string; number: number } | null> {
  try {
    const { data: created } = await ok.rest.pulls.create({
      owner: pr.owner,
      repo: pr.name,
      head: pr.branch,
      base: pr.base,
      title: pr.title,
      body: pr.body,
    });

    return { url: created.html_url, number: created.number };
  } catch (e) {
    if (!isAlreadyExists(e)) {
      throw e;
    }
    const { data: existing } = await ok.rest.pulls.list({
      owner: pr.owner,
      repo: pr.name,
      head: `${pr.owner}:${pr.branch}`,
      state: "open",
    });
    const found = existing[0];

    return found ? { url: found.html_url, number: found.number } : null;
  }
}

/** Open or reuse PR that installs workflow file on repo (idempotent). */
async function openWorkflowPR(
  repo: string,
  {
    path,
    content,
    branch,
    title,
    body,
  }: {
    path: string;
    content: string;
    branch: string;
    title: string;
    body: string;
  },
): Promise<{ url: string; number: number } | null> {
  if (!isGitHubConfigured()) {
    return null;
  }
  const ok = await octokit();
  const [owner, name] = split(repo);
  const { data: repoData } = await ok.rest.repos.get({ owner, repo: name });
  const base = repoData.default_branch;

  await ensureBranch(ok, { owner, name, branch, base });
  await ok.rest.repos.createOrUpdateFileContents({
    owner,
    repo: name,
    path,
    branch,
    message: `lore: install ${path}`,
    content: Buffer.from(content).toString("base64"),
    // The blob sha is required to overwrite; its absence is what makes this a create.
    ...(await existingBlobSha(ok, { owner, name, path, branch })),
  });

  return await openOrFindPr(ok, { owner, name, branch, base, title, body });
}

/** Install (or repair) the context-ingest workflow. */
export async function openIngestWorkflowPR(
  repo: string,
  path: string,
  content: string,
): Promise<{ url: string; number: number } | null> {
  return openWorkflowPR(repo, {
    path,
    content,
    branch: "lore/fix-ingest-workflow",
    title: "lore: install context ingest workflow",
    body: "This PR installs (or repairs) `.github/workflows/lore-ingest.yml` so pushes to context files trigger Lore re-ingestion.\n\nOpened from the Lore dashboard.",
  });
}

/** Install (or repair) the advisory pre-merge spec-impact workflow. */
export async function openTraceImpactWorkflowPR(
  repo: string,
  path: string,
  content: string,
): Promise<{ url: string; number: number } | null> {
  return openWorkflowPR(repo, {
    path,
    content,
    branch: "lore/fix-trace-impact-workflow",
    title: "lore: update spec-impact workflow",
    body: "This PR installs (or repairs) `.github/workflows/lore-trace-impact.yml`. The previous version computed its diff against the base-branch tip instead of the merge base, so it attributed unrelated changes to the PR; findings from it are suppressed until this lands.\n\nOpened from the Lore dashboard.",
  });
}

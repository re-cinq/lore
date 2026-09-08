/** Installing (or repairing) a GitHub Actions workflow file via an idempotent PR. */

import { isGitHubConfigured, octokit, split } from "./github-client";

const isAlreadyExists = (e: unknown): boolean =>
  (e as { status?: number }).status === 422;

type RestApi = Awaited<ReturnType<typeof octokit>>["rest"];

/** A branch that is already there is not an error — the repeat install commits onto it. */
async function createBranchRef(
  git: RestApi["git"],
  at: { owner: string; name: string; branch: string; sha: string },
): Promise<void> {
  try {
    await git.createRef({
      owner: at.owner,
      repo: at.name,
      ref: `refs/heads/${at.branch}`,
      sha: at.sha,
    });
  } catch (e) {
    if (!isAlreadyExists(e)) {
      throw e;
    }
  }
}

/** Create the branch, or commit onto the one already there — a repeat install is a second commit, not a failure. */
async function ensureBranch(
  git: RestApi["git"],
  at: { owner: string; name: string; branch: string; base: string },
): Promise<void> {
  const { owner, name, branch, base } = at;
  const { data: baseRef } = await git.getRef({
    owner,
    repo: name,
    ref: `heads/${base}`,
  });

  await createBranchRef(git, { owner, name, branch, sha: baseRef.object.sha });
}

/** `{ sha }` when the file is already on the branch, `{}` when it is not — the shape the contents API wants for update vs create. */
async function existingBlobSha(
  repos: RestApi["repos"],
  at: { owner: string; name: string; path: string; branch: string },
): Promise<{ sha?: string }> {
  try {
    const { data: contents } = await repos.getContent({
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

interface PrRef {
  url: string;
  number: number;
}

interface PrRequest {
  owner: string;
  name: string;
  branch: string;
  base: string;
  title: string;
  body: string;
}

async function createPr(
  pulls: RestApi["pulls"],
  pr: PrRequest,
): Promise<PrRef> {
  const { data: created } = await pulls.create({
    owner: pr.owner,
    repo: pr.name,
    head: pr.branch,
    base: pr.base,
    title: pr.title,
    body: pr.body,
  });

  return { url: created.html_url, number: created.number };
}

/** Opening a PR for a branch that already has one is not an error; the existing PR is the answer. */
async function openOrFindPr(
  pulls: RestApi["pulls"],
  pr: PrRequest,
): Promise<PrRef | null> {
  try {
    return await createPr(pulls, pr);
  } catch (e) {
    if (!isAlreadyExists(e)) {
      throw e;
    }

    return await findOpenPr(pulls, pr);
  }
}

/** The PR already open for this branch, if it is still open. Null rather than a throw: the caller asked for a PR to exist, and one that was opened and then closed is a state a human chose. */
async function findOpenPr(
  pulls: RestApi["pulls"],
  pr: PrRequest,
): Promise<PrRef | null> {
  const { data: existing } = await pulls.list({
    owner: pr.owner,
    repo: pr.name,
    head: `${pr.owner}:${pr.branch}`,
    state: "open",
  });
  const found = existing.at(0);

  return found ? { url: found.html_url, number: found.number } : null;
}

interface WorkflowFile {
  path: string;
  content: string;
  branch: string;
  title: string;
  body: string;
}

interface FileAt {
  owner: string;
  name: string;
  path: string;
  branch: string;
}

async function commitWorkflowFile(
  repos: RestApi["repos"],
  at: FileAt,
  content: string,
): Promise<void> {
  const { owner, name, path, branch } = at;

  await repos.createOrUpdateFileContents({
    owner,
    repo: name,
    path,
    branch,
    message: `lore: install ${path}`,
    content: Buffer.from(content).toString("base64"),
    // The blob sha is required to overwrite; its absence is what makes this a create.
    ...(await existingBlobSha(repos, at)),
  });
}

/** Open or reuse PR that installs workflow file on repo (idempotent). */
async function openWorkflowPR(
  repo: string,
  { path, content, branch, title, body }: WorkflowFile,
): Promise<PrRef | null> {
  if (!isGitHubConfigured()) {
    return null;
  }
  const { git, repos, pulls } = (await octokit()).rest;
  const [owner, name] = split(repo);
  const { data: repoData } = await repos.get({ owner, repo: name });
  const base = repoData.default_branch;

  await ensureBranch(git, { owner, name, branch, base });
  await commitWorkflowFile(repos, { owner, name, path, branch }, content);

  return await openOrFindPr(pulls, { owner, name, branch, base, title, body });
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

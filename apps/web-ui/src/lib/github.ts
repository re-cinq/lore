/** GitHub API client for web-ui (GitHub App auth, PR state visibility). */

import { Octokit } from "octokit";
import { withoutBlindRetryOnCreates } from "./octokit-retry-policy";
import { createAppAuth } from "@octokit/auth-app";

export type PRStatus =
  | "draft"
  | "open"
  | "checks-failing"
  | "changes-requested"
  | "approved"
  | "merged"
  | "closed";

export interface PRDetails {
  number: number;
  title: string;
  state: string;
  draft: boolean;
  merged: boolean;
  mergeable: boolean | null;
  html_url: string;
  checks: Array<{ name: string; status: string; conclusion: string | null }>;
  reviews: Array<{ user: string; state: string; submitted_at: string }>;
  computed_status: PRStatus;
}

function split(repo: string): [string, string] {
  const [owner, name] = repo.split("/");

  return [owner, name];
}

async function octokit(): Promise<Octokit> {
  const appId = process.env.GITHUB_APP_ID || "";
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY || "";
  const installationId = process.env.GITHUB_APP_INSTALLATION_ID || "";

  if (!appId || !privateKey || !installationId) {
    throw new Error("GitHub App credentials not configured");
  }

  return withoutBlindRetryOnCreates(
    new Octokit({
      authStrategy: createAppAuth,
      auth: { appId, privateKey, installationId },
    }),
  );
}

export function isGitHubConfigured(): boolean {
  return !!(
    process.env.GITHUB_APP_ID &&
    process.env.GITHUB_APP_PRIVATE_KEY &&
    process.env.GITHUB_APP_INSTALLATION_ID
  );
}

export function computeStatus(
  pr: { merged: boolean; state: string; draft?: boolean },
  checks: Array<{ conclusion: string | null }>,
  reviews: Array<{ state: string }>,
): PRStatus {
  if (pr.merged) {
    return "merged";
  }

  if (pr.state === "closed") {
    return "closed";
  }

  if (pr.draft) {
    return "draft";
  }

  if (
    checks.some(
      (c) => c.conclusion === "failure" || c.conclusion === "timed_out",
    )
  ) {
    return "checks-failing";
  }

  if (reviews.some((r) => r.state === "CHANGES_REQUESTED")) {
    return "changes-requested";
  }

  if (
    reviews.some((r) => r.state === "APPROVED") &&
    checks.every(
      (c) =>
        c.conclusion === "success" ||
        c.conclusion === "skipped" ||
        c.conclusion === null,
    )
  ) {
    return "approved";
  }

  return "open";
}

export type RepoAccess = "ok" | "not-found" | "unknown";

/** Probe: can App see this repo? Definitive 404 or unknown. */
export async function checkRepoAccess(repo: string): Promise<RepoAccess> {
  if (!isGitHubConfigured()) {
    return "unknown";
  }
  const ok = await octokit();
  const [owner, name] = split(repo);

  try {
    await ok.rest.repos.get({ owner, repo: name });

    return "ok";
  } catch (e) {
    return (e as { status?: number }).status === 404 ? "not-found" : "unknown";
  }
}

export interface RepoMeta {
  description: string | null;
  default_branch: string;
  html_url: string;
}

/** Check if paths exist on repo's default branch; fail-soft. */
export async function checkRepoFiles(
  repo: string,
  paths: string[],
): Promise<Record<string, boolean | null>> {
  const result: Record<string, boolean | null> = {};

  if (!isGitHubConfigured()) {
    for (const p of paths) {
      result[p] = null;
    }

    return result;
  }
  const ok = await octokit();
  const [owner, name] = split(repo);

  await Promise.all(
    paths.map(async (path) => {
      try {
        await ok.rest.repos.getContent({ owner, repo: name, path });
        result[path] = true;
      } catch (e) {
        result[path] = (e as { status?: number }).status === 404 ? false : null;
      }
    }),
  );

  return result;
}

/** Fetch decoded UTF-8 file content from repo's default branch; null on 404 or unconfigured. */
export async function getRepoFileContent(
  repo: string,
  path: string,
): Promise<string | null> {
  if (!isGitHubConfigured()) {
    return null;
  }
  const ok = await octokit();
  const [owner, name] = split(repo);

  try {
    const { data: content } = await ok.rest.repos.getContent({
      owner,
      repo: name,
      path,
    });

    if (
      Array.isArray(content) ||
      content.type !== "file" ||
      typeof content.content !== "string"
    ) {
      return null;
    }

    return Buffer.from(content.content, "base64").toString("utf-8");
  } catch (e) {
    if ((e as { status?: number }).status === 404) {
      return null;
    }
    throw e;
  }
}

const isAlreadyExists = (e: unknown): boolean =>
  (e as { status?: number }).status === 422;

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
    const { data } = await ok.rest.repos.getContent({
      owner: at.owner,
      repo: at.name,
      path: at.path,
      ref: at.branch,
    });

    return !Array.isArray(data) && "sha" in data ? { sha: data.sha } : {};
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

export async function getRepoMeta(repo: string): Promise<RepoMeta | null> {
  if (!isGitHubConfigured()) {
    return null;
  }
  const ok = await octokit();
  const [owner, name] = split(repo);
  const { data: repository } = await ok.rest.repos.get({ owner, repo: name });

  return {
    description: repository.description ?? null,
    default_branch: repository.default_branch,
    html_url: repository.html_url,
  };
}

export interface RepoReadme {
  markdown: string;
  rawBaseUrl: string;
  htmlUrl: string;
}

export async function getReadme(repo: string): Promise<RepoReadme | null> {
  if (!isGitHubConfigured()) {
    return null;
  }
  const ok = await octokit();
  const [owner, name] = split(repo);

  try {
    const { data: readme } = await ok.rest.repos.getReadme({
      owner,
      repo: name,
    });
    const markdown = Buffer.from(readme.content, "base64").toString("utf-8");
    const rawBaseUrl = (readme.download_url ?? "").replace(/[^/]+$/, "");

    return { markdown, rawBaseUrl, htmlUrl: readme.html_url ?? "" };
  } catch {
    return null;
  }
}

export async function getPRDetails(
  repo: string,
  prNumber: number,
): Promise<PRDetails> {
  const ok = await octokit();
  const [owner, repoName] = split(repo);

  const { data: pr } = await ok.rest.pulls.get({
    owner,
    repo: repoName,
    pull_number: prNumber,
  });

  const [checksResult, reviewsResult] = await Promise.all([
    ok.rest.checks
      .listForRef({ owner, repo: repoName, ref: pr.head.sha })
      .catch(() => ({ data: { check_runs: [] } })),
    ok.rest.pulls
      .listReviews({ owner, repo: repoName, pull_number: prNumber })
      .catch(() => ({ data: [] })),
  ]);

  const checks = checksResult.data.check_runs.map((c) => ({
    name: c.name,
    status: c.status,
    conclusion: c.conclusion ?? null,
  }));

  const reviews = reviewsResult.data.map((r) => ({
    user: r.user?.login || "unknown",
    state: r.state,
    submitted_at: r.submitted_at || "",
  }));

  return {
    number: pr.number,
    title: pr.title,
    state: pr.state,
    draft: pr.draft ?? false,
    merged: pr.merged,
    mergeable: pr.mergeable ?? null,
    html_url: pr.html_url,
    checks,
    reviews,
    computed_status: computeStatus(pr, checks, reviews),
  };
}

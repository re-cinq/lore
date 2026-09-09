/** GitHub API client for web-ui (GitHub App auth, PR state visibility). */

import { split, octokit, isGitHubConfigured } from "./github-client";

export { split, octokit, isGitHubConfigured } from "./github-client";

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

function hasFailingChecks(checks: Array<{ conclusion: string | null }>) {
  return checks.some(
    (c) => c.conclusion === "failure" || c.conclusion === "timed_out",
  );
}

function isApprovedAndPassing(
  reviews: Array<{ state: string }>,
  checks: Array<{ conclusion: string | null }>,
) {
  return (
    reviews.some((r) => r.state === "APPROVED") &&
    checks.every(
      (c) =>
        c.conclusion === "success" ||
        c.conclusion === "skipped" ||
        c.conclusion === null,
    )
  );
}

/** First matching rule wins — same order as the old if-chain, expressed as data instead of branches. */
function statusRules(
  pr: { merged: boolean; state: string; draft?: boolean },
  checks: Array<{ conclusion: string | null }>,
  reviews: Array<{ state: string }>,
): Array<[boolean, PRStatus]> {
  return [
    [pr.merged, "merged"],
    [pr.state === "closed", "closed"],
    [!!pr.draft, "draft"],
    [hasFailingChecks(checks), "checks-failing"],
    [reviews.some((r) => r.state === "CHANGES_REQUESTED"), "changes-requested"],
    [isApprovedAndPassing(reviews, checks), "approved"],
  ];
}

export function computeStatus(
  pr: { merged: boolean; state: string; draft?: boolean },
  checks: Array<{ conclusion: string | null }>,
  reviews: Array<{ state: string }>,
): PRStatus {
  const match = statusRules(pr, checks, reviews).find(([cond]) => cond);

  return match ? match[1] : "open";
}

export type RepoAccess = "ok" | "not-found" | "unknown";

type RestApi = Awaited<ReturnType<typeof octokit>>["rest"];

/** Probe: can App see this repo? Definitive 404 or unknown. */
export async function checkRepoAccess(repo: string): Promise<RepoAccess> {
  if (!isGitHubConfigured()) {
    return "unknown";
  }
  const { repos } = (await octokit()).rest;
  const [owner, name] = split(repo);

  try {
    await repos.get({ owner, repo: name });

    return "ok";
  } catch (e) {
    return (e as { status?: number }).status === 404 ? "not-found" : "unknown";
  }
}

// GitHub's own repo-response shape (description/default_branch/html_url), not a Lore table row.
// eslint-disable-next-line re-lint/no-row-types-outside-models
export interface RepoMeta {
  description: string | null;
  default_branch: string;
  html_url: string;
}

interface FileAt {
  owner: string;
  name: string;
  path: string;
}

function allUnknown(paths: string[]): Record<string, boolean | null> {
  const result: Record<string, boolean | null> = {};

  for (const p of paths) {
    result[p] = null;
  }

  return result;
}

/** true, false on a definitive 404, null when GitHub answered anything else. */
async function fileExists(
  repos: RestApi["repos"],
  at: FileAt,
): Promise<boolean | null> {
  try {
    await repos.getContent({ owner: at.owner, repo: at.name, path: at.path });

    return true;
  } catch (e) {
    return (e as { status?: number }).status === 404 ? false : null;
  }
}

/** Check if paths exist on repo's default branch; fail-soft. */
export async function checkRepoFiles(
  repo: string,
  paths: string[],
): Promise<Record<string, boolean | null>> {
  if (!isGitHubConfigured()) {
    return allUnknown(paths);
  }
  const { repos } = (await octokit()).rest;
  const [owner, name] = split(repo);
  const result: Record<string, boolean | null> = {};

  await Promise.all(
    paths.map(async (path) => {
      result[path] = await fileExists(repos, { owner, name, path });
    }),
  );

  return result;
}

function isFileWithStringContent(
  content: unknown,
): content is { content: string } {
  if (Array.isArray(content)) {
    return false;
  }
  const c = content as { type?: string; content?: unknown };

  return c.type === "file" && typeof c.content === "string";
}

function nullOnNotFound(e: unknown): null {
  if ((e as { status?: number }).status === 404) {
    return null;
  }
  throw e;
}

/** Decoded UTF-8 body, or null when the path is a directory or a non-string blob. */
async function decodedContent(
  repos: RestApi["repos"],
  at: FileAt,
): Promise<string | null> {
  const { data: content } = await repos.getContent({
    owner: at.owner,
    repo: at.name,
    path: at.path,
  });

  if (!isFileWithStringContent(content)) {
    return null;
  }

  return Buffer.from(content.content, "base64").toString("utf-8");
}

/** Fetch decoded UTF-8 file content from repo's default branch; null on 404 or unconfigured. */
export async function getRepoFileContent(
  repo: string,
  path: string,
): Promise<string | null> {
  if (!isGitHubConfigured()) {
    return null;
  }
  const { repos } = (await octokit()).rest;
  const [owner, name] = split(repo);

  try {
    return await decodedContent(repos, { owner, name, path });
  } catch (e) {
    return nullOnNotFound(e);
  }
}

export {
  openIngestWorkflowPR,
  openTraceImpactWorkflowPR,
} from "./github-workflow-pr";

export async function getRepoMeta(repo: string): Promise<RepoMeta | null> {
  if (!isGitHubConfigured()) {
    return null;
  }
  const { repos } = (await octokit()).rest;
  const [owner, name] = split(repo);
  const { data: repository } = await repos.get({ owner, repo: name });

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
  const { repos } = (await octokit()).rest;
  const [owner, name] = split(repo);

  try {
    const { data: readme } = await repos.getReadme({
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

interface PrAt {
  owner: string;
  repoName: string;
  prNumber: number;
  headSha: string;
}

/** Degrades to an empty list rather than failing the read: a card that renders without its check list beats one that does not render at all. */
async function fetchChecks(checks: RestApi["checks"], at: PrAt) {
  const result = await checks
    .listForRef({ owner: at.owner, repo: at.repoName, ref: at.headSha })
    .catch(() => ({ data: { check_runs: [] } }));
  const { check_runs: checkRuns } = result.data;

  return checkRuns.map((c) => ({
    name: c.name,
    status: c.status,
    conclusion: c.conclusion ?? null,
  }));
}

/** Degrades to an empty list for the same reason `fetchChecks` does. */
async function fetchReviews(pulls: RestApi["pulls"], at: PrAt) {
  const result = await pulls
    .listReviews({
      owner: at.owner,
      repo: at.repoName,
      pull_number: at.prNumber,
    })
    .catch(() => ({ data: [] }));

  return result.data.map((r) => ({
    user: r.user?.login || "unknown",
    state: r.state,
    submitted_at: r.submitted_at || "",
  }));
}

/** Checks and reviews for a PR, fetched together. */
async function prSignals(api: Pick<RestApi, "checks" | "pulls">, at: PrAt) {
  const [checks, reviews] = await Promise.all([
    fetchChecks(api.checks, at),
    fetchReviews(api.pulls, at),
  ]);

  return { checks, reviews };
}

async function fetchPr(
  pulls: RestApi["pulls"],
  at: { owner: string; repoName: string; prNumber: number },
) {
  const { data: pr } = await pulls.get({
    owner: at.owner,
    repo: at.repoName,
    pull_number: at.prNumber,
  });

  return pr;
}

type PrPayload = Awaited<ReturnType<typeof fetchPr>>;
type PrSignals = Awaited<ReturnType<typeof prSignals>>;

function toPrDetails(pr: PrPayload, signals: PrSignals): PRDetails {
  const { checks, reviews } = signals;

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

export async function getPRDetails(
  repo: string,
  prNumber: number,
): Promise<PRDetails> {
  const rest = (await octokit()).rest;
  const [owner, repoName] = split(repo);
  const pr = await fetchPr(rest.pulls, { owner, repoName, prNumber });
  const signals = await prSignals(rest, {
    owner,
    repoName,
    prNumber,
    headSha: pr.head.sha,
  });

  return toPrDetails(pr, signals);
}

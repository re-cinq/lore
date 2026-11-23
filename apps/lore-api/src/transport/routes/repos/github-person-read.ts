import {
  deriveComputedStatus,
  githubApiUrl,
} from "../../../outbound/github-client.js";

// A GitHub read made with the token its `env` carries — the signed-in person's, from `actingEnv` — and never the App's.

/** The decoded UTF-8 body of the file at `path` on the repo's default branch; null when the path is a directory or not a file. A GitHub 404 throws an error carrying `status`, as Octokit's does. */
export async function readRepoFile(
  env: NodeJS.ProcessEnv,
  repo: string,
  path: string,
): Promise<string | null> {
  const content = await githubGet(
    env,
    `/repos/${repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}`,
  );

  if (
    Array.isArray(content) ||
    content.type !== "file" ||
    typeof content.content !== "string"
  ) {
    return null;
  }

  return Buffer.from(content.content, "base64").toString("utf-8");
}

/** The repository's README as GitHub reports it; a GitHub 404 throws an error carrying `status`. */
export async function readRepoReadme(env: NodeJS.ProcessEnv, repo: string) {
  const readme = await githubGet(env, `/repos/${repo}/readme`);
  const downloadUrl = String(readme.download_url ?? "");

  return {
    markdown: Buffer.from(String(readme.content ?? ""), "base64").toString(
      "utf-8",
    ),
    rawBaseUrl: downloadUrl.replace(/[^/]+$/, ""),
    htmlUrl: String(readme.html_url ?? ""),
  };
}

/** The repository's description, default branch and page, as GitHub reports them. */
export async function readRepoDetails(env: NodeJS.ProcessEnv, repo: string) {
  const details = await githubGet(env, `/repos/${repo}`);

  return {
    description: (details.description as string | null | undefined) ?? null,
    default_branch: String(details.default_branch),
    html_url: String(details.html_url),
  };
}

/** A pull request with its checks and reviews; the two lists degrade to empty rather than failing the read. */
export async function readPullDetails(
  env: NodeJS.ProcessEnv,
  repo: string,
  number: number,
) {
  const pr = await githubGet(env, `/repos/${repo}/pulls/${number}`);

  return toPullDetails(pr, await pullSignals(env, repo, number, pr));
}

type CheckRun = { name: string; status: string; conclusion: string | null };
type Signals = Awaited<ReturnType<typeof pullSignals>>;

function toPullDetails(pr: Record<string, unknown>, signals: Signals) {
  const flags = {
    merged: pr.merged as boolean | undefined,
    state: pr.state as string,
    draft: pr.draft as boolean | undefined,
  };

  return {
    number: pr.number as number,
    title: pr.title as string,
    state: flags.state,
    draft: flags.draft ?? false,
    merged: flags.merged ?? false,
    mergeable: (pr.mergeable as boolean | null | undefined) ?? null,
    html_url: pr.html_url as string,
    ...signals,
    computed_status: deriveComputedStatus(flags, ...signalLists(signals)),
  };
}

function signalLists(
  signals: Signals,
): [Signals["checks"], Signals["reviews"]] {
  return [signals.checks, signals.reviews];
}

async function pullSignals(
  env: NodeJS.ProcessEnv,
  repo: string,
  number: number,
  pr: Record<string, unknown>,
) {
  const [checks, reviews] = await Promise.all([
    fetchChecks(env, repo, (pr.head as { sha: string }).sha),
    fetchReviews(env, repo, number),
  ]);

  return { checks, reviews };
}

async function fetchChecks(env: NodeJS.ProcessEnv, repo: string, sha: string) {
  const body = await githubGet(
    env,
    `/repos/${repo}/commits/${sha}/check-runs`,
  ).catch(() => ({}) as Record<string, unknown>);

  return normalizeChecks((body.check_runs as CheckRun[] | undefined) ?? []);
}

async function fetchReviews(
  env: NodeJS.ProcessEnv,
  repo: string,
  number: number,
) {
  const list = await githubGetList(
    env,
    `/repos/${repo}/pulls/${number}/reviews`,
  ).catch(() => []);

  return normalizeReviews(list);
}

function normalizeChecks(runs: CheckRun[]) {
  return runs.map((c) => ({
    name: c.name,
    status: c.status,
    conclusion: c.conclusion ?? null,
  }));
}

function normalizeReviews(reviews: Array<Record<string, unknown>>) {
  return reviews.map((r) => ({
    user: (r.user as { login?: string } | undefined)?.login || "unknown",
    state: String(r.state ?? ""),
    submitted_at: String(r.submitted_at || ""),
  }));
}

async function githubGetList(
  env: NodeJS.ProcessEnv,
  path: string,
): Promise<Array<Record<string, unknown>>> {
  const body = (await githubGet(env, path)) as unknown;

  return Array.isArray(body) ? body : [];
}

async function githubGet(
  env: NodeJS.ProcessEnv,
  path: string,
): Promise<Record<string, unknown>> {
  const res = await fetch(githubApiUrl(path, env), {
    signal: AbortSignal.timeout(15_000),
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN ?? ""}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!res.ok) {
    throw Object.assign(new Error(`GitHub API ${path}: ${res.status}`), {
      status: res.status,
    });
  }

  return res.json();
}

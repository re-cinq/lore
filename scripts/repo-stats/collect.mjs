// One repository's raw rows for a window, read from where each lives: floor runs and the weekly changelog from lore-api, pull requests and commits from GitHub through `gh`, and, when asked, the blocked spans from the production database.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const BIG_OUTPUT = { maxBuffer: 256 * 1024 * 1024 };
const PAGE = 100;
const REPO_NAME = /^[\w.-]+\/[\w.-]+$/;
const DB_CONTEXT =
  process.env.LORE_DB_CONTEXT ??
  "gke_re5-n8n-platform_europe-west1_n8n-cluster";

const PULLS_QUERY = `
query($q: String!, $after: String) {
  search(query: $q, type: ISSUE, first: 50, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes {
      ... on PullRequest {
        number title createdAt mergedAt closedAt
        author { login __typename }
        reviews(first: 50) { nodes { author { login } state submittedAt } }
        commits(last: 100) { nodes { commit { committedDate } } }
      }
    }
  }
}`;

function enforceRepoName(repo) {
  if (!REPO_NAME.test(repo)) {
    throw new Error(`${repo} is not an owner/name repository`);
  }

  return repo;
}

const gh = async (args) =>
  JSON.parse((await run("gh", args, BIG_OUTPUT)).stdout);

async function pulls(repo, since) {
  const found = [];
  let after = null;

  do {
    const { data } = await gh([
      "api",
      "graphql",
      "-f",
      `query=${PULLS_QUERY}`,
      "-f",
      `q=repo:${repo} is:pr created:>=${since}`,
      ...(after ? ["-f", `after=${after}`] : []),
    ]);

    found.push(...data.search.nodes);
    after = data.search.pageInfo.hasNextPage
      ? data.search.pageInfo.endCursor
      : null;
  } while (after);

  return found.map((pull) => ({
    number: pull.number,
    title: pull.title,
    author: pull.author?.login ?? "ghost",
    isBot: pull.author?.__typename === "Bot",
    createdAt: pull.createdAt,
    mergedAt: pull.mergedAt,
    closedAt: pull.closedAt,
    reviews: pull.reviews.nodes.map((review) => ({
      author: review.author?.login ?? null,
      state: review.state,
      submittedAt: review.submittedAt,
    })),
    commitDates: pull.commits.nodes.map((node) => node.commit.committedDate),
  }));
}

async function commits(repo, since) {
  const { stdout } = await run(
    "gh",
    [
      "api",
      "--paginate",
      `repos/${repo}/commits?since=${since}T00:00:00Z&per_page=${PAGE}`,
      "--jq",
      ".[] | {date: .commit.committer.date, author: .author.login, message: .commit.message}",
    ],
    BIG_OUTPUT,
  );

  return stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

/** The floor's runs newest first, paged back until a page reaches before the window, then the runs Lore's own engine walked before the floor took over. */
async function runs(api, repo, since) {
  const repoQuery = `repo=${encodeURIComponent(repo)}&limit=${PAGE}`;
  const inWindow = (row) => row.created_at >= since;
  const floor = [];
  let cursor = null;

  do {
    const page = await api.get(
      `/api/floor-runs?${repoQuery}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    );

    floor.push(...page.runs);
    cursor = page.runs.every(inWindow) ? page.next_cursor : null;
  } while (cursor);

  const { runs: walked } = await api.get(
    `/api/assembly-runs?${repoQuery}&engine=lore`,
  );

  if (walked.length === PAGE && walked.every(inWindow)) {
    console.error(
      `[lore] ${repo}: the newest ${PAGE} old-engine runs all fall in the window; older ones are missing`,
    );
  }

  return [...floor, ...walked].filter(inWindow);
}

async function changelog(api, repo, weekCount) {
  const { weeks } = await api.get(
    `/api/repos/${repo}/changelog?limit=${Math.min(weekCount, 12)}`,
  );

  return weeks.map(({ weekKey, intro }) => ({ weekKey, intro }));
}

/** Every repository's blocked spans that reach into the window, read inside a read-only session on the CloudNativePG primary. */
export async function blockedSpans(repos, since) {
  const kubectl = ["--context", DB_CONTEXT, "-n", "lore-db"];
  const { stdout: pod } = await run("kubectl", [
    ...kubectl,
    "get",
    "pods",
    "-l",
    "cnpg.io/instanceRole=primary",
    "-o",
    "jsonpath={.items[0].metadata.name}",
  ]);
  const names = repos
    .map((repo) => `'${enforceRepoName(repo).toLowerCase()}'`)
    .join(", ");
  const select = `SELECT coalesce(json_agg(json_build_object('repo', lower(repo), 'pr_number', pr_number, 'reason', reason, 'since', since, 'closed_at', closed_at)), '[]') FROM pipeline.pr_blocked_reasons WHERE lower(repo) IN (${names}) AND (closed_at IS NULL OR closed_at >= '${since}')`;
  const { stdout } = await run(
    "kubectl",
    [
      ...kubectl,
      "exec",
      pod,
      "-c",
      "postgres",
      "--",
      "psql",
      "-U",
      "postgres",
      "-d",
      "lore",
      "-qAt",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      "SET default_transaction_read_only = on",
      "-c",
      select,
    ],
    BIG_OUTPUT,
  );

  return JSON.parse(stdout.trim());
}

export async function collectRepo({ api, repo, since, weekCount }) {
  enforceRepoName(repo);
  const [pullRows, commitRows, runRows, changelogRows] = await Promise.all([
    pulls(repo, since),
    commits(repo, since),
    runs(api, repo, since),
    changelog(api, repo, weekCount),
  ]);

  if (runRows.length === 0) {
    console.error(
      `[lore] ${repo}: no runs found; Lore may know it by another case of its name`,
    );
  }

  return {
    repo,
    pulls: pullRows,
    commits: commitRows,
    runs: runRows,
    changelog: changelogRows,
    blocked: [],
  };
}

import type { Octokit } from "octokit";
import type {
  PullReview,
  ReviewComment,
  IssueComment,
  ReviewThread,
  CiConclusion,
  CheckRun,
} from "../pulls/pull-requests-port.js";
import { split } from "./platform-github-support.js";

/** PR review/comment/CI reads for PlatformGitHub — everything downstream of a PR's review state. */

export async function listReviews(
  ok: Octokit,
  repo: string,
  number: number,
): Promise<PullReview[]> {
  const [owner, name] = split(repo);
  const reviews = await ok.paginate(ok.rest.pulls.listReviews, {
    owner,
    repo: name,
    pull_number: number,
  });

  return reviews.map((r) => ({
    id: r.id,
    state: r.state,
    body: r.body,
    user: r.user?.login ?? "unknown",
    submitted_at: r.submitted_at ?? "",
  }));
}

export async function listComments(
  ok: Octokit,
  repo: string,
  number: number,
): Promise<ReviewComment[]> {
  const [owner, name] = split(repo);
  const comments = await ok.paginate(ok.rest.pulls.listReviewComments, {
    owner,
    repo: name,
    pull_number: number,
  });

  return comments.map((c) => ({
    id: c.id,
    path: c.path,
    line: c.line ?? c.original_line ?? null,
    body: c.body,
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- octokit types `user` as required, but GitHub returns null for comments from deleted accounts
    user: c.user?.login ?? "unknown",
    created_at: c.created_at,
    review_id: c.pull_request_review_id ?? null,
  }));
}

/** The reviewThreads GraphQL response — only the fields the mapper reads. */
interface ReviewThreadsResponse {
  repository?: {
    pullRequest?: {
      reviewThreads: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: Array<{
          id: string;
          isResolved: boolean;
          isOutdated: boolean;
          comments: {
            pageInfo?: { hasNextPage: boolean };
            nodes: Array<{ databaseId: number | null }>;
          };
        }>;
      };
    };
  };
}

function pushThreadPage(
  threads: ReviewThread[],
  repo: string,
  number: number,
  page: NonNullable<
    NonNullable<ReviewThreadsResponse["repository"]>["pullRequest"]
  >["reviewThreads"],
): void {
  page.nodes.forEach((n) => {
    // 100+-comment threads are out of scope; warn so a failed databaseId join reads as "past the cap", not "no thread".
    if (n.comments.pageInfo?.hasNextPage) {
      console.warn(
        `[github] review thread ${n.id} on ${repo}#${number} has >100 comments — late comments will not join by databaseId`,
      );
    }
    threads.push({
      id: n.id,
      isResolved: n.isResolved,
      isOutdated: n.isOutdated,
      comments: n.comments.nodes.map((c) => ({ databaseId: c.databaseId })),
    });
  });
}

export async function listReviewThreads(
  ok: Octokit,
  repo: string,
  number: number,
): Promise<ReviewThread[]> {
  const [owner, name] = split(repo);
  const threads: ReviewThread[] = [];
  let cursor: string | null = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const response: ReviewThreadsResponse = await ok.graphql(
      `query ($owner: String!, $name: String!, $number: Int!, $cursor: String) {
        repository(owner: $owner, name: $name) {
          pullRequest(number: $number) {
            reviewThreads(first: 100, after: $cursor) {
              pageInfo { hasNextPage endCursor }
              nodes {
                id
                isResolved
                isOutdated
                comments(first: 100) {
                  pageInfo { hasNextPage }
                  nodes { databaseId }
                }
              }
            }
          }
        }
      }`,
      { owner, name, number, cursor },
    );
    const page = response.repository?.pullRequest?.reviewThreads;

    if (!page) {
      break;
    }

    pushThreadPage(threads, repo, number, page);
    hasNextPage = page.pageInfo.hasNextPage;
    cursor = page.pageInfo.endCursor;
  }

  return threads;
}

export async function listIssueComments(
  ok: Octokit,
  repo: string,
  number: number,
): Promise<IssueComment[]> {
  const [owner, name] = split(repo);
  const comments = await ok.paginate(ok.rest.issues.listComments, {
    owner,
    repo: name,
    issue_number: number,
  });

  return comments
    .filter(
      (c) =>
        !c.body?.startsWith("PR created:") &&
        !c.body?.startsWith("Agent ") &&
        !c.body?.startsWith("Task "),
    )
    .map((c) => ({
      body: c.body ?? "",
      user: c.user?.login ?? "unknown",
      created_at: c.created_at,
    }));
}

/** All check runs for a ref, paginated once — source for both ciConclusion and the raw listChecks the auto-merge gate reads. */
export async function checkRuns(
  ok: Octokit,
  repo: string,
  ref: string,
): Promise<CheckRun[]> {
  const [owner, name] = split(repo);
  const runs = await ok.paginate(ok.rest.checks.listForRef, {
    owner,
    repo: name,
    ref,
    per_page: 100,
  });

  return runs.map((r) => ({
    name: r.name,
    status: r.status,
    conclusion: r.conclusion,
  }));
}

export async function ciConclusion(
  ok: Octokit,
  repo: string,
  ref: string,
): Promise<CiConclusion> {
  const runs = await checkRuns(ok, repo, ref);

  if (runs.length === 0) {
    return "none";
  }

  if (runs.some((r) => r.status !== "completed")) {
    return "pending";
  }
  const failed = new Set([
    "failure",
    "cancelled",
    "timed_out",
    "action_required",
    "stale",
  ]);

  if (runs.some((r) => r.conclusion != null && failed.has(r.conclusion))) {
    return "failure";
  }

  return "success";
}

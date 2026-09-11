import type { Octokit } from "octokit";
import type {
  PullReview,
  ReviewComment,
  IssueComment,
  ReviewThread,
  CiConclusion,
  CheckRun,
} from "../pulls/pull-requests-port.js";
import { ciConclusionOf } from "../pulls/check-runs.js";
import { split } from "./platform-github-support.js";

/** PR review/comment/CI reads for PlatformGitHub — everything downstream of a PR's review state. */

export async function listReviews(
  ok: Octokit,
  repo: string,
  number: number,
): Promise<PullReview[]> {
  const [owner, name] = split(repo);
  const { pulls } = ok.rest;
  const reviews = await ok.paginate(pulls.listReviews, {
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
  const { pulls } = ok.rest;
  const comments = await ok.paginate(pulls.listReviewComments, {
    owner,
    repo: name,
    pull_number: number,
  });

  return comments.map(toReviewComment);
}

/** The `user` parameter is optional here because GitHub returns null for comments from deleted accounts, which octokit's types do not admit. */
function toReviewComment(c: {
  id: number;
  path: string;
  line?: number | null;
  original_line?: number | null;
  body: string;
  user?: { login?: string } | null;
  created_at: string;
  pull_request_review_id?: number | null;
}): ReviewComment {
  return {
    id: c.id,
    path: c.path,
    line: c.line ?? c.original_line ?? null,
    body: c.body,
    user: c.user?.login ?? "unknown",
    created_at: c.created_at,
    review_id: c.pull_request_review_id ?? null,
  };
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

/** Review threads with their comment ids. GraphQL rather than REST because resolution state (`isResolved`, `isOutdated`) is a thread-level fact the REST review-comments endpoint does not report at all. */
const REVIEW_THREADS_QUERY = `query ($owner: String!, $name: String!, $number: Int!, $cursor: String) {
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
      }`;

export async function listReviewThreads(
  ok: Octokit,
  repo: string,
  number: number,
): Promise<ReviewThread[]> {
  const threads: ReviewThread[] = [];
  let cursor: string | null = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const page = await reviewThreadsPage(ok, repo, number, cursor);

    if (!page) {
      break;
    }

    pushThreadPage(threads, repo, number, page);
    hasNextPage = page.pageInfo.hasNextPage;
    cursor = page.pageInfo.endCursor;
  }

  return threads;
}

/** One page of review threads, or undefined when the PR is gone from the response. */
async function reviewThreadsPage(
  ok: Octokit,
  repo: string,
  number: number,
  cursor: string | null,
) {
  const [owner, name] = split(repo);
  const response: ReviewThreadsResponse = await ok.graphql(
    REVIEW_THREADS_QUERY,
    { owner, name, number, cursor },
  );

  const { repository } = response;

  return repository?.pullRequest?.reviewThreads;
}

function pushThreadPage(
  threads: ReviewThread[],
  repo: string,
  number: number,
  page: NonNullable<
    NonNullable<ReviewThreadsResponse["repository"]>["pullRequest"]
  >["reviewThreads"],
): void {
  page.nodes.forEach((node) => {
    warnIfThreadTruncated(node, repo, number);
    const { id, isResolved, isOutdated, comments } = node;

    threads.push({
      id,
      isResolved,
      isOutdated,
      comments: comments.nodes.map((c) => ({ databaseId: c.databaseId })),
    });
  });
}

/** 100+-comment threads are out of scope; warn so a failed databaseId join reads as "past the cap", not "no thread". */
function warnIfThreadTruncated(
  node: { id: string; comments: { pageInfo?: { hasNextPage: boolean } } },
  repo: string,
  number: number,
): void {
  const { comments } = node;

  if (comments.pageInfo?.hasNextPage) {
    console.warn(
      `[github] review thread ${node.id} on ${repo}#${number} has >100 comments — late comments will not join by databaseId`,
    );
  }
}

export async function listIssueComments(
  ok: Octokit,
  repo: string,
  number: number,
): Promise<IssueComment[]> {
  const [owner, name] = split(repo);
  const { issues } = ok.rest;
  const comments = await ok.paginate(issues.listComments, {
    owner,
    repo: name,
    issue_number: number,
  });

  return comments.filter(isHumanComment).map(toIssueComment);
}

/** Lore's own status chatter is not review feedback, so it never reaches the thread a reader sees. */
function isHumanComment(c: { body?: string }): boolean {
  return (
    !c.body?.startsWith("PR created:") &&
    !c.body?.startsWith("Agent ") &&
    !c.body?.startsWith("Task ")
  );
}

function toIssueComment(c: {
  body?: string;
  user?: { login?: string } | null;
  created_at: string;
}): IssueComment {
  return {
    body: c.body ?? "",
    user: c.user?.login ?? "unknown",
    created_at: c.created_at,
  };
}

/** All check runs for a ref, paginated once — source for both ciConclusion and the raw listChecks the auto-merge gate reads. */
export async function checkRuns(
  ok: Octokit,
  repo: string,
  ref: string,
): Promise<CheckRun[]> {
  const [owner, name] = split(repo);
  const { checks } = ok.rest;
  const runs = await ok.paginate(checks.listForRef, {
    owner,
    repo: name,
    ref,
    per_page: 100,
  });

  return runs.map(checkRunOf);
}

/** The fields of a listed check run that Lore reads. */
interface ListedCheckRun {
  id: number;
  app: { slug?: string } | null;
  name: string;
  status: string;
  conclusion: string | null;
  output: { title: string | null; summary: string | null };
}

/** One check run as Lore reads it. Projected, not spread: the output also carries `text` and the annotation counters, none of which a prompt has room for. */
function checkRunOf(r: ListedCheckRun): CheckRun {
  return {
    id: r.id,
    app: r.app?.slug,
    name: r.name,
    status: r.status,
    conclusion: r.conclusion,
    output: { title: r.output.title, summary: r.output.summary },
  };
}

export async function ciConclusion(
  ok: Octokit,
  repo: string,
  ref: string,
): Promise<CiConclusion> {
  return ciConclusionOf(await checkRuns(ok, repo, ref));
}

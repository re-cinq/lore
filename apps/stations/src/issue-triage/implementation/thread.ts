// The issue's conversation for the triage agents: a reporter's later answer, an earlier verdict and a pull request that already fixed it all live outside the opening post.
import type { LinkedPullRequest } from "@re-cinq/lore-shared/project/lib/github-port.js";
import type { IssueComment } from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";

export const ISSUE_THREAD_PATH = "issue-thread.md";

const COMMENT_LIMIT = 4_000;

export function issueThread(
  comments: readonly IssueComment[],
  pulls: readonly LinkedPullRequest[],
): string {
  const oldestFirst = [...comments].sort((a, b) =>
    a.created_at.localeCompare(b.created_at),
  );

  return (
    "# Issue thread\n\n## Comments\n\n" +
    (oldestFirst.map(commentSection).join("") || "None.\n\n") +
    "## Linked pull requests\n\n" +
    (pulls.map(pullLine).join("") || "None.\n")
  );
}

function commentSection({ user, created_at, body }: IssueComment): string {
  const shown =
    body.length > COMMENT_LIMIT
      ? `${body.slice(0, COMMENT_LIMIT)}\n[comment cut]`
      : body;

  return `### ${user}, ${created_at}\n\n${shown}\n\n`;
}

function pullLine({
  number,
  title,
  state,
  merged,
  url,
}: LinkedPullRequest): string {
  return `- #${number} ${title} (${merged ? "merged" : state}) ${url}\n`;
}

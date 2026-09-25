import type { IssueRef } from "../../outbound/project/lib/github-port.js";
import type { PullRef } from "../../outbound/project/pulls/pull-requests-port.js";

/** An issue a merged PR closes is one change, not two (specs/daily-digest FR4): the PR line stays, the issue line goes. */

export interface Implemented {
  prs: PullRef[];
  issues: IssueRef[];
}

const CLOSING_KEYWORD =
  /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/gi;
const TITLE_NUMBER = /#(\d+)/g;

/** Issue numbers a PR claims: closing keywords in the body plus any bare `#N` in the title. */
export function referencedIssueNumbers(pr: {
  title: string;
  body?: string;
}): number[] {
  const fromBody = [...(pr.body ?? "").matchAll(CLOSING_KEYWORD)];
  const fromTitle = [...pr.title.matchAll(TITLE_NUMBER)];

  return [...new Set([...fromBody, ...fromTitle].map((m) => Number(m[1])))];
}

export function dedupeImplemented(
  prs: PullRef[],
  issues: IssueRef[],
): Implemented {
  const claimed = new Set(prs.flatMap(referencedIssueNumbers));

  return { prs, issues: issues.filter((issue) => !claimed.has(issue.number)) };
}

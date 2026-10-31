import type { Octokit } from "octokit";
import { split } from "./platform-github-support.js";
import type { IssueEdit, LinkedPullRequest } from "./github-port.js";

/** How PlatformGitHub ties issues together: native sub-issues and body rewrites, which the issues station uses to hang a plan's task issues under its story issue. */

// The sub-issue API takes the child's numeric id, not its number, so the child is read first.
export async function addSubIssue(
  ok: Octokit,
  repo: string,
  parentNumber: number,
  childNumber: number,
): Promise<void> {
  const [owner, name] = split(repo);
  const { issues } = ok.rest;
  const { data: child } = await issues.get({
    owner,
    repo: name,
    issue_number: childNumber,
  });

  await ok.request(
    "POST /repos/{owner}/{repo}/issues/{issue_number}/sub_issues",
    { owner, repo: name, issue_number: parentNumber, sub_issue_id: child.id },
  );
}

export async function updateIssue(
  ok: Octokit,
  repo: string,
  number: number,
  edit: IssueEdit,
): Promise<void> {
  const [owner, name] = split(repo);
  const { issues } = ok.rest;

  await issues.update({ owner, repo: name, issue_number: number, ...edit });
}

interface ReferencingIssue {
  number: number;
  title: string;
  state?: string;
  html_url: string;
  pull_request?: { merged_at?: string | null };
}

export interface CrossReference {
  event: string;
  source?: { issue?: ReferencingIssue };
}

/** Pull requests whose body, commit or comment named the issue: GitHub records each as a cross-reference on the issue's timeline. */
export async function listLinkedPullRequests(
  ok: Octokit,
  repo: string,
  number: number,
): Promise<LinkedPullRequest[]> {
  const [owner, name] = split(repo);
  const { issues } = ok.rest;
  const events = (await ok.paginate(issues.listEventsForTimeline, {
    owner,
    repo: name,
    issue_number: number,
  })) as CrossReference[];

  return linkedPullRequests(events);
}

/** One entry per pull request, however often it referenced the issue. */
export function linkedPullRequests(
  events: readonly CrossReference[],
): LinkedPullRequest[] {
  const pulls = new Map<number, LinkedPullRequest>();

  for (const { event, source } of events) {
    const issue = source?.issue;

    if (event === "cross-referenced" && issue?.pull_request) {
      pulls.set(issue.number, linkedPull(issue, issue.pull_request));
    }
  }

  return [...pulls.values()];
}

function linkedPull(
  issue: ReferencingIssue,
  pull: { merged_at?: string | null },
): LinkedPullRequest {
  return {
    number: issue.number,
    title: issue.title,
    state: issue.state === "closed" ? "closed" : "open",
    merged: Boolean(pull.merged_at),
    url: issue.html_url,
  };
}

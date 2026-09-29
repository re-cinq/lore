import type { Octokit } from "octokit";
import { split } from "./platform-github-support.js";

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

export async function updateIssueBody(
  ok: Octokit,
  repo: string,
  number: number,
  body: string,
): Promise<void> {
  const [owner, name] = split(repo);
  const { issues } = ok.rest;

  await issues.update({ owner, repo: name, issue_number: number, body });
}

import type { Octokit } from "octokit";
import type {
  IssueRef,
  IssueFilter,
  IssueState,
  CloseReason,
} from "./github-port.js";
import { split } from "./platform-github-support.js";

/** GitHub Issues read/write paths for PlatformGitHub — the non-PR half of GitHubPort. */

type OctokitLabel = string | { name?: string | null };

interface OctokitIssue {
  number: number;
  title: string;
  state: string;
  labels: OctokitLabel[];
  html_url: string;
}

export async function listIssues(
  ok: Octokit,
  repo: string,
  filter?: IssueFilter,
): Promise<IssueRef[]> {
  const [owner, name] = split(repo);
  const issues = await ok.paginate(ok.rest.issues.listForRepo, {
    owner,
    repo: name,
    state: filter?.state ?? "open",
    labels: filter?.labels?.join(","),
    per_page: 100,
  });

  return issues
    .filter((i) => !i.pull_request)
    .map((i) => toListedIssueRef(repo, i));
}

/** The listing projection: the shared IssueRef fields plus the creation time and body only the list read carries. */
function toListedIssueRef(
  repo: string,
  issue: OctokitIssue & { created_at: string; body?: string | null },
): IssueRef {
  return {
    ...toIssueRef(repo, issue),
    createdAt: issue.created_at,
    ...(issue.body ? { body: issue.body } : {}),
  };
}

/** The IssueRef fields every issue read projects. */
function toIssueRef(repo: string, issue: OctokitIssue): IssueRef {
  return {
    repo,
    number: issue.number,
    title: issue.title,
    state: issue.state as IssueState,
    labels: labelNames(issue.labels),
    url: issue.html_url,
  };
}

/** Label names out of octokit's string-or-object label array, blanks dropped. */
function labelNames(labels: OctokitLabel[]): string[] {
  return labels
    .map((l) => (typeof l === "string" ? l : (l.name ?? "")))
    .filter(Boolean);
}

export async function getIssue(
  ok: Octokit,
  repo: string,
  number: number,
): Promise<IssueRef | null> {
  const [owner, name] = split(repo);

  try {
    const { data: issue } = await ok.rest.issues.get({
      owner,
      repo: name,
      issue_number: number,
    });

    return toIssueRef(repo, issue);
  } catch {
    return null;
  }
}

export async function getIssueLabels(
  ok: Octokit,
  repo: string,
  number: number,
): Promise<string[]> {
  const [owner, name] = split(repo);
  const { data: issue } = await ok.rest.issues.get({
    owner,
    repo: name,
    issue_number: number,
  });

  return labelNames(issue.labels);
}

interface IssueDraft {
  title: string;
  body: string;
  labels?: string[];
}

export async function createIssue(
  ok: Octokit,
  repo: string,
  draft: IssueDraft,
): Promise<IssueRef> {
  const labels = draft.labels ?? ["lore-managed"];
  const created = await createIssueRow(ok, repo, { ...draft, labels });

  return {
    repo,
    number: created.number,
    title: draft.title,
    state: "open",
    labels,
    url: created.html_url,
  };
}

/** The raw create call; the caller projects the IssueRef so the labels it asked for are the ones it reports. */
async function createIssueRow(
  ok: Octokit,
  repo: string,
  { title, body, labels }: { title: string; body: string; labels: string[] },
): Promise<{ number: number; html_url: string }> {
  const [owner, name] = split(repo);
  const { data: created } = await ok.rest.issues.create({
    owner,
    repo: name,
    title,
    body,
    labels,
  });

  return created;
}

export async function listLabels(ok: Octokit, repo: string): Promise<string[]> {
  const [owner, name] = split(repo);
  const labels = await ok.paginate(ok.rest.issues.listLabelsForRepo, {
    owner,
    repo: name,
    per_page: 100,
  });

  return labels.map((l) => l.name);
}

export async function createLabels(
  ok: Octokit,
  repo: string,
  labels: Array<{ name: string; color?: string; description?: string }>,
): Promise<void> {
  for (const label of labels) {
    await createLabel(ok, repo, label);
  }
}

/** Creates one label, tolerating the 422 that means it already exists. */
async function createLabel(
  ok: Octokit,
  repo: string,
  label: { name: string; color?: string; description?: string },
): Promise<void> {
  const [owner, name] = split(repo);

  try {
    await ok.rest.issues.createLabel({
      owner,
      repo: name,
      name: label.name,
      color: label.color,
      description: label.description,
    });
  } catch (err) {
    if ((err as { status?: number }).status !== 422) {
      throw err;
    }
  }
}

export async function commentOnIssue(
  ok: Octokit,
  repo: string,
  number: number,
  body: string,
): Promise<void> {
  const [owner, name] = split(repo);

  await ok.rest.issues.createComment({
    owner,
    repo: name,
    issue_number: number,
    body,
  });
}

export async function closeIssue(
  ok: Octokit,
  repo: string,
  number: number,
  reason: CloseReason = "completed",
): Promise<void> {
  const [owner, name] = split(repo);

  await ok.rest.issues.update({
    owner,
    repo: name,
    issue_number: number,
    state: "closed",
    state_reason: reason,
  });
}

export async function addIssueLabel(
  ok: Octokit,
  repo: string,
  number: number,
  label: string,
): Promise<void> {
  const [owner, name] = split(repo);

  await ok.rest.issues.addLabels({
    owner,
    repo: name,
    issue_number: number,
    labels: [label],
  });
}

export async function removeIssueLabel(
  ok: Octokit,
  repo: string,
  number: number,
  label: string,
): Promise<void> {
  const [owner, name] = split(repo);

  try {
    await ok.rest.issues.removeLabel({
      owner,
      repo: name,
      issue_number: number,
      name: label,
    });
  } catch {
    /* label might not exist */
  }
}

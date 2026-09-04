import type { Octokit } from "octokit";
import type {
  IssueRef,
  IssueFilter,
  IssueState,
  CloseReason,
} from "./github-port.js";
import { split } from "./platform-github-support.js";

/** GitHub Issues read/write paths for PlatformGitHub — the non-PR half of GitHubPort. */

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
    .map((i) => ({
      repo,
      number: i.number,
      title: i.title,
      state: i.state as IssueState,
      labels: i.labels
        .map((l) => (typeof l === "string" ? l : (l.name ?? "")))
        .filter(Boolean),
      url: i.html_url,
      createdAt: i.created_at,
      ...(i.body ? { body: i.body } : {}),
    }));
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

    return {
      repo,
      number: issue.number,
      title: issue.title,
      state: issue.state as IssueState,
      labels: issue.labels
        .map((l) => (typeof l === "string" ? l : (l.name ?? "")))
        .filter(Boolean),
      url: issue.html_url,
    };
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

  return issue.labels
    .map((l) => (typeof l === "string" ? l : (l.name ?? "")))
    .filter(Boolean);
}

export async function createIssue(
  ok: Octokit,
  repo: string,
  {
    title,
    body,
    labels = ["lore-managed"],
  }: { title: string; body: string; labels?: string[] },
): Promise<IssueRef> {
  const [owner, name] = split(repo);
  const { data: created } = await ok.rest.issues.create({
    owner,
    repo: name,
    title,
    body,
    labels,
  });

  return {
    repo,
    number: created.number,
    title,
    state: "open",
    labels,
    url: created.html_url,
  };
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
  const [owner, name] = split(repo);

  for (const label of labels) {
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
      } // 422 = already exists
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

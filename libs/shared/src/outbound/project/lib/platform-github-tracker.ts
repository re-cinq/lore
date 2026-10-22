import type { Octokit } from "octokit";
import type { TrackedEntry } from "../../../domain/utopia/github/tracker-statements.js";
import type { TrackerActivityOptions } from "./github-port.js";
import { split } from "./platform-github-support.js";

interface OctokitTrackerRow {
  number: number;
  title: string;
  body?: string | null;
  user?: { login?: string } | null;
  labels: Array<string | { name?: string | null }>;
  created_at: string;
  closed_at?: string | null;
  updated_at: string;
  pull_request?: { merged_at?: string | null } | null;
}

/** The repo's issues and pull requests updated since the cursor, oldest update first, from GitHub's issues listing (which carries pull requests too), read page by page until `limit` are in hand. */
export async function listTrackerActivity(
  ok: Octokit,
  repo: string,
  opts: TrackerActivityOptions,
): Promise<TrackedEntry[]> {
  const entries: TrackedEntry[] = [];

  for await (const page of trackerPages(ok, repo, opts.since)) {
    entries.push(...(page.data as OctokitTrackerRow[]).map(toTrackedEntry));

    if (entries.length >= opts.limit) {
      break;
    }
  }

  return entries.slice(0, opts.limit);
}

function trackerPages(ok: Octokit, repo: string, since: string | undefined) {
  const [owner, name] = split(repo);
  const { issues } = ok.rest;

  return ok.paginate.iterator(issues.listForRepo, {
    owner,
    repo: name,
    state: "all",
    sort: "updated",
    direction: "asc",
    since,
    per_page: 100,
  });
}

function toTrackedEntry(row: OctokitTrackerRow): TrackedEntry {
  return {
    ...kindOf(row),
    number: row.number,
    title: row.title,
    body: row.body ?? "",
    author: row.user?.login ?? "",
    labels: labelNames(row.labels),
    openedAt: row.created_at,
    closedAt: row.closed_at ?? null,
    updatedAt: row.updated_at,
  };
}

/** A row carrying `pull_request` is a pull request, with its merge time; any other is an issue. */
function kindOf(
  row: OctokitTrackerRow,
): Pick<TrackedEntry, "kind" | "mergedAt"> {
  const pull = row.pull_request;

  return pull
    ? { kind: "pull", mergedAt: pull.merged_at ?? null }
    : { kind: "issue", mergedAt: null };
}

/** GitHub sends a label as its name or as an object carrying one. */
function labelNames(labels: OctokitTrackerRow["labels"]): string[] {
  const names = labels.map((label) =>
    typeof label === "string" ? label : label.name,
  );

  return names.filter((name): name is string => Boolean(name));
}

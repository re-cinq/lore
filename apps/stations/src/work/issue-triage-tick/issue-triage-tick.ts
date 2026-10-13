// Picks the oldest `triage: needs-triage`-labelled issues up to a per-repo concurrency cap and starts a floor run for each with no shared context between runs (specs/issue-triage/spec.md FR9).
import type { floorClient } from "@re-cinq/lore-shared/floor/floor-client.js";
import {
  floorRepoOf,
  gitItem,
  valueItem,
} from "@re-cinq/lore-shared/floor/floor-items.js";

type Floor = ReturnType<typeof floorClient>;

const ISSUE_TRIAGE_LINE = "issue-triage";

export interface IssueTriageIssue {
  url: string;
  number: number;
}

export interface IssueTriageTickDeps {
  /** All onboarded repos to sweep. */
  repos(): Promise<string[]>;
  /** Issues labelled `triage: needs-triage` for a repo, oldest first (created_at ASC). */
  needsTriageIssues(repo: string): Promise<IssueTriageIssue[]>;
  /** Count of currently-running issue-triage floor runs for a repo. */
  runningCount(repo: string): Promise<number>;
  /** The branch the run's checkout (`target`) is cut from. */
  defaultBranch(repo: string): Promise<string>;
  /** Per-repo concurrency cap. */
  cap: number;
  floor: {
    start: Floor["lines"]["start"];
  };
}

export async function issueTriageTick(
  _params: Readonly<Record<string, unknown>>,
  deps: IssueTriageTickDeps,
): Promise<string> {
  const repos = await deps.repos();
  let total = 0;

  for (const repo of repos) {
    total += await startForRepo(repo, deps);
  }

  return `issue-triage-tick: started ${total} run(s)`;
}

async function startForRepo(
  repo: string,
  deps: IssueTriageTickDeps,
): Promise<number> {
  const [issues, running] = await Promise.all([
    deps.needsTriageIssues(repo),
    deps.runningCount(repo),
  ]);
  const slots = Math.max(0, deps.cap - running);
  const qualifying = issues.slice(0, slots);

  return qualifying.length === 0 ? 0 : startRuns(repo, qualifying, deps);
}

async function startRuns(
  repo: string,
  issues: IssueTriageIssue[],
  deps: IssueTriageTickDeps,
): Promise<number> {
  const branch = await deps.defaultBranch(repo);

  for (const issue of issues) {
    await deps.floor.start(
      ISSUE_TRIAGE_LINE,
      triageStartArgs(repo, issue, branch),
    );
  }

  return issues.length;
}

function triageStartArgs(
  repo: string,
  issue: IssueTriageIssue,
  branch: string,
) {
  return {
    repo: floorRepoOf(repo),
    startItems: {
      target: gitItem(repo, branch),
      issue_url: valueItem(issue.url),
      issue_number: valueItem(issue.number),
    },
  };
}

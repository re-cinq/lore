// Picks the oldest `triage: needs-triage`-labelled issues up to a per-repo concurrency cap and starts a floor run for each with no shared context between runs (specs/issue-triage/spec.md FR9).
import type { floorClient } from "@re-cinq/lore-shared/floor/floor-client.js";
import {
  floorRepoOf,
  gitItem,
  valueItem,
} from "@re-cinq/lore-shared/floor/floor-items.js";

import type { OnboardedRepoSettings } from "@re-cinq/lore-shared/project/settings/settings-port.js";
import { issueTriageEnabled } from "@re-cinq/lore-shared/loops/loop-enabled.js";

type Floor = ReturnType<typeof floorClient>;

/** The onboarded repositories whose triage loop is switched on (specs/issue-triage FR33): the sweep looks at no other. */
export function enabledTriageRepos(
  rows: readonly OnboardedRepoSettings[],
): string[] {
  return rows
    .filter((row) => issueTriageEnabled(row.settings))
    .map((row) => row.full_name);
}

const ISSUE_TRIAGE_LINE = "issue-triage";

export interface IssueTriageIssue {
  url: string;
  number: number;
  /** Every label on the issue; the sweep reads only the `triage:` ones. */
  labels?: readonly string[];
}

const TRIAGE_PREFIX = "triage: ";
const NEEDS_TRIAGE = "triage: needs-triage";

/** Not triaged yet: `needs-triage` is its only triage label. The line only ever adds labels, so an issue it reached keeps `needs-triage` beside a later one, and would be triaged again on every sweep. */
export function awaitingTriage(issue: IssueTriageIssue): boolean {
  const triageLabels = (issue.labels ?? [NEEDS_TRIAGE]).filter((label) =>
    label.startsWith(TRIAGE_PREFIX),
  );

  return triageLabels.length === 1 && triageLabels[0] === NEEDS_TRIAGE;
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
  const qualifying = issues.filter(awaitingTriage).slice(0, slots);

  return qualifying.length === 0 ? 0 : startRuns(repo, qualifying, deps);
}

async function startRuns(
  repo: string,
  issues: IssueTriageIssue[],
  deps: IssueTriageTickDeps,
): Promise<number> {
  const branch = await deps.defaultBranch(repo);

  for (const issue of issues) {
    await deps.floor.start(ISSUE_TRIAGE_LINE, triageStart(repo, issue, branch));
  }

  return issues.length;
}

/** The issue-triage line's start: every arg it declares, for the sweep and the webhook alike. */
export function triageStart(
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
      repo: valueItem(repo),
    },
  };
}

// Binds the issue-triage tick to the ports this process holds (composition root).
import {
  floorClient,
  floorConfigured,
} from "@re-cinq/lore-shared/floor/floor-client.js";
import { floorRepoOf } from "@re-cinq/lore-shared/floor/floor-items.js";
import { projectFor } from "../../outbound/project-boot.js";
import { settings } from "../../outbound/queues.js";
import { issueTriageTick, type IssueTriageIssue } from "./issue-triage-tick.js";

export const NO_FLOOR =
  "no external floor configured: the Floor walks issue-triage";

const DEFAULT_CAP = 3;

const NEEDS_TRIAGE_LABEL = "triage: needs-triage";

export async function runIssueTriageTick(
  params: Readonly<Record<string, unknown>>,
): Promise<string> {
  if (!floorConfigured()) {
    return NO_FLOOR;
  }

  return issueTriageTick(params, {
    repos: async () =>
      (await settings().onboardedRepos()).map((r) => r.full_name),
    needsTriageIssues: fetchNeedsTriageIssues,
    runningCount: countRunning,
    cap: DEFAULT_CAP,
    floor: { start: (line, args) => floorClient().lines.start(line, args) },
  });
}

async function fetchNeedsTriageIssues(
  repo: string,
): Promise<IssueTriageIssue[]> {
  const project = await projectFor(repo);
  const issues = await project.issues.list({
    state: "open",
    labels: [NEEDS_TRIAGE_LABEL],
  });

  return issues
    .filter((i) => i.url !== undefined)
    .sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""))
    .map((i) => ({ url: i.url as string, number: i.number }));
}

async function countRunning(repo: string): Promise<number> {
  const { items: activeRuns } = await floorClient().runs.list({
    repo: floorRepoOf(repo),
    line: "issue-triage",
    open: true,
  });

  return activeRuns.length;
}

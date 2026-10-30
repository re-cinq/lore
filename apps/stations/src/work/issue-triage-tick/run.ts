// Binds the issue-triage tick to the ports this process holds (composition root).
import {
  floorClient,
  floorConfigured,
} from "@re-cinq/lore-shared/floor/floor-client.js";
import { floorRepoOf } from "@re-cinq/lore-shared/floor/floor-items.js";
import { startLine } from "@re-cinq/lore-shared/review/floor-line-start.js";
import { projectFor } from "../../outbound/project-boot.js";
import { settings } from "../../outbound/queues.js";
import {
  enabledTriageRepos,
  issueTriageTick,
  type IssueTriageIssue,
  type OpenTriageRun,
} from "./issue-triage-tick.js";

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
      enabledTriageRepos(await settings().onboardedRepoSettings()),
    needsTriageIssues: fetchNeedsTriageIssues,
    openRuns: listOpenRuns,
    defaultBranch: async (repo) =>
      (await projectFor(repo)).repo.defaultBranch(),
    cap: DEFAULT_CAP,
    floor: {
      start: (line, args) => startLine(floorClient().lines, line, args),
    },
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
    .map((i) => ({ url: i.url as string, number: i.number, labels: i.labels }));
}

async function listOpenRuns(repo: string): Promise<OpenTriageRun[]> {
  const floor = floorClient();
  const { items: runs } = await floor.runs.list({
    repo: floorRepoOf(repo),
    line: "issue-triage",
    open: true,
  });

  return Promise.all(
    runs.map(async (run) => {
      const visits = await floor.stationRuns.list({ run: run.id });
      const { issue_number: issueItem } = run.startItems;

      return {
        issueNumber: Number(issueItem.ref),
        atGate: visits.some(
          (v) => v.nodeId === "human-gate" && v.report === null,
        ),
      };
    }),
  );
}

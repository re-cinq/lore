// The repository events that need no assembly line: an Issue labelled for Lore, a repository renamed, a pull request closed, a branch pushed, an issue or pull request changed, a release published, a repository moved to another team. They were handled by Lore's own Floor; they are answered here so it can be switched off (specs/external-floor FR16).
import type { EventHandler } from "@re-cinq/lore-shared/project/events/drain-loop.js";
import {
  dispatchLabeledIssue,
  type LabelDispatchDeps,
  type LabeledIssue,
} from "@re-cinq/lore-shared/backlog/label-dispatch.js";
import { PRIORITY_LABELS } from "@re-cinq/lore-shared/backlog/labels.js";

export interface RepoEventDeps {
  /** The ports a labelled Issue of this repository is dispatched through. */
  labelDispatch(repo: string): Promise<LabelDispatchDeps>;
  /** Whether the repository's triage loop is switched on (FR33); a label on a repository that switched it off starts nothing. */
  triageEnabled(repo: string): Promise<boolean>;
  /** Starts an issue-triage floor run for the given issue (FR7). */
  startIssueTriage(
    repo: string,
    issueNumber: number,
    issueUrl: string,
  ): Promise<string>;
  /** The `lore.repos` row follows the new name, so runs stop minting installation tokens for a name GitHub no longer serves (#2040), and so do the repository's agent overrides, floor variants keyed by its name (#4037). */
  renameRepo(from: string, to: string): Promise<string>;
  /** Returns the visit-id of the issue-triage run parked at human-gate for this issue, or null (FR16). */
  findParkedTriageVisit(
    repo: string,
    issueNumber: number,
  ): Promise<string | null>;
  /** Tells the graph a branch is done: every run on a pull request's head branch shares one overlay, so it goes when the pull request closes, merged or not (#1769). */
  dropOverlay(repo: string, branch: string): Promise<void>;
  /** Reports success to a parked human-gate visit so the triage run advances (FR16). */
  reportTriageGate(visitId: string): Promise<void>;
  /** A team change moves the repository's stored context into the team's schema, where reads now look; answers what it did. */
  relocateChunks(repo: string): Promise<string>;
  /** A push to the default branch has lore-api walk its new commits into the repo's Utopia knowledge base (specs/utopia-graph-mirror FR12); answers what the walk did, or why it was skipped. */
  mirrorCommits(repo: string, branch: string): Promise<string>;
  /** An issue or pull request that changed has lore-api walk what GitHub updated since its cursor into the repo's Utopia knowledge base (specs/utopia-graph-mirror FR14); answers what the walk did. */
  mirrorTracker(repo: string): Promise<string>;
  /** A published release or a created tag has lore-api push the repo's tags and releases into its Utopia knowledge base (specs/utopia-graph-mirror FR15); answers what the push did. */
  mirrorReleases(repo: string): Promise<string>;
}

export const REPO_EVENTS: readonly string[] = [
  "github.issues.labeled",
  "github.issue_comment",
  "github.repository.renamed",
  "github.pull_request.closed",
  "github.push",
  "github.tracker.changed",
  "github.release.changed",
  "internal.repo.team_changed",
];

export function repoEventHandlers(
  deps: RepoEventDeps,
): Map<string, EventHandler> {
  return new Map<string, EventHandler>([
    ["github.issues.labeled", issueLabeled(deps)],
    ["github.issue_comment", issueComment(deps)],
    ["github.repository.renamed", repositoryRenamed(deps)],
    ["github.pull_request.closed", pullRequestClosed(deps)],
    ["github.push", branchPushed(deps)],
    ["github.tracker.changed", trackerChanged(deps)],
    ["github.release.changed", releaseChanged(deps)],
    ["internal.repo.team_changed", teamChanged(deps)],
  ]);
}

const TRIAGE_TRIGGER_LABELS = ["lore:triage", "triage: needs-triage"] as const;

const WAITING_TRIAGE_LABELS = [
  "triage: needs-reproduction",
  "triage: unable-to-reproduce",
] as const;

/** Either hands the ticket to the implementation loop, so a triage run waiting at `human-gate` for that decision is done. */
const GATE_RELEASE_LABELS: readonly string[] = [
  "lore:implementation",
  ...PRIORITY_LABELS,
];

type LabeledIssueParams = {
  repo: string;
  label: string;
  issue: { number: number; html_url?: string; labels: readonly string[] };
};

function issueLabeled(deps: RepoEventDeps): EventHandler {
  return async (params) => {
    const { repo, label, issue } = params as unknown as LabeledIssueParams;

    if ((TRIAGE_TRIGGER_LABELS as readonly string[]).includes(label)) {
      await startTriageIfEnabled(deps, repo, issue);

      return;
    }

    const visitId = GATE_RELEASE_LABELS.includes(label)
      ? await deps.findParkedTriageVisit(repo, issue.number)
      : null;

    if (visitId) {
      await deps.reportTriageGate(visitId);
    }

    const labeled: LabeledIssue = { repo, label, issue };

    await dispatchLabeledIssue(await deps.labelDispatch(repo), labeled);
  };
}

async function startTriageIfEnabled(
  deps: RepoEventDeps,
  repo: string,
  issue: LabeledIssueParams["issue"],
): Promise<void> {
  if (!(await deps.triageEnabled(repo))) {
    console.log(
      `[stations] issue triage is switched off for ${repo}: #${issue.number} not started`,
    );

    return;
  }
  await deps.startIssueTriage(repo, issue.number, issue.html_url ?? "");
}

function issueComment(deps: RepoEventDeps): EventHandler {
  return async (params) => {
    const { repo, issue } = params as unknown as {
      repo: string;
      issue: { number: number; labels: readonly string[] };
    };
    const labels: readonly string[] = issue.labels;
    const needsRetriage = (WAITING_TRIAGE_LABELS as readonly string[]).some(
      (l) => labels.includes(l),
    );

    if (needsRetriage) {
      await (
        await deps.labelDispatch(repo)
      ).addLabel(issue.number, "triage: needs-triage");
    }
  };
}

function repositoryRenamed(deps: RepoEventDeps): EventHandler {
  return async (params) => {
    const { from, to } = params as { from: string; to: string };
    const outcome = await deps.renameRepo(from, to);

    console.log(`[stations] repository ${from} renamed to ${to}: ${outcome}`);
  };
}

// The drop is idempotent, so a redelivered close is safe.
function pullRequestClosed(deps: RepoEventDeps): EventHandler {
  return async (params) => {
    const { repo, branch } = params as { repo?: string; branch?: string };

    if (repo && branch) {
      await deps.dropOverlay(repo, branch);
    }
  };
}

// lore-api skips any branch but the default one itself, so every push is posted.
function branchPushed(deps: RepoEventDeps): EventHandler {
  return async (params) => {
    const { repo, branch } = params as { repo?: string; branch?: string };

    if (repo && branch) {
      const outcome = await deps.mirrorCommits(repo, branch);

      console.log(`[stations] push to ${repo} ${branch}: ${outcome}`);
    }
  };
}

function trackerChanged(deps: RepoEventDeps): EventHandler {
  return async (params) => {
    const { repo } = params as { repo?: string };

    if (repo) {
      const outcome = await deps.mirrorTracker(repo);

      console.log(`[stations] tracker of ${repo} changed: ${outcome}`);
    }
  };
}

function releaseChanged(deps: RepoEventDeps): EventHandler {
  return async (params) => {
    const { repo } = params as { repo?: string };

    if (repo) {
      const outcome = await deps.mirrorReleases(repo);

      console.log(`[stations] releases of ${repo} changed: ${outcome}`);
    }
  };
}

function teamChanged(deps: RepoEventDeps): EventHandler {
  return async (params) => {
    const { repo } = params as { repo: string };
    const outcome = await deps.relocateChunks(repo);

    console.log(`[stations] team changed for ${repo}: ${outcome}`);
  };
}

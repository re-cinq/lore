// The repository events that need no assembly line: an Issue labelled for Lore, a repository renamed, a pull request closed. They were handled by Lore's own Floor; they are answered here so it can be switched off (specs/external-floor FR16).
import type { EventHandler } from "@re-cinq/lore-shared/project/events/drain-loop.js";
import {
  dispatchLabeledIssue,
  type LabelDispatchDeps,
  type LabeledIssue,
} from "@re-cinq/lore-shared/backlog/label-dispatch.js";

export interface RepoEventDeps {
  /** The ports a labelled Issue of this repository is dispatched through. */
  labelDispatch(repo: string): Promise<LabelDispatchDeps>;
  /** The `lore.repos` row follows the new name, so runs stop minting installation tokens for a name GitHub no longer serves (#2040). */
  renameRepo(from: string, to: string): Promise<string>;
  /** Tells the graph a branch is done: every run on a pull request's head branch shares one overlay, so it goes when the pull request closes, merged or not (#1769). */
  dropOverlay(repo: string, branch: string): Promise<void>;
}

export const REPO_EVENTS: readonly string[] = [
  "github.issues.labeled",
  "github.repository.renamed",
  "github.pull_request.closed",
];

export function repoEventHandlers(
  deps: RepoEventDeps,
): Map<string, EventHandler> {
  return new Map<string, EventHandler>([
    ["github.issues.labeled", issueLabeled(deps)],
    ["github.repository.renamed", repositoryRenamed(deps)],
    ["github.pull_request.closed", pullRequestClosed(deps)],
  ]);
}

function issueLabeled(deps: RepoEventDeps): EventHandler {
  return async (params) => {
    const labeled = params as unknown as LabeledIssue;

    await dispatchLabeledIssue(await deps.labelDispatch(labeled.repo), labeled);
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

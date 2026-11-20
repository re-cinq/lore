import type { IngestWorkflowStatus } from "./ingest-workflow";

/** What deciding an Update setup offer needs from a repo: its name and whether its onboarding has landed. */
export interface WorkflowFixRepo {
  full_name: string;
  onboarding_pr_merged: boolean;
}

/** The repos whose workflow is missing or stale AND whose onboarding PR has merged. A repo still being onboarded reads as "missing" only because its scaffolding is on an unmerged branch — offering it Update setup would start a second onboarding beside the first. */
export function reposNeedingWorkflowFix(
  repos: readonly WorkflowFixRepo[],
  status: ReadonlyMap<string, IngestWorkflowStatus>,
): string[] {
  return repos
    .filter((repo) => repo.onboarding_pr_merged)
    .filter((repo) => {
      const current = status.get(repo.full_name);

      return current === "missing" || current === "stale";
    })
    .map((repo) => repo.full_name);
}

/** The repos Update setup is offered for: those with either workflow missing or stale, each once. */
export function reposNeedingSetupUpdate(
  repos: readonly WorkflowFixRepo[],
  ingestStatus: ReadonlyMap<string, IngestWorkflowStatus>,
  impactStatus: ReadonlyMap<string, IngestWorkflowStatus>,
): string[] {
  const flagged = new Set([
    ...reposNeedingWorkflowFix(repos, ingestStatus),
    ...reposNeedingWorkflowFix(repos, impactStatus),
  ]);

  return repos
    .map((repo) => repo.full_name)
    .filter((name) => flagged.has(name));
}

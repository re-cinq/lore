import type { IngestWorkflowStatus } from "./ingest-workflow";

/** What deciding a fix-PR offer needs from a repo: its name and whether its onboarding has landed. */
export interface WorkflowFixRepo {
  full_name: string;
  onboarding_pr_merged: boolean;
}

/** The repos whose workflow is missing or stale AND whose onboarding PR has merged. A repo still being onboarded reads as "missing" only because its scaffolding is on an unmerged branch — offering it a fix PR would open a second PR beside the onboarding one. */
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

/**
 * Result of a batch "fix workflow" action. `failed` carries the per-repo
 * reason a PR was NOT opened — the GitHub App lacking the Workflows
 * permission kept this silent for the org's entire history (#1545's
 * sibling bug), so no failure is ever swallowed into a bare count again.
 */
export type FixWorkflowResult = {
  opened: number;
  prs: string[];
  failed: { repo: string; error: string }[];
};

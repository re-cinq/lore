/** Result of batch "fix workflow" action; failed carries per-repo reason (#1545). */
export type FixWorkflowResult = {
  opened: number;
  prs: string[];
  failed: { repo: string; error: string }[];
};

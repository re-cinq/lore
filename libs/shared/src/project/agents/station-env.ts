/** The task fields the plain Station env is derived from (structural subset of
 *  LoreTaskSpec, so the job-builder's local spec shape is also accepted). */
export interface StationEnvSpec {
  targetRepo: string;
  branch: string;
  prompt: string;
  taskId: string;
  model?: string;
  taskType?: string;
  prNumber?: number;
  description?: string;
  darkFactory?: { workflowName: string; baseBranch: string };
}

/**
 * The plain (non-secret) environment a Station container needs, derived from the
 * task spec. Shared by BOTH backends so they can't drift (ADR-028): the K8s
 * job-builder maps these into `V1EnvVar` and appends `secretKeyRef`s for the
 * secrets; the Docker backend passes these as `-e NAME=value` and resolves the
 * secrets (GitHub token, LLM key, API URL) itself. Secrets + LORE_API_URL are
 * intentionally NOT here — their source differs per backend.
 */
export function stationPlainEnv(
  spec: StationEnvSpec,
): Array<{ name: string; value: string }> {
  return [
    { name: "TARGET_REPO", value: spec.targetRepo },
    { name: "BRANCH_NAME", value: spec.branch },
    { name: "TASK_PROMPT", value: spec.prompt },
    { name: "MODEL", value: spec.model || "claude-sonnet-4-6" },
    { name: "TASK_TYPE", value: spec.taskType || "implementation" },
    { name: "PR_NUMBER", value: String(spec.prNumber || "") },
    {
      name: "LORE_DARK_FACTORY_WORKFLOW",
      value: spec.darkFactory?.workflowName ?? "",
    },
    { name: "BASE_BRANCH", value: spec.darkFactory?.baseBranch ?? "" },
    { name: "LORE_TASK_ID", value: spec.taskId },
    { name: "TASK_DESCRIPTION", value: spec.description ?? spec.prompt },
  ];
}

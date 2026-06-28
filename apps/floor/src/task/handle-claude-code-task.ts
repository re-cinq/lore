/**
 * LoreTask CR handler.
 *
 * Handle complex tasks (implementation, refactoring) by creating a
 * LoreTask custom resource on the cluster.
 */

import { projectFor } from "../composition/project-boot.js";
import { buildPrompt, getTaskTypeConfig } from "../kernel/config.js";
import { agentPrompt } from "../kernel/agent-invocation.js";

// ── LoreTask CR handler ─────────────────────────────────────────────

/**
 * Handle complex tasks (implementation, refactoring) by creating a
 * LoreTask custom resource on the cluster. The loretask-controller
 * provisions an ephemeral Job with Claude Code inside. When the Job
 * completes, the loretask-watcher job picks up the result and creates
 * a PR.
 */
export async function handleClaudeCodeTask(
  task: any,
  targetRepo: string,
  branchName: string,
  model: string | undefined,
  _issueNumber: number | null,
  repoOverrides?: any,
  darkFactoryWorkflow?: string,
  darkFactoryBaseBranch?: string,
  image?: string,
  agentDef?: { prompt?: string | null; timeout_minutes?: number | null } | null,
): Promise<void> {
  // Prompt + timeout from the resolved agent definition (project.agentDefs), with
  // the yaml loader as the fallback. The runner can also re-fetch the prompt
  // from the agent-definitions API via AgentDefsHttp once in the pod.
  const fullPrompt = agentPrompt(
    agentDef?.prompt,
    task.description,
    buildPrompt(task.task_type, task.description),
  );
  const timeoutMinutes =
    agentDef?.timeout_minutes ||
    repoOverrides?.timeout_minutes ||
    getTaskTypeConfig(task.task_type)?.timeout_minutes ||
    30;

  // Dark-factory mode (PR #309): the label drives `kubectl get loretasks -l
  // lore.re-cinq.com/dark-factory=true`; the spec.darkFactory block routes the
  // Job pod's entrypoint.sh to the supervisor CLI instead of legacy claude --print.
  const project = await projectFor(targetRepo);
  const result = await project.agents.run(task.id, {
    mode: "cluster",
    taskType: task.task_type,
    description: task.description,
    prompt: fullPrompt,
    branch: branchName,
    model: model || "claude-sonnet-4-6",
    timeoutMinutes,
    ...(image ? { image } : {}),
    ...(darkFactoryWorkflow
      ? {
          extraLabels: { "lore.re-cinq.com/dark-factory": "true" },
          darkFactory: { workflowName: darkFactoryWorkflow, baseBranch: darkFactoryBaseBranch ?? "main" },
        }
      : {}),
  });

  // Synchronous Station backends (Docker, local) carry the run's completion back —
  // there's no loretask-watcher locally, so finalize the run inline (open the PR /
  // complete the task). Async backends (K8s) omit completion; the watcher resolves
  // it later. See ADR-028.
  if (result.completion) {
    const { finalizeStationRun } = await import("./finalize-station-run.js");
    await finalizeStationRun({ task, targetRepo, branch: branchName, completion: result.completion, project });
    return;
  }

  const crName = `loretask-${task.id.substring(0, 8)}`;
  console.log(
    result.started
      ? `[agent] Created LoreTask CR ${crName} for task ${task.id}`
      : `[agent] LoreTask CR ${crName} already exists, skipping`,
  );
  // Don't set pr-created — the loretask-watcher will do that when the Job completes
}

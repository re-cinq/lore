import type { PipelineTask } from "@re-cinq/lore-shared";
/**
 * Cluster task handler.
 *
 * Handle complex tasks (implementation, refactoring) by dispatching an Agent CR
 * to the ai-agent-subsystem (agent-cr) via the Project agents port.
 */

import { projectFor } from "../../composition/project-boot.js";
import { buildPrompt, getTaskTypeConfig } from "../../kernel/config.js";
import { agentPrompt } from "../../kernel/agent-invocation.js";
import { ensureTaskBranch } from "./ensure-task-branch.js";

// ── Cluster task handler ────────────────────────────────────────────

/**
 * Handle complex tasks (implementation, refactoring) by dispatching an Agent CR
 * to the ai-agent-subsystem. The agent-cr backend runs the Agent (or the
 * Floor-side assembly line graph) and the agent-watcher job creates the PR when it
 * completes.
 */
export async function handleClaudeCodeTask(
  task: PipelineTask,
  targetRepo: string,
  branchName: string,
  model: string | undefined,
  _issueNumber: number | null,
  repoOverrides?: Record<string, unknown>,
  darkFactoryAssemblyLine?: string,
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
  const configuredTimeoutMinutes =
    agentDef?.timeout_minutes ||
    (repoOverrides?.timeout_minutes as number | undefined) ||
    getTaskTypeConfig(task.task_type)?.timeout_minutes;
  const timeoutMinutes = configuredTimeoutMinutes || 30;

  // Dark-factory mode: the label marks the CR `lore.re-cinq.com/dark-factory=true`
  // and the spec.darkFactory block tells the agent-cr backend to run the
  // Floor-side assembly line graph for this task type.
  const project = await projectFor(targetRepo);

  // The CR's recipe pins `ref: branchName` and the pod's init checks it out, so the
  // branch has to exist before dispatch — otherwise the run dies in its init
  // container instead of ever reaching the agent.
  await ensureTaskBranch(project.repo, branchName);

  const result = await project.agents.run(task.id, {
    mode: "cluster",
    taskType: task.task_type,
    description: task.description,
    prompt: fullPrompt,
    branch: branchName,
    model: model || "claude-sonnet-4-6",
    timeoutMinutes,
    ...(image ? { image } : {}),
    ...(darkFactoryAssemblyLine
      ? {
          extraLabels: { "lore.re-cinq.com/dark-factory": "true" },
          // `workflowName` is the CR-spec wire field (read by the pod via LORE_DARK_FACTORY_WORKFLOW) — renaming it needs both sides.
          darkFactory: {
            workflowName: darkFactoryAssemblyLine,
            baseBranch: darkFactoryBaseBranch ?? "main",
          },
        }
      : {}),
  });

  // A synchronous Station backend would carry the run's completion back, so
  // finalize inline. The agent-cr backend is async (K8s) and omits completion;
  // the agent-watcher resolves it later. See ADR-028.
  if (result.completion) {
    const { finalizeStationRun } = await import("./finalize-station-run.js");

    await finalizeStationRun({
      task,
      targetRepo,
      branch: branchName,
      completion: result.completion,
      project,
    });

    return;
  }

  console.log(
    result.started
      ? `[floor] Dispatched Agent CR for task ${task.id}`
      : `[floor] Agent CR for task ${task.id} already exists, skipping`,
  );
  // Don't set pr-created — the agent-watcher will do that when the Agent completes.
}

import type { PipelineTask } from "@re-cinq/lore-shared";

import { projectFor } from "../../composition/project-boot.js";
import { buildPrompt, getTaskTypeConfig } from "../../kernel/config.js";
import { agentPrompt } from "../../kernel/agent-invocation.js";
import { ensureTaskBranch } from "./ensure-task-branch.js";

/** Handle complex tasks (implementation, refactoring) by dispatching an Agent CR to the ai-agent-subsystem via the Project agents port; the agent-watcher job creates the PR when it completes. */
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
  // Prompt + timeout from the resolved agent definition (project.agentDefs), falling back to the yaml loader; the pod can also re-fetch via AgentDefsHttp.
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

  const project = await projectFor(targetRepo);

  // The CR's recipe pins `ref: branchName`, so it must exist before dispatch or the run dies in its init container.
  await ensureTaskBranch(project.repo, branchName);

  const featureId = task.context_bundle?.feature_id;
  const roundFeedback = task.context_bundle?.round_feedback;
  const resumeFromTask = task.context_bundle?.resume_from_task;
  const lineArgs = task.context_bundle?.line_args;
  const result = await project.agents.run(task.id, {
    mode: "cluster",
    taskType: task.task_type,
    // Threaded so `continues.key: args.feature_id` resolves — the assembly-line engine never learns what a feature is.
    ...(typeof featureId === "string" ? { featureId } : {}),
    ...(typeof roundFeedback === "string" ? { roundFeedback } : {}),
    ...(typeof resumeFromTask === "string" ? { resumeFromTask } : {}),
    ...(lineArgs && typeof lineArgs === "object" && !Array.isArray(lineArgs)
      ? { lineArgs: lineArgs as Record<string, unknown> }
      : {}),
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

  // A synchronous Station backend carries completion back for inline finalize; the async agent-cr (K8s) backend omits it — the agent-watcher resolves it later (ADR-028).
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

  // A joined dispatch started nothing — another run already held this subject — so the task is DONE; leaving it `running` would strand it until the stale sweep (pre-subject-guard duplicate-click symptom).
  if (result.joinedRun) {
    // `completed` with NO failure_reason: the task page renders failure_reason in failure styling, which would misreport a succeeded task.
    await project.tasks.setStatus(task.id, "completed");
    console.log(
      `[floor] task ${task.id} joined run ${result.joinedRun}; nothing dispatched`,
    );

    return;
  }

  console.log(
    result.started
      ? `[floor] Dispatched Agent CR for task ${task.id}`
      : `[floor] Agent CR for task ${task.id} already exists, skipping`,
  );
  // Don't set pr-created — the agent-watcher will do that when the Agent completes.
}

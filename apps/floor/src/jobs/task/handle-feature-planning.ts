import type { PipelineTask } from "@re-cinq/lore-shared";
import { errorMessage } from "@re-cinq/lore-shared";
/**
 * In-process feature-planning handler (ADR-027, revised for local + cluster).
 *
 * A planning round is a single LLM→JSON call producing a GapResult — no repo
 * mutation — so it runs in-process here rather than in a K8s Job pod. (The pod
 * path required a cluster and failed on local dev with "Invalid URL".) The
 * result is persisted through project.features; failures are surfaced by marking
 * the iteration `failed` so the UI can show the error + a retry.
 */

import { Llm } from "@re-cinq/lore-shared";
import {
  parseGapResult,
  sanitizeGapResult,
  decideFeatureStatus,
  isPlanningPhase,
} from "@re-cinq/lore-shared/feature-planning/gap-result.js";
import { PLANNING_INSTRUCTIONS } from "@re-cinq/lore-shared/feature-planning/planning-instructions.js";
import { parseModelJson } from "@re-cinq/lore-shared/feature-planning/model-json.js";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { projectFor } from "../../composition/project-boot.js";
import { fetchRepoContext } from "./repo-context.js";
import { setStatus, insertEvent } from "./task-helpers.js";

export async function handleFeaturePlanning(
  task: PipelineTask,
  targetRepo: string,
): Promise<void> {
  const featureId: string | undefined = task.context_bundle?.feature_id as
    string | undefined;
  const iteration: number | undefined = task.context_bundle?.iteration as
    number | undefined;

  enforceTrue(
    featureId && iteration != null,
    "feature-planning task is missing feature_id/iteration in context_bundle",
  );

  const project = await projectFor(targetRepo);
  const features = project.features;
  // Resolve the feature-planning agent definition (project → org → yaml/code) so
  // the prompt + model come from lore.agent_definitions; fall back to the constant.
  const agentDef = await project.agentDefs
    .resolve("feature-planning")
    .catch(() => null);

  await setStatus(task.id, "running");
  await insertEvent(task.id, "queued", "running");

  try {
    const context = await fetchRepoContext(targetRepo);
    const result = await Llm.instance.complete({
      prompt: `${task.description}\n\n## Repository Context\n\n${JSON.stringify(context, null, 2)}`,
      systemPrompt: agentDef?.prompt ?? PLANNING_INSTRUCTIONS,
      model: agentDef?.model ?? "claude-sonnet-4-6",
      maxTokens: 8192,
      taskId: task.id,
    });

    const gap = sanitizeGapResult(parseGapResult(parseModelJson(result.text)));

    await features.setIterationResult(featureId, iteration, gap, "ready");
    // Only advance a feature still mid-planning — a stale/duplicate round
    // completing after finalize must not drag pr-open back into the wizard.
    const feature = await features.get(featureId);

    if (feature && isPlanningPhase(feature.status)) {
      await features.transitionStatus(featureId, decideFeatureStatus(gap), {
        draft_spec_md: gap.draft_spec_markdown,
      });
    }

    await setStatus(task.id, "completed");
    await insertEvent(task.id, "running", "completed", {
      feature_id: featureId,
      iteration,
    });
    console.log(
      `[floor] feature-planning round ${iteration} ready for feature ${featureId}`,
    );
  } catch (err) {
    // Surface the failure: mark the iteration failed; re-throw so the task is
    // recorded as failed too. Only drop the feature to 'draft' if no round ever
    // produced a result (else keep the prior status). Guard the move so a stale
    // failure can't drag an already-finalized feature back into the wizard.
    await features
      .setIterationResult(featureId, iteration, null, "failed")
      .catch(() => {});
    const failedFeature = await features.get(featureId).catch(() => null);

    if (
      failedFeature &&
      isPlanningPhase(failedFeature.status) &&
      !failedFeature.iterations.some((i) => i.gap_result)
    ) {
      await features.transitionStatus(featureId, "draft").catch(() => {});
    }
    await setStatus(task.id, "failed", { failure_reason: errorMessage(err) });
    await insertEvent(task.id, "running", "failed", {
      reason: errorMessage(err),
    });
    console.error(
      `[floor] feature-planning round ${iteration} failed for feature ${featureId}: ${errorMessage(err)}`,
    );
    throw err;
  }
}

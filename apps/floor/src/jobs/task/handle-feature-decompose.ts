import type { PipelineTask } from "@re-cinq/lore-shared";
import { errorMessage } from "@re-cinq/lore-shared";
/**
 * In-process feature-decompose handler (ADR-029).
 *
 * Runs when a finalized feature's spec PR merges: reads the merged spec, asks the
 * decomposition agent for a user-story → task tree, opens one Issue per story
 * (subject to the dark-factory create_issue policy), and creates a `spec-task`
 * pipeline row per task wired into the existing implementation pipeline. The LLM
 * call plus the Issue/pipeline writes are all coordinator-side, so this runs
 * in-process rather than in a Station pod. Idempotent on (repo, spec_slug).
 */

import { randomUUID } from "node:crypto";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { Llm } from "@re-cinq/lore-shared";
import { parseDecomposition } from "@re-cinq/lore-shared/feature-planning/decomposition-result.js";
import {
  specTaskRows,
  storyIssueBody,
} from "@re-cinq/lore-shared/feature-planning/decomposition-plan.js";
import { DECOMPOSITION_INSTRUCTIONS } from "@re-cinq/lore-shared/feature-planning/decomposition-instructions.js";
import { parseModelJson } from "@re-cinq/lore-shared/feature-planning/model-json.js";
import { taskQueue } from "../../kernel/queues.js";
import { projectFor } from "../../composition/project-boot.js";
import { fetchRepoContext } from "./repo-context.js";
import { setStatus, insertEvent } from "./task-helpers.js";

interface FinalizeTaskShape {
  task_type?: string;
  context_bundle?: { feature_id?: string; slug?: string } | null;
}

/** Pure: should a just-merged task kick decomposition, and for which feature?
 *  Fires only for a `feature-finalize` task that carries a feature id. */
export function decideDecomposeKick(task: FinalizeTaskShape): {
  kick: boolean;
  featureId?: string;
  slug?: string;
} {
  if (task.task_type !== "feature-finalize") {
    return { kick: false };
  }
  const featureId = task.context_bundle?.feature_id;

  if (!featureId) {
    return { kick: false };
  }

  return { kick: true, featureId, slug: task.context_bundle?.slug };
}

export async function handleFeatureDecompose(
  task: PipelineTask,
  targetRepo: string,
): Promise<void> {
  const featureId: string | undefined = task.context_bundle?.feature_id as
    | string
    | undefined;

  enforceTrue(
    featureId,
    "feature-decompose task is missing feature_id in context_bundle",
  );

  const project = await projectFor(targetRepo);

  await setStatus(task.id, "running");
  await insertEvent(task.id, "queued", "running");

  try {
    const feature = await project.features.get(featureId);

    enforceTrue(feature, `feature ${featureId} not found`);
    const specSlug = feature.slug;

    // Idempotency: a feature already broken into spec-tasks is left untouched
    // (a re-merge, replay, or the cron + webhook both firing must not duplicate).
    const alreadyDecomposed = await taskQueue().hasSpecTasksForSlug(
      targetRepo,
      specSlug,
    );

    if (alreadyDecomposed) {
      await setStatus(task.id, "completed");
      await insertEvent(task.id, "running", "completed", {
        feature_id: featureId,
        skipped: "already-decomposed",
      });
      console.log(
        `[floor] feature-decompose: ${specSlug} already has spec-tasks — skipping`,
      );

      return;
    }

    const specPath = `specs/${specSlug}/spec.md`;
    const specMd =
      (await project.repo.read(specPath).catch(() => null)) ??
      feature.draft_spec_md;

    enforceTrue(specMd, `no spec content at ${specPath} or in draft_spec_md`);

    const agentDef = await project.agentDefs
      .resolve("feature-decompose")
      .catch(() => null);
    const context = await fetchRepoContext(targetRepo);
    const result = await Llm.instance.complete({
      prompt: `# Feature spec to decompose\n\n${specMd}\n\n## Repository Context\n\n${JSON.stringify(context, null, 2)}`,
      systemPrompt: agentDef?.prompt ?? DECOMPOSITION_INSTRUCTIONS,
      model: agentDef?.model ?? "claude-sonnet-4-6",
      maxTokens: 8192,
      taskId: task.id,
    });

    const decomposition = parseDecomposition(parseModelJson(result.text));

    const { shouldCreateIssue } =
      await import("../dark-factory/dark-factory.js");
    const createIssues = (await shouldCreateIssue(task)).create;
    const taskGroupId = randomUUID();
    let storiesCreated = 0;
    let tasksCreated = 0;

    for (const story of decomposition.stories) {
      let storyIssue: number | undefined;

      if (createIssues) {
        try {
          const issue = await project.issues.create(
            `User story: ${story.title}`,
            storyIssueBody(story, { specPath, featureTitle: feature.title }),
            ["lore-managed", "user-story"],
          );

          storyIssue = issue.number;
          storiesCreated++;
        } catch (err) {
          console.warn(
            `[floor] feature-decompose: could not create Issue for story "${story.title}": ${errorMessage(err)}`,
          );
        }
      }

      for (const row of specTaskRows(story, {
        specSlug,
        featureId,
        storyIssue,
      })) {
        const insertedId = await taskQueue().insertTask({
          description: row.title,
          taskType: "spec-task",
          targetRepo,
          status: "pending",
          contextBundle: row.metadata,
          createdBy: "feature-decompose",
          taskGroupId,
        });

        if (insertedId) {
          tasksCreated++;
        }
      }
    }

    await setStatus(task.id, "completed");
    await insertEvent(task.id, "running", "completed", {
      feature_id: featureId,
      stories: storiesCreated,
      tasks: tasksCreated,
      task_group_id: taskGroupId,
    });
    console.log(
      `[floor] feature-decompose: ${specSlug} → ${storiesCreated} stories, ${tasksCreated} spec-tasks (group ${taskGroupId})`,
    );
  } catch (err) {
    await setStatus(task.id, "failed", { failure_reason: errorMessage(err) });
    await insertEvent(task.id, "running", "failed", { reason: errorMessage(err) });
    console.error(
      `[floor] feature-decompose failed for feature ${featureId}: ${errorMessage(err)}`,
    );
    throw err;
  }
}

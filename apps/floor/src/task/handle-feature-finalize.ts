/**
 * In-process feature-finalize handler (ADR-027, revised for local + cluster).
 *
 * Commits the accumulated draft spec to a branch and opens a PR — reusing the
 * Project facade (works on local dev + cluster), rather than a K8s Job pod. The
 * feature row flips to pr-open so the Features tab shows the PR. A user-story
 * Issue is created when the dark-factory create_issue policy calls for it.
 */

import { prFooter } from "@re-cinq/lore-shared";
import { projectFor } from "../composition/project-boot.js";
import { setStatus, insertEvent } from "./task-helpers.js";

export async function handleFeatureFinalize(task: any, targetRepo: string): Promise<void> {
  const featureId: string | undefined = task.context_bundle?.feature_id;
  if (!featureId) {
    throw new Error("feature-finalize task is missing feature_id in context_bundle");
  }

  const project = await projectFor(targetRepo);
  const features = project.features;
  await setStatus(task.id, "running");
  await insertEvent(task.id, "queued", "running");

  try {
    const feature = await features.get(featureId);
    if (!feature) throw new Error(`feature ${featureId} not found`);
    if (!feature.draft_spec_md) throw new Error("feature has no draft spec to finalize");

    const specPath = `specs/${feature.slug}/spec.md`;
    const branch = `lore/feature-planning/${feature.slug}-${task.id.substring(0, 8)}`;

    await project.repo.createBranch(branch);
    await project.repo.commitFile(branch, specPath, feature.draft_spec_md, `lore: add ${specPath}`);

    // Conditional user-story Issue (reuses the existing dark-factory decision).
    const { shouldCreateIssue } = await import("../dark-factory/dark-factory.js");
    let issueNumber: number | undefined;
    let issueUrl: string | undefined;
    if ((await shouldCreateIssue(task)).create) {
      try {
        const issue = await project.issues.create(
          `User story: ${feature.title}`,
          `${feature.original_prompt}\n\n---\nSpec: \`${specPath}\` (see the linked PR).`,
          ["lore-managed", "user-story"],
        );
        issueNumber = issue.number;
        issueUrl = issue.url;
      } catch (err: any) {
        console.warn(`[agent] feature-finalize: could not create user-story Issue: ${err.message}`);
      }
    }

    const pr = await project.pulls.open(
      branch,
      `spec: ${feature.slug}`,
      `## Feature Specification\n\n${feature.title}\n\nFinalized from an interactive planning session.${prFooter({ issueNumber, taskId: task.id })}`,
      "main",
      ["spec", "needs-review"],
    );

    await features.transitionStatus(featureId, "pr-open", {
      spec_path: specPath,
      spec_pr_url: pr.url,
      spec_pr_number: pr.number,
      ...(issueNumber ? { issue_number: issueNumber } : {}),
      ...(issueUrl ? { issue_url: issueUrl } : {}),
    });

    await setStatus(task.id, "pr-created", { pr_url: pr.url, pr_number: pr.number, target_branch: branch });
    await insertEvent(task.id, "running", "pr-created", { pr_url: pr.url, feature_id: featureId });
    console.log(`[agent] feature-finalize: feature ${featureId} → PR ${pr.url}`);
  } catch (err: any) {
    await setStatus(task.id, "failed", { failure_reason: err.message });
    await insertEvent(task.id, "running", "failed", { reason: err.message });
    console.error(`[agent] feature-finalize failed for feature ${featureId}: ${err.message}`);
    throw err;
  }
}

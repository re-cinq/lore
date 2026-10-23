// The blocked-reason station's composition root: the repo's Project, the pr_blocked_reasons table and Lore's App login.

import { autoMergeEnabled } from "@re-cinq/lore-shared/loops/loop-enabled.js";
import { loreAppLogin } from "@re-cinq/lore-shared/project/github-installations/lore-app-login.js";
import { projectFor } from "../outbound/project-boot.js";
import { pipeline } from "../outbound/queues.js";
import type { BlockedReasonDeps } from "./station.js";

/** Called on each delivery, after the pool exists. */
export function productionDeps(): BlockedReasonDeps {
  return {
    appLogin: loreAppLogin,
    reasons: pipeline().prBlockedReasons,
    project: async (repo) => {
      const project = await projectFor(repo);
      const { tasks } = project;

      return {
        pulls: project.pulls,
        issues: project.issues,
        repo: project.repo,
        audit: project.audit,
        taskIssue: async (taskId) =>
          (await tasks.getById(taskId))?.issueNumber ?? null,
        autoMergeOn: async () =>
          autoMergeEnabled(await project.settings.rawSettings()),
      };
    },
  };
}

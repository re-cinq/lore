// The stations the external floor dispatches for the auto-merge line (specs/protected-branch-merge): the fix's replies on the pull request, and the approval and merge.
import { defineStation } from "@re-cinq/floor-station";
import type { Handle, Report, RunningStation } from "@re-cinq/floor-station";
import { codeownersOf, ownedPaths } from "@re-cinq/lore-shared/codeowners.js";
import { parsePullRequestUrl } from "@re-cinq/lore-shared/floor/floor-items.js";
import { autoMergeEnabled } from "@re-cinq/lore-shared/loops/loop-enabled.js";
import { loreAppLogin } from "@re-cinq/lore-shared/project/github-installations/lore-app-login.js";
import { loreReviewerGitHub } from "@re-cinq/lore-shared/project/github-installations/lore-reviewer.js";
import { projectFor } from "../outbound/project-boot.js";
import { postReply } from "../code-review/post-reply/post-reply.js";
import {
  approveAndMerge,
  type Approver,
  type MergeProject,
} from "./approve-merge/approve-merge.js";

export interface ApproveMergeDeps {
  project(repo: string): Promise<MergeProject>;
  approver(repo: string): Promise<Approver | null>;
}

export function approveMergeHandle(deps: ApproveMergeDeps): Handle {
  return async (brief): Promise<Report> => {
    const { repo, prNumber } = parsePullRequestUrl(brief.needs.pr_url);
    const step = await approveAndMerge(
      await deps.project(repo),
      await deps.approver(repo),
      prNumber,
    );

    return step.outcome === "success"
      ? { outcome: "success", produced: { merge_state: step.state } }
      : {
          outcome: "failed",
          produced: { merge_blocked: step.reason },
          error: step.reason,
        };
  };
}

/** Posts the fix agent's replies in the threads it answered, on any review, and resolves the ones its commit settled. */
const fixRepliesHandle: Handle = async (brief, tools) => {
  const { repo, prNumber } = parsePullRequestUrl(brief.needs.pr_url);

  await postReply({
    poster: (await projectFor(repo)).pulls,
    prNumber,
    visitId: brief.visitId,
    iteration: brief.iteration,
    replyOutput: (await tools.read("fix_output")).toString("utf8"),
    reviewId: "any",
  });

  return { outcome: "success" };
};

const productionDeps: ApproveMergeDeps = {
  project: async (repo) => {
    const project = await projectFor(repo);

    return {
      pulls: project.pulls,
      audit: project.audit,
      sensitivePaths: async (prNumber) => {
        const [files, codeowners] = await Promise.all([
          project.pulls.listFiles(prNumber),
          codeownersOf(project.repo),
        ]);

        return ownedPaths(files, codeowners);
      },
      loopOn: async () =>
        autoMergeEnabled(await project.settings.rawSettings()),
    };
  },
  approver: async (repo) => {
    const reviewer = loreReviewerGitHub();

    if (reviewer) {
      return {
        approve: (prNumber, body) =>
          reviewer.review(repo, prNumber, body, "APPROVE"),
      };
    }
    const { pulls } = await projectFor(repo);

    return {
      login: await loreAppLogin(),
      approve: (prNumber, body) => pulls.review(prNumber, body, "APPROVE"),
    };
  },
};

export function startAutoMergeStations(): RunningStation[] {
  return [
    defineStation("auto-merge-approve", approveMergeHandle(productionDeps)),
    defineStation("auto-merge-fix-replies", fixRepliesHandle),
  ];
}

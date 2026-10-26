// The station the external floor dispatches for the auto-merge line (specs/protected-branch-merge): the approval and merge. The line fixes nothing; the loop that opened a pull request keeps it mergeable.
import { defineStation } from "@re-cinq/floor-station";
import type { Handle, Report, RunningStation } from "@re-cinq/floor-station";
import { codeownersOf, ownersOfPath } from "@re-cinq/lore-shared/codeowners.js";
import { parsePullRequestUrl } from "@re-cinq/lore-shared/floor/floor-items.js";
import { autoMergeEnabled } from "@re-cinq/lore-shared/loops/loop-enabled.js";
import { loreAppLogin } from "@re-cinq/lore-shared/project/github-installations/lore-app-login.js";
import { loreReviewerGitHub } from "@re-cinq/lore-shared/project/github-installations/lore-reviewer.js";
import { projectFor } from "../outbound/project-boot.js";
import {
  approveAndMerge,
  type Approver,
  type MergeProject,
} from "./approve-merge/approve-merge.js";
import {
  askedAlready,
  codeOwnerPing,
  type OwnedPath,
} from "./approve-merge/code-owner-ping.js";

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

const productionDeps: ApproveMergeDeps = {
  project: async (repo) => {
    const project = await projectFor(repo);

    return {
      pulls: project.pulls,
      audit: project.audit,
      codeOwners: (prNumber) => ownedChanges(project, prNumber),
      askCodeOwners: async (prNumber, owned, ask) => {
        const comments = await project.pulls.listIssueComments(prNumber);

        if (!askedAlready(comments)) {
          await project.pulls.comment(prNumber, codeOwnerPing(owned, ask));
        }
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

type Project = Awaited<ReturnType<typeof projectFor>>;

/** The pull request's changed files a CODEOWNERS row assigns, each with its owners. */
async function ownedChanges(
  project: Project,
  prNumber: number,
): Promise<OwnedPath[]> {
  const [files, codeowners] = await Promise.all([
    project.pulls.listFiles(prNumber),
    codeownersOf(project.repo),
  ]);

  return files
    .map((path) => ({ path, owners: ownersOfPath(path, codeowners) }))
    .filter((row) => row.owners.length > 0);
}

export function startAutoMergeStations(): RunningStation[] {
  return [
    defineStation("auto-merge-approve", approveMergeHandle(productionDeps)),
  ];
}

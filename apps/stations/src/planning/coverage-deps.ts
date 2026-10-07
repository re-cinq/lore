// What the feature-planning line's coverage checks read: a file and the tree as a branch or commit holds them, and the run's visits, to count the rounds they already sent back.

import { floorClient } from "@re-cinq/lore-shared/floor/floor-client.js";
import { projectFor } from "../outbound/project-boot.js";
import { storyCoverageOf } from "@re-cinq/lore-shared/feature-planning/issue-coverage.js";
import { existingPlanIssues } from "./file-issues/plan-issue-filing.js";

export interface RunVisit {
  nodeId: string;
  report: { outcome: string } | null;
}

export interface CoverageDeps {
  /** A spec file as it stands at a branch or commit; null when there is no such file. */
  readSpec(repo: string, path: string, ref: string): Promise<string | null>;
  /** Every file path at a branch or commit. */
  listTree(repo: string, ref: string): Promise<string[]>;
  /** Every visit of the run this visit belongs to, oldest first. */
  visitsOf(visitId: string): Promise<RunVisit[]>;
  /** The uncovered statements the plan's story issue lists, body and comments; null when no story was filed. */
  filedCoverage(repo: string, planId: string): Promise<string[] | null>;
}

export const coverageDeps: CoverageDeps = {
  readSpec: async (repo, path, ref) =>
    (await projectFor(repo)).repo.read(path, ref),
  listTree: async (repo, ref) => (await projectFor(repo)).repo.tree(ref),
  visitsOf: async (visitId) => {
    const visit = await floorClient().stationRuns.get(visitId);

    return visit ? floorClient().stationRuns.list({ run: visit.runId }) : [];
  },
  filedCoverage: async (repo, planId) => {
    const project = await projectFor(repo);
    const { story } = await existingPlanIssues(project, planId);

    if (!story) {
      return null;
    }
    const comments = await project.issues.listComments(story.number);

    return storyCoverageOf(
      story.body ?? "",
      comments.map((comment) => comment.body),
      planId,
    );
  },
};

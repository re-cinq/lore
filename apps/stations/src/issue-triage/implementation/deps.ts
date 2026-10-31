import type { IssueCollection } from "@re-cinq/lore-shared/project/issues/issues.js";
import type { RepoFiles } from "@re-cinq/lore-shared/project/repo/repo-files.js";
import type { TestReport } from "@re-cinq/lore-shared/models/test-report.js";
import { projectFor } from "../../outbound/project-boot.js";
import { issueTestReport } from "../../outbound/issue-evidence.js";

export type ImplementationProject = {
  issues: Pick<
    IssueCollection,
    | "get"
    | "update"
    | "comment"
    | "listComments"
    | "linkedPullRequests"
    | "close"
    | "addLabel"
  >;
  repo: Pick<RepoFiles, "defaultBranch" | "headSha" | "read">;
};

export interface ImplementationDeps {
  project(repo: string): Promise<ImplementationProject>;
  report(repo: string, commit: string): Promise<TestReport | null>;
}

export const implementationDeps: ImplementationDeps = {
  project: projectFor,
  report: issueTestReport,
};

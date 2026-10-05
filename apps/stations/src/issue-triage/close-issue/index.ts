import type { Handle, RunningStation } from "@re-cinq/floor-station";
import { defineStation } from "@re-cinq/floor-station";

export interface CloseIssueDeps {
  issues(repo: string): Promise<{
    comment(number: number, body: string): Promise<void>;
    close(number: number): Promise<void>;
  }>;
}

const productionDeps: CloseIssueDeps = {
  issues: async (repo) => {
    const { projectFor } = await import("../../outbound/project-boot.js");

    return (await projectFor(repo)).issues;
  },
};

export function closeIssueHandle(deps: CloseIssueDeps): Handle {
  return async ({ needs }) => {
    const repo = needs.repo;
    const issueNumber = Number(needs.issue_number);
    const verdict = needs.verdict;
    const issues = await deps.issues(repo);

    await issues.comment(issueNumber, verdict);
    await issues.close(issueNumber);

    return { outcome: "success" };
  };
}

export function startCloseIssueStation(): RunningStation {
  return defineStation("close-issue", closeIssueHandle(productionDeps));
}

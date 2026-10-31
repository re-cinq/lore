import {
  defineStation,
  type Handle,
  type RunningStation,
  type Tools,
} from "@re-cinq/floor-station";
import type { TestReport } from "@re-cinq/lore-shared/models/test-report.js";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { implementationDeps, type ImplementationDeps } from "./deps.js";
import { issueSnapshot, issueScope, type IssueSnapshot } from "./scope.js";
import { issueThread } from "./thread.js";

export function loadImplementationHandle(deps: ImplementationDeps): Handle {
  return async ({ needs }, tools) => {
    try {
      const snapshot = await snapshotFor(needs, deps);

      if (!snapshot) {
        return { outcome: "closed" };
      }
      await publishScope(snapshot, deps, tools);

      return { outcome: "success" };
    } catch (error) {
      return { outcome: "failed", error: (error as Error).message };
    }
  };
}

async function snapshotFor(
  needs: Record<string, string>,
  deps: ImplementationDeps,
) {
  const project = await deps.project(needs.repo);
  const issue = await project.issues.get(Number(needs.issue_number));

  enforceTrue(issue, Error, "triage issue does not exist");

  if (issue.state === "closed") {
    return null;
  }
  const commit = await project.repo.headSha(await project.repo.defaultBranch());

  return issueSnapshot(issue, commit);
}

async function publishScope(
  snapshot: IssueSnapshot,
  deps: ImplementationDeps,
  tools: Tools,
): Promise<void> {
  const { issues } = await deps.project(snapshot.repo);
  const [report, comments, pulls] = await Promise.all([
    deps.report(snapshot.repo, snapshot.commit),
    issues.listComments(snapshot.number),
    issues.linkedPullRequests(snapshot.number),
  ]);

  await tools.produce("implementation_scope", JSON.stringify({ snapshot }));
  await tools.produce("issue_scope", issueScope(snapshot));
  await tools.produce("issue_thread", issueThread(comments, pulls));
  await tools.produce("test_report", recordedTestLines(report));
}

/** One recorded test per line, so the agent can search a commit's thousands of tests instead of reading them as one block. */
function recordedTestLines(report: TestReport | null): string {
  return (report?.tests ?? [])
    .map(({ id, runnerId, name, file, execution }) =>
      JSON.stringify({
        runnerId,
        name,
        file,
        execution,
        passed: report?.outcomes[id] === true,
      }),
    )
    .join("\n");
}

export function startLoadImplementationStation(): RunningStation {
  return defineStation(
    "triage-load-implementation",
    loadImplementationHandle(implementationDeps),
  );
}

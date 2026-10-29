import {
  defineStation,
  type Handle,
  type RunningStation,
  type Tools,
} from "@re-cinq/floor-station";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { implementationDeps, type ImplementationDeps } from "./deps.js";
import { issueSnapshot, issueScope, type IssueSnapshot } from "./scope.js";

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
  const report = await deps.report(snapshot.repo, snapshot.commit);

  await tools.produce(
    "implementation_scope",
    JSON.stringify({ snapshot, report }),
  );
  await tools.produce("issue_scope", issueScope(snapshot));
}

export function startLoadImplementationStation(): RunningStation {
  return defineStation(
    "triage-load-implementation",
    loadImplementationHandle(implementationDeps),
  );
}

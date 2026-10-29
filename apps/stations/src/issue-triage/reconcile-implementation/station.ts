import {
  defineStation,
  type Handle,
  type RunningStation,
} from "@re-cinq/floor-station";
import { floorClient } from "@re-cinq/lore-shared/floor/floor-client.js";
import {
  floorRepoOf,
  gitItem,
  valueItem,
} from "@re-cinq/lore-shared/floor/floor-items.js";
import { specTicketsKey } from "@re-cinq/lore-shared/spec-tickets/floor-spec-tickets.js";
import { startLine } from "@re-cinq/lore-shared/review/floor-line-start.js";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import type { IssueCollection } from "@re-cinq/lore-shared/project/issues/issues.js";
import type { RepoFiles } from "@re-cinq/lore-shared/project/repo/repo-files.js";
import type { IssueRef } from "@re-cinq/lore-shared/project/lib/github-port.js";
import { projectFor } from "../../outbound/project-boot.js";

type ReconciliationProject = {
  issues: Pick<
    IssueCollection,
    "get" | "listComments" | "comment" | "addLabel"
  >;
  repo: Pick<RepoFiles, "defaultBranch" | "headSha" | "read">;
};

export interface ReconcileImplementationDeps {
  project(repo: string): Promise<ReconciliationProject>;
  lines: Pick<ReturnType<typeof floorClient>["lines"], "start">;
}

export function reconcileImplementationHandle(
  deps: ReconcileImplementationDeps,
): Handle {
  return async ({ needs }) => {
    try {
      const project = await deps.project(needs.repo);
      const issue = await project.issues.get(Number(needs.issue_number));

      enforceTrue(issue, Error, "triage issue does not exist");
      const path = generatedSpec(issue);

      if (!path) {
        return { outcome: "not-generated" };
      }
      await reconcile(deps, project, issue, path);

      return { outcome: "delegated" };
    } catch (error) {
      return { outcome: "failed", error: (error as Error).message };
    }
  };
}

function generatedSpec(issue: IssueRef): string | null {
  const bug = issue.labels.some((label) => /^(bug|type:\s*bug)$/i.test(label));
  const marker =
    /^<!-- lore-plan-task: spec-([a-z0-9][a-z0-9-]*)\/[^\s/]+ -->$/m;

  if (bug || !issue.labels.includes("lore-managed")) {
    return null;
  }
  const match = marker.exec(issue.body ?? "");

  return match ? `specs/${match[1]}/spec.md` : null;
}

async function reconcile(
  deps: ReconcileImplementationDeps,
  project: ReconciliationProject,
  issue: IssueRef,
  path: string,
): Promise<void> {
  if (issue.state === "closed") {
    return;
  }
  const sha = await sourceRevision(project, path);
  const key = `${specTicketsKey(issue.repo, path, sha)}:triage`;

  await handoff(deps, project, issue, { path, sha, key });
  await project.issues.addLabel(issue.number, "triage: needs-priority");
}

async function sourceRevision(
  project: ReconciliationProject,
  path: string,
): Promise<string> {
  const sha = await project.repo.headSha(await project.repo.defaultBranch());

  enforceTrue(
    /^[0-9a-f]{40}$/i.test(sha),
    Error,
    "main revision is not a commit SHA",
  );
  const spec = await project.repo.read(path, sha);

  enforceTrue(
    spec !== null,
    Error,
    `generated issue spec ${path} does not exist at ${sha}`,
  );

  return sha;
}

type Reconciliation = { path: string; sha: string; key: string };

async function handoff(
  deps: ReconcileImplementationDeps,
  project: ReconciliationProject,
  issue: IssueRef,
  { path, sha, key }: Reconciliation,
): Promise<void> {
  const marker = `<!-- lore-triage-reconciliation: ${key} -->`;
  const comments = await project.issues.listComments(issue.number);

  if (comments.some((comment) => comment.body.includes(marker))) {
    return;
  }
  const started = await startLine(deps.lines, "spec-tickets", {
    repo: floorRepoOf(issue.repo),
    startItems: reconciliationItems(issue.repo, { path, sha, key }),
  });

  await project.issues.comment(
    issue.number,
    handoffComment(marker, path, sha, started.run.id),
  );
}

function handoffComment(
  marker: string,
  path: string,
  sha: string,
  run: string,
): string {
  return [
    marker,
    `Handed ${path} at ${sha} to implementation reconciliation (run ${run}).`,
    "This reassesses the source spec and its existing task IDs: verified completed tasks close with evidence, partial tasks retain only their remaining work, and newly discovered tasks wait for a person to prioritize. Handoff is not a completion verdict.",
  ].join("\n\n");
}

function reconciliationItems(repo: string, { path, sha, key }: Reconciliation) {
  return {
    target: { ...gitItem(repo, sha), sha },
    spec_path: valueItem(path),
    merge_sha: valueItem(sha),
    key: valueItem(key),
    queue: valueItem("false"),
  };
}

export function startReconcileImplementationStation(): RunningStation {
  return defineStation(
    "triage-reconcile-implementation",
    reconcileImplementationHandle({
      project: projectFor,
      lines: floorClient().lines,
    }),
  );
}

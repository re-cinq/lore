import {
  defineStation,
  type Handle,
  type RunningStation,
  type Tools,
} from "@re-cinq/floor-station";
import {
  implementationDeps,
  type ImplementationDeps,
  type ImplementationProject,
} from "../implementation/deps.js";
import {
  currentIssue,
  verifiedCompletionSchema,
  type IssueSnapshot,
  type BehavioralProof,
  type VerifiedCompletion,
} from "../implementation/scope.js";
import { behaviorIsVerified } from "../implementation/behavior.js";

export type CloseIssueDeps = ImplementationDeps;

export function closeIssueHandle(deps: CloseIssueDeps): Handle {
  return async ({ needs }, tools) => {
    try {
      const completion = await completionOf(needs, tools);

      if (!completion) {
        return { outcome: "unproven" };
      }

      return await closeVerified(deps, completion);
    } catch (error) {
      return { outcome: "failed", error: (error as Error).message };
    }
  };
}

async function completionOf(
  needs: Record<string, string>,
  tools: Tools,
): Promise<VerifiedCompletion | null> {
  if (!needs.verified_completion) {
    return null;
  }
  const raw = JSON.parse(
    (await tools.read("verified_completion")).toString("utf8"),
  );
  const completion = verifiedCompletionSchema.parse(raw);
  const { snapshot } = completion;

  return snapshot.repo === needs.repo &&
    snapshot.number === Number(needs.issue_number)
    ? completion
    : null;
}

async function closeVerified(
  deps: CloseIssueDeps,
  { snapshot, message, proofs }: VerifiedCompletion,
) {
  const project = await deps.project(snapshot.repo);
  const issue = await project.issues.get(snapshot.number);

  if (issue?.state === "closed") {
    return { outcome: "success" };
  }

  if (!issue || !(await currentIssue(snapshot, project, issue))) {
    return { outcome: "unproven" };
  }

  if (!(await currentBehavior(deps, snapshot, proofs, project))) {
    return { outcome: "unproven" };
  }
  await completeIssue(project.issues, snapshot, message);

  return { outcome: "success" };
}

async function currentBehavior(
  deps: CloseIssueDeps,
  snapshot: IssueSnapshot,
  proofs: BehavioralProof[],
  project: ImplementationProject,
): Promise<boolean> {
  const report = await deps.report(snapshot.repo, snapshot.commit);

  return behaviorIsVerified(snapshot, proofs, report, (path) =>
    project.repo.read(path, snapshot.commit),
  );
}

async function completeIssue(
  issues: ImplementationProject["issues"],
  snapshot: IssueSnapshot,
  message: string,
): Promise<void> {
  const marker =
    "<!-- lore-triage-completed: " +
    snapshot.repo +
    "#" +
    snapshot.number +
    "@" +
    snapshot.commit +
    " -->";
  const body = marker + "\n\n" + message;
  const comments = await issues.listComments(snapshot.number);

  if (!comments.some((comment) => comment.body.includes(marker))) {
    await issues.comment(snapshot.number, body);
  }
  await issues.close(snapshot.number, "completed");
}

export function startCloseIssueStation(): RunningStation {
  return defineStation("close-issue", closeIssueHandle(implementationDeps));
}

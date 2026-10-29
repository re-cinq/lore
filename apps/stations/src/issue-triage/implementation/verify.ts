import {
  defineStation,
  type Brief,
  type Handle,
  type RunningStation,
  type Tools,
} from "@re-cinq/floor-station";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import {
  implementationDeps,
  type ImplementationDeps,
  type ImplementationProject,
} from "./deps.js";
import {
  currentIssue,
  issueSnapshotSchema,
  type IssueSnapshot,
} from "./scope.js";
import { assessIssue } from "./assessment.js";
import { completionMessage, remainingIssueBody } from "./issue-write.js";

type Assessment = Awaited<ReturnType<typeof assessIssue>>;

export function verifyIssueImplementationHandle(
  deps: ImplementationDeps,
): Handle {
  return async (brief, tools) => {
    try {
      return await verifyVisit(deps, brief, tools);
    } catch (error) {
      const message = (error as Error).message;

      await tools.produce("implementation_report", message);

      return { outcome: correctionOutcome(brief), error: message };
    }
  };
}

function correctionOutcome(brief: Brief): string {
  return brief.iteration <= 3 ? "changes_requested" : "failed";
}

async function verifyVisit(
  deps: ImplementationDeps,
  brief: Brief,
  tools: Tools,
) {
  const snapshot = await readSnapshot(brief, tools);
  const project = await deps.project(snapshot.repo);
  const raw = (await tools.read("implementation_assessment")).toString("utf8");
  const assessment = await assessIssue(snapshot, raw, deps, project);

  await tools.produce(
    "implementation_report",
    assessment.objections.join("\n"),
  );

  return assessment.objections.length
    ? { outcome: correctionOutcome(brief) }
    : verifiedOutcome(assessment, snapshot, project, tools);
}

async function readSnapshot(
  brief: Brief,
  tools: Tools,
): Promise<IssueSnapshot> {
  const input = JSON.parse(
    (await tools.read("implementation_scope")).toString("utf8"),
  ) as { snapshot: unknown };
  const snapshot = issueSnapshotSchema.parse(input.snapshot);

  enforceTrue(
    snapshot.repo === brief.needs.repo &&
      snapshot.number === Number(brief.needs.issue_number),
    Error,
    "assessment does not belong to this issue",
  );

  return snapshot;
}

async function verifiedOutcome(
  assessment: Assessment,
  snapshot: IssueSnapshot,
  project: ImplementationProject,
  tools: Tools,
) {
  if (assessment.status === "missing") {
    return { outcome: "missing" };
  }

  if (!assessment.behavioral) {
    return { outcome: "unproven" };
  }

  if (!(await currentIssue(snapshot, project))) {
    return { outcome: "unproven" };
  }

  return applyAssessment(assessment, snapshot, project, tools);
}

async function applyAssessment(
  assessment: Assessment,
  snapshot: IssueSnapshot,
  project: ImplementationProject,
  tools: Tools,
) {
  const { task, status, proofs } = assessment;

  if (task.needs_person) {
    await project.issues.addLabel(snapshot.number, "lore:blocked");
  }

  if (status === "partial") {
    const body = remainingIssueBody(snapshot, task, proofs);

    await project.issues.update(snapshot.number, { body });

    return { outcome: "partial" };
  }

  if (task.needs_person) {
    return { outcome: "unproven" };
  }

  return recordCompletion(assessment, snapshot, tools);
}

async function recordCompletion(
  assessment: Assessment,
  snapshot: IssueSnapshot,
  tools: Tools,
) {
  const { evidence, proofs } = assessment;
  const message = completionMessage(snapshot, evidence, proofs);

  await tools.produce(
    "verified_completion",
    JSON.stringify({ snapshot, message, proofs }),
  );

  return { outcome: "implemented" };
}

export function startVerifyIssueImplementationStation(): RunningStation {
  return defineStation(
    "triage-verify-implementation",
    verifyIssueImplementationHandle(implementationDeps),
  );
}

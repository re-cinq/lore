import { z } from "zod";
import {
  parseDecomposition,
  type DecompTask,
  type DecompositionResult,
} from "@re-cinq/lore-shared/feature-planning/decomposition-result.js";
import { parseModelJson } from "@re-cinq/lore-shared/feature-planning/model-json.js";
import {
  assessImplementation,
  type ImplementationAssessment,
} from "@re-cinq/lore-shared/spec-tickets/implementation-assessment.js";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import {
  behavioralProofSchema,
  ISSUE_SCOPE_PATH,
  ISSUE_SCOPE_LINE,
  issueScope,
  type IssueSnapshot,
} from "./scope.js";
import { behaviorIsVerified } from "./behavior.js";
import type { ImplementationDeps, ImplementationProject } from "./deps.js";

const proofSchema = z.object({
  behavioral_proof: z.array(behavioralProofSchema).default([]),
});

/** What the agent wrote cannot be read as an assessment; only the agent can correct that, unlike a store that is down. */
export class AssessmentRejected extends Error {}

function parseAssessment(content: string) {
  try {
    const raw = parseModelJson(content);

    return {
      decomposition: parseDecomposition(raw),
      proofs: proofSchema.parse(raw).behavioral_proof,
    };
  } catch (error) {
    throw new AssessmentRejected((error as Error).message);
  }
}

export async function assessIssue(
  snapshot: IssueSnapshot,
  content: string,
  deps: ImplementationDeps,
  project: ImplementationProject,
) {
  const { decomposition, proofs } = parseAssessment(content);
  const read = (path: string) => project.repo.read(path, snapshot.commit);
  const checked = await sourceAssessment(snapshot, decomposition, read);
  const report = await deps.report(snapshot.repo, snapshot.commit);
  const behavioral = await behaviorIsVerified(snapshot, proofs, report, read);

  return { ...assessmentDetails(checked), proofs, behavioral };
}

function sourceAssessment(
  snapshot: IssueSnapshot,
  decomposition: DecompositionResult,
  read: (path: string) => Promise<string | null>,
) {
  return assessImplementation(decomposition, {
    spec: issueScope(snapshot),
    specPath: ISSUE_SCOPE_PATH,
    commit: snapshot.commit,
    read,
    parts: [
      { line: ISSUE_SCOPE_LINE, text: `${snapshot.title}\n${snapshot.body}` },
    ],
  });
}

function assessmentDetails(checked: ImplementationAssessment) {
  const { decomposition } = checked;
  const { stories, statements = [] } = decomposition;

  return {
    ...checked,
    task: onlyTask(stories.flatMap((story) => story.tasks)),
    status: statements.length === 1 ? statements[0].status : "missing",
    evidence: statements.flatMap((statement) => statement.evidence),
  };
}

function onlyTask(tasks: DecompTask[]): DecompTask {
  enforceTrue(
    tasks.length === 1 && tasks[0].id === "T001",
    AssessmentRejected,
    "assessment must retain exactly the original issue as T001",
  );

  return tasks[0];
}

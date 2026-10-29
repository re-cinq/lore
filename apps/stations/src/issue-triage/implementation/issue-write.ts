import type { DecompTask } from "@re-cinq/lore-shared/feature-planning/decomposition-result.js";
import { taskIssueBody } from "@re-cinq/lore-shared/feature-planning/issue-bodies.js";
import {
  implementationEvidenceLink,
  type ImplementationEvidence,
} from "@re-cinq/lore-shared/feature-planning/grounding.js";
import type { BehavioralProof, IssueSnapshot } from "./scope.js";

export function behaviorMessage(
  snapshot: IssueSnapshot,
  proofs: BehavioralProof[],
): string {
  return [
    `Behavior verified by CI at ${snapshot.commit}; each cited test passed in the stored report for this repository and commit.`,
    ...proofs.map(
      (proof) =>
        `- ${proof.reason} — ${implementationEvidenceLink(snapshot.repo, snapshot.commit, proof.evidence)} (test: \`${proof.test_id}\`)`,
    ),
  ].join("\n\n");
}

export function remainingIssueBody(
  snapshot: IssueSnapshot,
  task: DecompTask,
  proofs: BehavioralProof[],
): string {
  const original = snapshot.body;

  return [
    reportPrefix(original),
    scopedTaskBody(snapshot, task),
    "## Behavioral evidence",
    behaviorMessage(snapshot, proofs),
    originalReport(original),
    `<!-- lore-triage-assessed: ${snapshot.commit} -->`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function originalReport(body: string): string {
  return `<details>\n<summary>Issue report before this assessment</summary>\n\n${body}\n\n</details>`;
}

function scopedTaskBody(snapshot: IssueSnapshot, task: DecompTask): string {
  return taskIssueBody({
    repo: snapshot.repo,
    task,
    dependsOn: [],
    implementationCommit: snapshot.commit,
  });
}

function reportPrefix(original: string): string {
  const context = original.indexOf("## Context");
  const prefix = context > 0 ? original.slice(0, context) : "";
  const relationships = original
    .split("\n")
    .filter((line) =>
      /\b(part of|depends on|blocked by|blocks?|parent)\b[^\n]*#\d+/i.test(
        line,
      ),
    );

  return [prefix, ...relationships.filter((line) => !prefix.includes(line))]
    .filter(Boolean)
    .join("\n\n");
}

export function completionMessage(
  snapshot: IssueSnapshot,
  evidence: ImplementationEvidence[],
  proofs: BehavioralProof[],
): string {
  return [
    "This issue is fully implemented.",
    ...evidence.map((entry) =>
      implementationEvidenceLink(snapshot.repo, snapshot.commit, entry),
    ),
    behaviorMessage(snapshot, proofs),
  ].join("\n\n");
}

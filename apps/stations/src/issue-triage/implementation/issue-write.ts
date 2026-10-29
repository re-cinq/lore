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
  const markers = original.match(/<!-- lore-plan(?:-task)?: [^>]+-->/g) ?? [];

  return [
    reportPrefix(original),
    scopedTaskBody(snapshot, task),
    "## Behavioral evidence",
    behaviorMessage(snapshot, proofs),
    ...markers,
    `<!-- lore-triage-assessed: ${snapshot.commit} -->`,
  ]
    .filter(Boolean)
    .join("\n\n");
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

  return context > 0 ? original.slice(0, context) : "";
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

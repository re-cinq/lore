import type { DecompTask } from "@re-cinq/lore-shared/feature-planning/decomposition-result.js";
import {
  GITHUB_BODY_LIMIT,
  taskIssueBody,
} from "@re-cinq/lore-shared/feature-planning/issue-bodies.js";
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

const ARCHIVE_OPEN =
  "<details>\n<summary>Issue report before this assessment</summary>\n\n";
const ARCHIVE_CLOSE = "\n\n</details>";
const ASSESSED_MARKER = /<!-- lore-triage-assessed: [0-9a-f]+ -->/g;
const ARCHIVE_CUT_NOTE = "\n\n*Cut short: GitHub holds 65,536 characters.*";

export function remainingIssueBody(
  snapshot: IssueSnapshot,
  task: DecompTask,
  proofs: BehavioralProof[],
): string {
  const original = originalOf(snapshot.body);
  const marker = `<!-- lore-triage-assessed: ${snapshot.commit} -->`;
  const head = [
    reportPrefix(original),
    scopedTaskBody(snapshot, task),
    "## Behavioral evidence",
    behaviorMessage(snapshot, proofs),
  ]
    .filter(Boolean)
    .join("\n\n");
  const room =
    GITHUB_BODY_LIMIT -
    (head.length + marker.length + ARCHIVE_OPEN.length + ARCHIVE_CLOSE.length) -
    ARCHIVE_CUT_NOTE.length -
    8;

  return [head, archive(original, room), marker].join("\n\n");
}

/** The report as it was before the first assessment, plus anything written under the previous archive since: an assessed body is never wrapped again. */
function originalOf(body: string): string {
  const start = body.indexOf(ARCHIVE_OPEN);
  const end = body.lastIndexOf(ARCHIVE_CLOSE);

  if (start === -1 || end < start) {
    return body;
  }
  const archived = body.slice(start + ARCHIVE_OPEN.length, end);
  const written = body
    .slice(end + ARCHIVE_CLOSE.length)
    .replace(ASSESSED_MARKER, "")
    .trim();

  return [archived, written].filter(Boolean).join("\n\n");
}

function archive(original: string, room: number): string {
  const kept =
    original.length > room
      ? original.slice(0, Math.max(room, 0)) + ARCHIVE_CUT_NOTE
      : original;

  return ARCHIVE_OPEN + kept + ARCHIVE_CLOSE;
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

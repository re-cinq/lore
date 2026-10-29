import type { TestReport } from "@re-cinq/lore-shared/models/test-report.js";
import { evidenceIsPresent } from "@re-cinq/lore-shared/feature-planning/grounding.js";
import type { BehavioralProof, IssueSnapshot } from "./scope.js";

export async function behavioralProofPresent(
  proof: BehavioralProof,
  report: TestReport,
  read: (path: string) => Promise<string | null>,
): Promise<boolean> {
  const test = report.tests.find((test) => test.id === proof.test_id);

  if (!test || report.outcomes[test.id] !== true) {
    return false;
  }

  if (test.file !== proof.evidence.path || !test.startLine) {
    return false;
  }
  const source = await read(test.file);

  if (!evidenceIsPresent(proof.evidence, source)) {
    return false;
  }

  return sameTest(report, test.file, test.startLine, proof);
}

function sameTest(
  report: TestReport,
  file: string,
  start: number,
  proof: BehavioralProof,
): boolean {
  const sameFile = report.tests.filter((test) => test.file === file);
  const next = Math.min(
    ...sameFile
      .filter((test) => (test.startLine ?? 0) > start)
      .map((test) => test.startLine!),
  );
  const cases = sameFile.filter((test) => test.startLine === start);

  return (
    proof.evidence.start === start &&
    proof.evidence.end < next &&
    cases.every((test) => report.outcomes[test.id] === true)
  );
}

export async function behaviorIsVerified(
  snapshot: IssueSnapshot,
  proof: BehavioralProof[],
  report: TestReport | null,
  read: (path: string) => Promise<string | null>,
): Promise<boolean> {
  if (
    !report ||
    report.repo !== snapshot.repo ||
    report.commit !== snapshot.commit
  ) {
    return false;
  }
  const results = await Promise.all(
    proof.map((entry) => behavioralProofPresent(entry, report, read)),
  );

  return results.length > 0 && results.every(Boolean);
}

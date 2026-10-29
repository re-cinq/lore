import type {
  ReportedTest,
  TestReport,
} from "@re-cinq/lore-shared/models/test-report.js";
import { evidenceIsPresent } from "@re-cinq/lore-shared/feature-planning/grounding.js";
import { sourceCallAt } from "@re-cinq/lore-shared/spec-trace/reference-extractor.js";
import { extname } from "node:path";
import type { BehavioralProof, IssueSnapshot } from "./scope.js";

export async function behavioralProofPresent(
  proof: BehavioralProof,
  report: TestReport,
  read: (path: string) => Promise<string | null>,
): Promise<boolean> {
  const test = selectedCase(report, proof);

  if (!test) {
    return false;
  }
  const source = await read(test.file);

  return (
    evidenceIsPresent(proof.evidence, source) &&
    sameTest(report, test, proof) &&
    (await withinSourceCall(source!, test, proof))
  );
}

async function withinSourceCall(
  source: string,
  test: ReportedTest,
  proof: BehavioralProof,
): Promise<boolean> {
  const call = await sourceCallAt(
    extname(test.file),
    source,
    test.execution!.location!,
  );

  return Boolean(
    call &&
    proof.evidence.end <= call.end &&
    call.text.includes(proof.evidence.text),
  );
}

function selectedCase(
  report: TestReport,
  proof: BehavioralProof,
): ReportedTest | null {
  const matches = report.tests.filter(
    (test) => test.runnerId === proof.test_id,
  );
  const test = matches[0];

  if (matches.length !== 1 || test.file !== proof.evidence.path) {
    return null;
  }

  return test.execution?.location && casePassed(test, report) ? test : null;
}

function sameTest(
  report: TestReport,
  selected: ReportedTest,
  proof: BehavioralProof,
): boolean {
  const sameFile = report.tests.filter((test) => test.file === selected.file);

  if (!completeFile(sameFile)) {
    return false;
  }
  const location = selected.execution!.location!;
  const cases = sameFile.filter(
    (test) => declarationLine(test) === location.line,
  );

  return (
    sourceDeclarationMatches(sameFile, location, proof) &&
    cases.every((test) => casePassed(test, report))
  );
}

function sourceDeclarationMatches(
  tests: ReportedTest[],
  location: { line: number; column: number },
  proof: BehavioralProof,
): boolean {
  const locations = tests.map((test) => test.execution?.location);
  const next = nextDeclaration(locations, location.line);
  const inside =
    proof.evidence.start === location.line && proof.evidence.end < next;

  return unambiguousLocations(locations, location) && inside;
}

function completeFile(tests: ReportedTest[]): boolean {
  const ids = new Set(tests.map((test) => test.runnerId));

  return (
    ids.size === tests.length &&
    tests.every((test) => test.execution?.fileCaseCount === tests.length)
  );
}

function nextDeclaration(
  points: Array<{ line: number } | undefined>,
  start: number,
): number {
  return Math.min(
    ...points.map((point) =>
      point && point.line > start ? point.line : Infinity,
    ),
  );
}

function declarationLine(test: ReportedTest): number {
  const execution = test.execution;

  return execution?.location?.line ?? 0;
}

function unambiguousLocations(
  points: Array<{ line: number; column: number } | undefined>,
  selected: { line: number; column: number },
): boolean {
  return points.every(
    (point) =>
      point &&
      (point.line !== selected.line || point.column === selected.column),
  );
}

function casePassed(test: ReportedTest, report: TestReport): boolean {
  return Boolean(
    test.runnerId &&
    test.execution?.status === "passed" &&
    test.execution.expectedFailure === false &&
    report.outcomes[test.id] === true,
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

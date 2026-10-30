import { parseTestDescriptors } from "@re-cinq/lore-shared";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import type { Pool } from "pg";
import { saveTestReportRow } from "./test-report-row.js";

interface ReportEnvelope {
  kind: string;
  commit: string;
  report?: unknown;
}

interface EvidenceReport {
  commit?: string;
  branch?: string;
  tests?: unknown;
  results?: Array<{ id: string; passed: boolean }>;
}

type ReportedTests = ReturnType<typeof parseTestDescriptors>;

const parsedByReport = new WeakMap<object, ReportedTests>();

/** A chunk can carry thousands of descriptors; the identity check and the save share one parse of them. */
function reportedTests(report: EvidenceReport): ReportedTests {
  const cached = parsedByReport.get(report);

  if (cached) {
    return cached;
  }
  const parsed = parseTestDescriptors(report.tests ?? []);

  parsedByReport.set(report, parsed);

  return parsed;
}

export function assertReportIdentity(body: ReportEnvelope): void {
  if (body.kind !== "test-report" || !body.report) {
    return;
  }
  const report = body.report as EvidenceReport;
  const tests = reportedTests(report);
  const enriched = tests.some((test) => test.execution);

  enforceTrue(
    !enriched || report.commit === body.commit,
    apiError(400),
    "execution evidence must name the envelope commit",
  );
  assertCompleteFiles(tests);
}

function assertCompleteFiles(tests: ReportedTests): void {
  const counts = new Map<string, number>();

  for (const test of tests) {
    counts.set(test.file, (counts.get(test.file) ?? 0) + 1);
  }
  const complete = tests.every((test) => {
    const count = test.execution?.fileCaseCount;

    return count === undefined || count === counts.get(test.file);
  });

  enforceTrue(
    complete,
    apiError(400),
    "execution snapshots must contain every case of each reported file",
  );
}

export async function saveReportEvidence(
  pool: Pool,
  repo: string,
  body: ReportEnvelope,
): Promise<void> {
  const report = body.report as EvidenceReport | undefined;

  if (body.kind !== "test-report" || !report?.branch) {
    return;
  }
  await saveTestReportRow(pool, {
    repo,
    commit: body.commit,
    branch: report.branch,
    tests: reportedTests(report),
    outcomes: Object.fromEntries(
      (report.results ?? []).map((result) => [result.id, result.passed]),
    ),
  });
}

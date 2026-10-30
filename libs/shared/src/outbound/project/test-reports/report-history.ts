import type { ReportedTest, TestReportRow } from "./test-reports-port.js";

/**
 * The head commit's report completed with the files it did not run. CI runs only the files a push affects, so a file missing from the head row was unaffected and its newest earlier result still stands; `earlier` is newest first.
 */
export function reportWithHistory(
  head: TestReportRow,
  earlier: readonly TestReportRow[],
): TestReportRow {
  const taken = new Set(head.tests.map((test) => test.file));
  const tests: ReportedTest[] = [...head.tests];
  const outcomes = { ...head.outcomes };

  for (const row of earlier) {
    const fresh = row.tests.filter((test) => !taken.has(test.file));

    for (const test of fresh) {
      tests.push(test);
      outcomes[test.id] = row.outcomes[test.id];
    }
    fresh.forEach((test) => taken.add(test.file));
  }

  return { ...head, tests, outcomes };
}

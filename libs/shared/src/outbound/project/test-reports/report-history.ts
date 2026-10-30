import type { ReportedTest, TestReportRow } from "./test-reports-port.js";

interface CarriedTest {
  test: ReportedTest;
  outcome: boolean;
}

/** CI runs only the files a push affects, so a file the head row lacks was unaffected and its newest earlier result still stands; `earlier` is newest first. */
export function reportWithHistory(
  head: TestReportRow,
  earlier: readonly TestReportRow[],
): TestReportRow {
  const taken = new Set(head.tests.map((test) => test.file));
  const carried = earlier.flatMap((row) => carriedFrom(row, taken));

  return {
    ...head,
    tests: [...head.tests, ...carried.map(({ test }) => test)],
    outcomes: {
      ...head.outcomes,
      ...Object.fromEntries(
        carried.map(({ test, outcome }) => [test.id, outcome]),
      ),
    },
  };
}

function carriedFrom(row: TestReportRow, taken: Set<string>): CarriedTest[] {
  const fresh = row.tests.filter((test) => !taken.has(test.file));

  fresh.forEach((test) => taken.add(test.file));

  return fresh.map((test) => ({ test, outcome: row.outcomes[test.id] }));
}

// Mirrors one test run into the repo's Utopia knowledge base, one test file at a time: a file's items are built, pushed four at a time, and the items the last push had and this one has not are tombstoned, before the next file is built; a deleted test file's items are tombstoned from the ledger.

import {
  testReportFiles,
  type TestFileItems,
  type TestReportInput,
} from "../../../domain/utopia/test-coverage/test-report-statements.js";
import { tombstone } from "../../../domain/utopia/statements.js";
import {
  combineOutcomes,
  mirrorKeyedItems,
  pushItems,
  type LedgeredMirrorDeps,
  type MirrorOutcome,
} from "../push-items.js";

export type TestReportMirrorDeps = LedgeredMirrorDeps;

const NOTHING: MirrorOutcome = {
  items: 0,
  created: 0,
  updated: 0,
  unchanged: 0,
  failed: [],
};

export async function mirrorTestReport(
  deps: TestReportMirrorDeps,
  input: TestReportInput,
): Promise<MirrorOutcome> {
  let outcome = NOTHING;
  let dropped = false;

  for (const file of testReportFiles(input)) {
    const pushed = await mirrorTestFile(deps, file);

    outcome = combineOutcomes(outcome, pushed.outcome);
    dropped ||= pushed.dropped;
  }

  if (dropped) {
    await deps.sweepMissing();
  }

  return outcome;
}

/** One file's items and the tombstones of its parts gone since the last push. */
function mirrorTestFile(
  deps: TestReportMirrorDeps,
  file: TestFileItems,
): Promise<{ outcome: MirrorOutcome; dropped: boolean }> {
  return mirrorKeyedItems(deps, file.key, file.items());
}

/** Every id the ledger holds for each deleted file, plus the bare `test:<path>` a file pushed before the per-test shape carried, then the file's row cleared and the source swept once. */
export async function tombstoneTestFiles(
  deps: TestReportMirrorDeps,
  paths: string[],
): Promise<MirrorOutcome> {
  let outcome = NOTHING;

  for (const path of paths) {
    const key = `test:${path}`;
    const ids = await deps.ledger.pushedFor(key);

    outcome = combineOutcomes(
      outcome,
      await pushItems(deps, [...ids, key].map(tombstone)),
    );
    await deps.ledger.record(key, []);
  }

  if (outcome.items > 0) {
    await deps.sweepMissing();
  }

  return outcome;
}

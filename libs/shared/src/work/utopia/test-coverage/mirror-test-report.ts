// Mirrors one test run into the repo's Utopia knowledge base, one test file at a time: a file's items are built, pushed four at a time, and the items the last push had and this one has not are tombstoned, before the next file is built; a deleted test file's items are tombstoned from the ledger.

import {
  testReportFiles,
  type TestFileItems,
  type TestReportInput,
} from "../../../domain/utopia/test-coverage/test-report-statements.js";
import {
  staleItemTombstones,
  tombstone,
} from "../../../domain/utopia/statements.js";
import {
  combineOutcomes,
  pushItems,
  type MirrorDeps,
  type MirrorOutcome,
} from "../push-items.js";
import type { PushedItemLedger } from "../docs/mirror-document.js";

export interface TestReportMirrorDeps extends MirrorDeps {
  /** The item ids last pushed for each test file, keyed by `test:<path>`. */
  ledger: PushedItemLedger;
  /** Utopia only marks a tombstoned item missing; its facts stand until the source is swept. */
  sweepMissing(): Promise<void>;
}

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

/** One file's items and the tombstones of its parts gone since the last push; the ledger moves on only when every item landed. */
async function mirrorTestFile(
  deps: TestReportMirrorDeps,
  file: TestFileItems,
): Promise<{ outcome: MirrorOutcome; dropped: boolean }> {
  const current = file.items();
  const removed = staleItemTombstones(
    await deps.ledger.pushedFor(file.key),
    current,
  );
  const outcome = await pushItems(deps, [...current, ...removed]);

  if (outcome.failed.length === 0) {
    await deps.ledger.record(
      file.key,
      current.map((pushed) => pushed.externalId),
    );
  }

  return { outcome, dropped: removed.length > 0 };
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

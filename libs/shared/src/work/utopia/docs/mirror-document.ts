// Mirrors one spec, ADR or other markdown document into the repo's Utopia knowledge base: the whole file as a text document in the `docs` source, and its statements, with the tests and source files they name, as items in the `test-coverage` source, each pushed four at a time and counted. A statement gone from the document is tombstoned and swept, so its facts leave the graph with it.

import {
  statementItems,
  testPathsToRead,
  type DocStatementsInput,
} from "../../../domain/utopia/docs/doc-statements.js";
import {
  docDocument,
  docTombstone,
} from "../../../domain/utopia/docs/doc-text.js";
import {
  staleItemTombstones,
  tombstone,
} from "../../../domain/utopia/statements.js";
import { mapWithLimit } from "../../../lib/concurrency/map-with-limit.js";
import {
  CONCURRENCY,
  combineOutcomes,
  pushDocuments,
  pushItems,
  type DocumentMirrorDeps,
  type MirrorDeps,
  type MirrorOutcome,
} from "../push-items.js";

/** The statements' pushes, and where a link whose label is no title reads its test file at the commit; without it such a link names no test. */
export interface DocMirrorDeps extends MirrorDeps {
  readTest?(path: string, commit: string): Promise<string | null>;
}

/** The statement item ids last pushed for each document path. */
export interface PushedItemLedger {
  pushedFor(path: string): Promise<string[]>;
  record(path: string, externalIds: string[]): Promise<void>;
}

/** Where a document goes: its text to one source, its statements to another. */
export interface DocTargets {
  text: DocumentMirrorDeps;
  statements: DocMirrorDeps;
  ledger: PushedItemLedger;
  /** Utopia only marks a tombstoned item missing; its facts stand until the sources are swept. */
  sweepMissing(): Promise<void>;
}

export async function mirrorDocument(
  targets: DocTargets,
  input: DocStatementsInput,
): Promise<MirrorOutcome> {
  const text = await pushDocuments(targets.text, [docDocument(input)]);
  const statements = await pushStatements(targets, input);

  return combineOutcomes(text, statements);
}

/** The document's statement items, and a tombstone for every item its last push had and this one has not. */
async function pushStatements(
  targets: DocTargets,
  input: DocStatementsInput,
): Promise<MirrorOutcome> {
  const testSources = await readTestSources(targets.statements, input);
  const current = statementItems({ ...input, testSources });
  const removed = staleItemTombstones(
    await targets.ledger.pushedFor(input.path),
    current,
  );
  const outcome = await pushItems(targets.statements, [...current, ...removed]);

  if (outcome.failed.length === 0) {
    await settleLedger(targets, input.path, {
      current: current.map((pushed) => pushed.externalId),
      sweep: removed.length > 0,
    });
  }

  return outcome;
}

async function readTestSources(
  deps: DocMirrorDeps,
  input: DocStatementsInput,
): Promise<Map<string, string>> {
  const { readTest } = deps;

  if (!readTest) {
    return new Map();
  }
  const paths = testPathsToRead(input);
  const sources = await mapWithLimit(paths, CONCURRENCY, (path) =>
    readTest(path, input.commit),
  );

  return new Map(
    paths.flatMap((path, index) => {
      const source = sources[index];

      return source === null ? [] : [[path, source] as const];
    }),
  );
}

/** A deleted document's text and every statement item last pushed for it are tombstoned and swept. */
export async function unmirrorDocument(
  targets: DocTargets,
  path: string,
): Promise<MirrorOutcome> {
  const removed = (await targets.ledger.pushedFor(path)).map(tombstone);
  const outcome = combineOutcomes(
    await pushDocuments(targets.text, [docTombstone(path)]),
    await pushItems(targets.statements, removed),
  );

  if (outcome.failed.length === 0) {
    await settleLedger(targets, path, { current: [], sweep: true });
  }

  return outcome;
}

/** Run only once every push landed, so a tombstone that failed is sent again with the document's next push. */
async function settleLedger(
  targets: DocTargets,
  path: string,
  { current, sweep }: { current: string[]; sweep: boolean },
): Promise<void> {
  if (sweep) {
    await targets.sweepMissing();
  }
  await targets.ledger.record(path, current);
}

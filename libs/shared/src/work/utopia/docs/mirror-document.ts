// Mirrors one spec, ADR or other markdown document into the repo's Utopia knowledge base: the whole file as a text document in the `docs` source, and its statements, with the tests and source files they name, as items in the `test-coverage` source, each pushed four at a time and counted.

import {
  statementItems,
  untitledTestPaths,
  type DocStatementsInput,
} from "../../../domain/utopia/docs/doc-statements.js";
import {
  docDocument,
  docTombstone,
} from "../../../domain/utopia/docs/doc-text.js";
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

/** Where a document goes: its text to one source, its statements to another. */
export interface DocTargets {
  text: DocumentMirrorDeps;
  statements: DocMirrorDeps;
}

export async function mirrorDocument(
  targets: DocTargets,
  input: DocStatementsInput,
): Promise<MirrorOutcome> {
  const text = await pushDocuments(targets.text, [docDocument(input)]);
  const testSources = await readTestSources(targets.statements, input);
  const statements = await pushItems(
    targets.statements,
    statementItems({ ...input, testSources }),
  );

  return combineOutcomes(text, statements);
}

async function readTestSources(
  deps: DocMirrorDeps,
  input: DocStatementsInput,
): Promise<Map<string, string>> {
  const { readTest } = deps;

  if (!readTest) {
    return new Map();
  }
  const paths = untitledTestPaths(input);
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

/** A deleted document's text is tombstoned; its statement items stay until the walk of the file that holds them replaces them. */
export function tombstoneDocument(
  text: DocumentMirrorDeps,
  path: string,
): Promise<MirrorOutcome> {
  return pushDocuments(text, [docTombstone(path)]);
}

// Mirrors one spec or ADR into the repo's Utopia knowledge base: builds its statement items and pushes them, four at a time, counting what Utopia said of each.

import {
  docStatementItems,
  untitledTestPaths,
  type DocStatementsInput,
} from "../../domain/utopia/doc-statements.js";
import { mapWithLimit } from "../../lib/concurrency/map-with-limit.js";
import { tombstone } from "../../domain/utopia/statements.js";
import {
  CONCURRENCY,
  pushItems,
  type MirrorDeps,
  type MirrorOutcome,
} from "./push-items.js";

/** A document's pushes, and where a link whose label is no title reads its test file at the commit; without it such a link names no test. */
export interface DocMirrorDeps extends MirrorDeps {
  readTest?(path: string, commit: string): Promise<string | null>;
}

export interface TombstoneInput {
  repo: string;
  path: string;
  /** The statement ordinals the document was last pushed with; unknown ordinals leave their items standing. */
  ordinals?: number[];
}

export async function mirrorDocument(
  deps: DocMirrorDeps,
  input: DocStatementsInput,
): Promise<MirrorOutcome> {
  const testSources = await readTestSources(deps, input);

  return pushItems(deps, docStatementItems({ ...input, testSources }));
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

export function tombstoneDocument(
  deps: MirrorDeps,
  input: TombstoneInput,
): Promise<MirrorOutcome> {
  const statementIds = (input.ordinals ?? []).map(
    (ordinal) => `stmt:${input.path}#${String(ordinal).padStart(4, "0")}`,
  );

  return pushItems(
    deps,
    [`doc:${input.path}`, ...statementIds].map((externalId) =>
      tombstone(externalId),
    ),
  );
}

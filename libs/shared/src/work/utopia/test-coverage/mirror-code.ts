// Mirrors a code delta into the repo's Utopia knowledge base, one file at a time: each file parsed as the code ingest parses it, its items pushed four at a time as a document's are, and the parts the last push had and this one has not tombstoned; a deleted file's ledgered parts and its `code:<path>` are tombstoned. The source is swept once when anything was tombstoned.

import { extname } from "node:path";
import {
  codeFileItems,
  codeFileTombstones,
} from "../../../domain/utopia/test-coverage/code-statements.js";
import {
  tombstone,
  type StatementItem,
} from "../../../domain/utopia/statements.js";
import { MAX_CODE_FILE_CHARS } from "../../spec-trace/project-code-file.js";
import { extractCodeSymbols } from "../../spec-trace/reference-extractor.js";
import {
  combineOutcomes,
  mirrorKeyedItems,
  pushItems,
  type LedgeredMirrorDeps,
  type MirrorOutcome,
} from "../push-items.js";

export interface CodeDeltaInput {
  repo: string;
  files: Array<{ path: string; content: string }>;
}

const NOTHING: MirrorOutcome = {
  items: 0,
  created: 0,
  updated: 0,
  unchanged: 0,
  failed: [],
};

/** A file past MAX_CODE_FILE_CHARS is skipped, as the graph projection skips it. Parsing runs one file at a time: each tree lives in the parser's wasm heap. */
export async function mirrorCodeFiles(
  deps: LedgeredMirrorDeps,
  input: CodeDeltaInput,
): Promise<MirrorOutcome> {
  const parseable = input.files.filter(
    (file) => file.content.length <= MAX_CODE_FILE_CHARS,
  );

  return mirrorEach(deps, parseable, async (file) =>
    mirrorKeyedItems(deps, codeKey(file.path), await fileItems(input, file)),
  );
}

/** One mirror per file in turn, their outcomes as one; the source is swept once when any part was dropped. */
async function mirrorEach<File>(
  deps: LedgeredMirrorDeps,
  files: File[],
  mirror: (file: File) => Promise<{ outcome: MirrorOutcome; dropped: boolean }>,
): Promise<MirrorOutcome> {
  let outcome = NOTHING;
  let dropped = false;

  for (const file of files) {
    const pushed = await mirror(file);

    outcome = combineOutcomes(outcome, pushed.outcome);
    dropped ||= pushed.dropped;
  }

  if (dropped) {
    await deps.sweepMissing();
  }

  return outcome;
}

async function fileItems(
  input: CodeDeltaInput,
  file: CodeDeltaInput["files"][number],
): Promise<StatementItem[]> {
  const parsed = await extractCodeSymbols(extname(file.path), file.content);

  return codeFileItems({
    repo: input.repo,
    path: file.path,
    ...parsed,
  });
}

function codeKey(path: string): string {
  return `code:${path}`;
}

/** Every part the ledger holds for a deleted file and its bare `code:<path>` are tombstoned, the ledger emptied for the files whose tombstones landed, and the source swept once. */
export function tombstoneCodeFiles(
  deps: LedgeredMirrorDeps,
  paths: string[],
): Promise<MirrorOutcome> {
  return mirrorEach(deps, paths, (path) => tombstoneCodeFile(deps, path));
}

async function tombstoneCodeFile(
  deps: LedgeredMirrorDeps,
  path: string,
): Promise<{ outcome: MirrorOutcome; dropped: boolean }> {
  const ledgered = await deps.ledger.pushedFor(codeKey(path));
  const parts = ledgered.filter((id) => id !== codeKey(path)).map(tombstone);
  const outcome = await pushItems(deps, [
    ...codeFileTombstones([path]),
    ...parts,
  ]);

  if (outcome.failed.length === 0) {
    await deps.ledger.record(codeKey(path), []);
  }

  return { outcome, dropped: true };
}

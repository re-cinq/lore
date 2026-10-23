// Mirrors a code delta into the repo's Utopia knowledge base: each file parsed as the code ingest parses it, its items pushed four at a time as a document's are, and a tombstone per deleted file.

import { extname } from "node:path";
import {
  codeFileItems,
  codeFileTombstones,
} from "../../../domain/utopia/test-coverage/code-statements.js";
import type { StatementItem } from "../../../domain/utopia/statements.js";
import { MAX_CODE_FILE_CHARS } from "../../spec-trace/project-code-file.js";
import { extractCodeSymbols } from "../../spec-trace/reference-extractor.js";
import {
  pushItems,
  type MirrorDeps,
  type MirrorOutcome,
} from "../push-items.js";

export interface CodeDeltaInput {
  repo: string;
  files: Array<{ path: string; content: string }>;
}

/** A file past MAX_CODE_FILE_CHARS is skipped, as the graph projection skips it. Parsing runs one file at a time: each tree lives in the parser's wasm heap. */
export async function mirrorCodeFiles(
  deps: MirrorDeps,
  input: CodeDeltaInput,
): Promise<MirrorOutcome> {
  const parseable = input.files.filter(
    (file) => file.content.length <= MAX_CODE_FILE_CHARS,
  );
  const codeItems: StatementItem[] = [];

  for (const file of parseable) {
    codeItems.push(...(await fileItems(input, file)));
  }

  return pushItems(deps, codeItems);
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

export function tombstoneCodeFiles(
  deps: MirrorDeps,
  paths: string[],
): Promise<MirrorOutcome> {
  return pushItems(deps, codeFileTombstones(paths));
}

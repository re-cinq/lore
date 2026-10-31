// One spec, ADR or other markdown document as the whole text an `api` Utopia source takes: the file as it stands, led by where it lives in the repository. Nothing in the text names the commit, so a push of an unchanged file at a later commit is `unchanged` and Utopia extracts it once.

import type { IngestDocument } from "../memory/memory-documents.js";
import type { DocStatementsInput } from "./doc-statements.js";
import { docMarks, markLines } from "./doc-status.js";

export function docDocument(
  input: Pick<
    DocStatementsInput,
    "repo" | "path" | "content" | "kind" | "commitTime"
  >,
): IngestDocument {
  const location = [
    `File: ${input.path}`,
    `Repository: ${input.repo}`,
    `Kind: ${input.kind}`,
    ...markLines(docMarks(input.content)),
  ].join("\n");

  return {
    external_id: `doc:${input.path}`,
    filename: input.path,
    content: `${location}\n\n${input.content}`,
    ...(input.commitTime ? { doc_time: input.commitTime } : {}),
  };
}

export function docTombstone(path: string): IngestDocument {
  return { external_id: `doc:${path}`, filename: path, deleted: true };
}

const LOCATION_HEADER =
  /^File: [^\n]*\nRepository: [^\n]*\nKind: [^\n]*\n(?:\n|(?=(?:Status|Amended): ))/;

/** A chunk of a pushed document without the lines that say where the file lives, which only the first chunk carries; its Status and Amended lines stay. */
export function withoutLocation(chunk: string): string {
  return chunk.replace(LOCATION_HEADER, "");
}

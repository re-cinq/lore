// One spec, ADR or other markdown document as the whole text an `api` Utopia source takes: the file as it stands, led by where it lives in the repository. Nothing in the text names the commit, so a push of an unchanged file at a later commit is `unchanged` and Utopia extracts it once.

import type { IngestDocument } from "../memory/memory-documents.js";
import type { DocStatementsInput } from "./doc-statements.js";

export function docDocument(
  input: Pick<
    DocStatementsInput,
    "repo" | "path" | "content" | "kind" | "commitTime"
  >,
): IngestDocument {
  const location = `File: ${input.path}\nRepository: ${input.repo}\nKind: ${input.kind}`;

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

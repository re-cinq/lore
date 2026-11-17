// The definitions the code graph holds for a set of files, by path: what a test report's covered lines are named by in Utopia (utopia-graph-mirror FR9.4).

import { mapWithLimit } from "../../lib/concurrency/map-with-limit.js";
import type { CodeSpan } from "../../domain/utopia/test-coverage/test-report-statements.js";
import type { DgraphClientPort } from "../../outbound/spec-trace/deps.js";
import { withTxn } from "../../outbound/spec-trace/dgraph-upsert.js";
import { codeChunkXid, modulePathOf } from "./project-code-file.js";

interface DefinitionChunk {
  "CodeChunk.xid": string;
  "CodeChunk.symbol_name"?: string;
  "CodeChunk.start_line"?: number;
  "CodeChunk.end_line"?: number;
}

const FILE_READS = 8;

const FILE_DEFINITIONS = `query q($repo: string, $fp: string) {
  chunks(func: eq(CodeChunk.file_path, $fp)) @filter(eq(CodeChunk.repo, $repo)) {
    CodeChunk.xid
    CodeChunk.symbol_name
    CodeChunk.start_line
    CodeChunk.end_line
  }
}`;

/** Each file's definitions sorted by first line; a file the graph holds none for is left out. */
export async function codeDefinitionsOf(
  dgraph: DgraphClientPort,
  repo: string,
  filePaths: readonly string[],
): Promise<Map<string, CodeSpan[]>> {
  const perFile = await mapWithLimit(
    [...filePaths],
    FILE_READS,
    async (path) => [path, await fileDefinitions(dgraph, repo, path)] as const,
  );

  return new Map(perFile.filter(([, spans]) => spans.length > 0));
}

/** The definition-keyed chunks of one file; the line-keyed chunks a spec link mints for it are left out. */
async function fileDefinitions(
  dgraph: DgraphClientPort,
  repo: string,
  filePath: string,
): Promise<CodeSpan[]> {
  const prefix = codeChunkXid(repo, modulePathOf(filePath), "");
  const chunks = await withTxn(dgraph, async (txn) => {
    const res = await txn.queryWithVars(FILE_DEFINITIONS, {
      $repo: repo,
      $fp: filePath,
    });

    return (res.data.chunks ?? []) as unknown as DefinitionChunk[];
  });

  return chunks
    .filter((chunk) => chunk["CodeChunk.xid"].startsWith(prefix))
    .flatMap(spanOf)
    .sort((a, b) => a.start - b.start || b.end - a.end);
}

function spanOf(chunk: DefinitionChunk): CodeSpan[] {
  const symbol = chunk["CodeChunk.symbol_name"];

  return symbol
    ? [
        {
          symbol,
          start: chunk["CodeChunk.start_line"] ?? 0,
          end: chunk["CodeChunk.end_line"] ?? 0,
        },
      ]
    : [];
}

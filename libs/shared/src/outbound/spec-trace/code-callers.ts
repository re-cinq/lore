/** The call graph read (issue #1992): the definitions that call a named symbol, read over the reverse `CodeChunk.references` edge the code projection writes, or the ones it calls, over the edge itself. */

import type { DgraphClientPort } from "./deps.js";
import { withTxn } from "./dgraph-upsert.js";

/** One definition on the far side of the asked-about symbol's call edges. */
export interface CodeCaller {
  filePath: string;
  symbol: string;
  startLine: number;
}

interface GraphCaller {
  "CodeChunk.file_path"?: string;
  "CodeChunk.symbol_name"?: string;
  "CodeChunk.start_line"?: number;
}

export type CallDirection = "callers" | "callees";

const EDGE: Record<CallDirection, string> = {
  callers: "~CodeChunk.references",
  callees: "CodeChunk.references",
};

/** A placeholder (a callee whose file is not projected yet) has no file path, so it is no answer. */
const callGraphQuery = (
  direction: CallDirection,
) => `query q($repo: string, $symbol: string) {
  target(func: eq(CodeChunk.symbol_name, $symbol)) @filter(eq(CodeChunk.repo, $repo) AND has(CodeChunk.file_path)) {
    CodeChunk.symbol_name
    callers: ${EDGE[direction]} @filter(eq(CodeChunk.repo, $repo) AND has(CodeChunk.file_path)) {
      CodeChunk.file_path
      CodeChunk.symbol_name
      CodeChunk.start_line
    }
  }
}`;

interface GraphTarget {
  "CodeChunk.symbol_name"?: string;
  callers?: GraphCaller[];
}

export async function callersOf(
  dgraph: DgraphClientPort,
  repo: string,
  symbol: string,
  direction: CallDirection = "callers",
): Promise<CodeCaller[]> {
  const targets = await withTxn(dgraph, async (txn) => {
    const res = await txn.queryWithVars(callGraphQuery(direction), {
      $repo: repo,
      $symbol: symbol,
    });

    return (res.data.target ?? []) as GraphTarget[];
  });
  // symbol_name carries a term index, which matches words rather than whole names.
  const exact = targets.filter((t) => t["CodeChunk.symbol_name"] === symbol);

  return exact.flatMap((target) => (target.callers ?? []).map(toCodeCaller));
}

function toCodeCaller(caller: GraphCaller): CodeCaller {
  return {
    filePath: caller["CodeChunk.file_path"] ?? "",
    symbol: caller["CodeChunk.symbol_name"] ?? "",
    startLine: caller["CodeChunk.start_line"] ?? 0,
  };
}

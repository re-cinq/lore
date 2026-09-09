/** The call-graph hop: from the chunks a diff touched, out over the reverse `CodeChunk.references` edge to the chunks that call them, and on to the statements those callers implement. Split from `impact-code-graph.ts` because the file-overlap reads and the reference walk answer different questions. */

import type { DgraphClientPort } from "../../outbound/spec-trace/deps.js";
import { withTxn } from "../../outbound/spec-trace/dgraph-upsert.js";
import {
  toImpactStatement,
  STATEMENT_PROJECTION,
  type GraphStatement,
  type ImpactStatement,
} from "./impact-statement.js";

const CALLERS_QUERY = `query q($repo: string, $xid: string) {
  callee(func: eq(CodeChunk.xid, $xid)) {
    callers: ~CodeChunk.references @filter(eq(CodeChunk.repo, $repo)) {
      CodeChunk.file_path
      stmts: ~Statement.implemented_by {
        ${STATEMENT_PROJECTION}
      }
    }
  }
}`;

interface GraphCaller {
  "CodeChunk.file_path"?: string;
  stmts?: GraphStatement[];
}

/** For each callee chunk xid, finds all caller chunks (via reverse CodeChunk.references) and returns their statements marked indirect. */
export async function callerHopImpact(
  dgraph: DgraphClientPort,
  repo: string,
  calleeXids: string[],
  calleeFile: string,
): Promise<Array<ImpactStatement & { xid: string }>> {
  const perCallee = await Promise.all(
    calleeXids.map((xid) => callersOf(dgraph, repo, xid)),
  );

  return perCallee
    .flat()
    .flatMap((callee) => callee.callers ?? [])
    .flatMap((caller) => caller.stmts ?? [])
    .map((stmt) => ({
      ...toImpactStatement(stmt, calleeFile, [], "file-link"),
      indirect: true,
    }));
}

/** The chunks that reference one callee, read through the reverse edge. */
async function callersOf(
  dgraph: DgraphClientPort,
  repo: string,
  xid: string,
): Promise<{ callers?: GraphCaller[] }[]> {
  return withTxn(dgraph, async (txn) => {
    const res = await txn.queryWithVars(CALLERS_QUERY, {
      $repo: repo,
      $xid: xid,
    });

    return (res.data.callee ?? []) as { callers?: GraphCaller[] }[];
  });
}

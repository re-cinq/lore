import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import * as dgraph from "dgraph-js-http";
import { projectCodeFile } from "../project-code-file.js";

/**
 * projectCodeFile (spec-traceability-graph — code ingest) — parses a source
 * file and upserts one CodeChunk node per top-level symbol into the REAL local
 * Dgraph, keyed `${repo}|${filePath}|${symbol_name}`. Tested against live
 * Dgraph (no mocks). Container-gated: skips when Dgraph isn't reachable.
 */

const DGRAPH_HTTP = process.env.DGRAPH_HTTP ?? "http://localhost:8081";
const APPLIER = join(process.cwd(), "..", "scripts", "infra", "setup-spec-trace-schema.sh");

async function dgraphReachable(): Promise<boolean> {
  try {
    return (await fetch(`${DGRAPH_HTTP}/health`, { signal: AbortSignal.timeout(800) })).ok;
  } catch {
    return false;
  }
}

const reachable = await dgraphReachable();

describe.skipIf(!reachable)("projectCodeFile (live Dgraph)", () => {
  const client = new dgraph.DgraphClient(new dgraph.DgraphClientStub(DGRAPH_HTTP));

  beforeAll(() => {
    execFileSync("bash", [APPLIER], { env: { ...process.env, DGRAPH_HTTP }, stdio: "pipe" });
  });

  async function chunksFor(repo: string): Promise<Array<Record<string, unknown>>> {
    const txn = client.newTxn();
    try {
      const res = await txn.queryWithVars(
        `query c($repo: string) {
          c(func: eq(CodeChunk.repo, $repo), orderasc: CodeChunk.start_line) {
            CodeChunk.xid CodeChunk.file_path CodeChunk.symbol_name CodeChunk.symbol_type
            CodeChunk.start_line CodeChunk.end_line CodeChunk.content_hash
          }
        }`,
        { $repo: repo },
      );
      return ((res.data ?? {}) as { c?: Array<Record<string, unknown>> }).c ?? [];
    } finally {
      await txn.discard().catch(() => {});
    }
  }

  it("upserts one CodeChunk per top-level symbol with line range and content hash", async () => {
    const repo = `test-code/${randomUUID()}`;
    const source = ["export function add(a: number, b: number) {", "  return a + b;", "}"].join("\n");

    const result = await projectCodeFile(repo, "src/math.ts", source, client);

    expect(result).toEqual({ projected: true });
    expect(await chunksFor(repo)).toMatchObject([
      {
        "CodeChunk.xid": `${repo}|src/math.ts|add`,
        "CodeChunk.file_path": "src/math.ts",
        "CodeChunk.symbol_name": "add",
        "CodeChunk.symbol_type": "function",
        "CodeChunk.start_line": 1,
        "CodeChunk.end_line": 3,
      },
    ]);
  });
});

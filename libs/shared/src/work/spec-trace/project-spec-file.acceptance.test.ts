import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { findRepoRoot } from "../../lib/repo-root.js";
import { randomUUID } from "node:crypto";
import * as dgraph from "dgraph-js-http";
import { projectSpecFile } from "./project-spec-file.js";
import { dgraphReachable } from "../../lib/dgraph-test-gate.js";

const DGRAPH_HTTP = process.env.DGRAPH_HTTP ?? "http://localhost:8081";
const APPLIER = join(
  findRepoRoot(),
  "scripts",
  "infra",
  "setup-spec-trace-schema.sh",
);

const reachable = await dgraphReachable();

describe.skipIf(!reachable)("projectSpecFile acceptance (live Dgraph)", () => {
  const dgraphClient = new dgraph.DgraphClient(
    new dgraph.DgraphClientStub(DGRAPH_HTTP),
  );

  beforeAll(() => {
    execFileSync("bash", [APPLIER], {
      env: { ...process.env, DGRAPH_HTTP },
      stdio: "pipe",
    });
  });

  async function readGraph(
    query: string,
    vars: Record<string, string>,
  ): Promise<Record<string, unknown>> {
    const txn = dgraphClient.newTxn();

    try {
      const res = await txn.queryWithVars(query, vars);

      return (res.data ?? {}) as Record<string, unknown>;
    } finally {
      await txn.discard().catch(() => {});
    }
  }

  it("produces deterministic nodes and a TestChunk with the actual referenced test's name", async () => {
    const repo = `test-proj/${randomUUID()}`;
    const filePath = "specs/example/spec.md";
    const testPath = "src/x.test.ts";
    const content =
      "## Overview\n\n- Returns the value ([validated by](src/x.test.ts#L42))\n";

    const testContent = Array.from({ length: 50 }, (_, i) =>
      i === 40 ? 'test("my correct test name", () => { // L41' : `// L${i + 1}`,
    ).join("\n");

    const readLinked = async (path: string) => {
      if (path === testPath) {
        return testContent;
      }

      return null;
    };

    const expectedXid = `${repo}|${testPath}`;

    await projectSpecFile({ repo, filePath, content }, dgraphClient, {
      embed: async (texts) => texts.map(() => null),
      readLinked,
    });

    const graph = (await readGraph(
      `query q($sx: string) {
        stmt(func: eq(Statement.xid, $sx)) {
          Statement.xid
          Statement.validated_by {
            TestChunk.xid TestChunk.repo TestChunk.file_path
            TestChunk.test_name TestChunk.link_label TestChunk.start_line
          }
        }
      }`,
      { $sx: `${repo}|${filePath}|0` },
    )) as { stmt?: { "Statement.validated_by"?: Record<string, unknown>[] }[] };
    const testChunks = graph.stmt?.[0]?.["Statement.validated_by"] ?? [];

    expect(testChunks).toHaveLength(1);
    expect(testChunks[0]).toMatchObject({
      "TestChunk.xid": expectedXid,
      "TestChunk.repo": repo,
      "TestChunk.file_path": testPath,
      "TestChunk.test_name": "my correct test name",
      "TestChunk.link_label": "validated by",
      "TestChunk.start_line": 42,
    });
  });
});

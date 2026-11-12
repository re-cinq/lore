import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { findRepoRoot } from "../../lib/repo-root.js";
import { randomUUID } from "node:crypto";
import * as dgraph from "dgraph-js-http";
import { projectSpecFile } from "./project-spec-file.js";
import { makeDeleteRepoNodes } from "../../outbound/spec-trace/test-helpers/delete-repo-nodes.js";
import { dgraphReachable } from "../../lib/dgraph-test-gate.js";

const DGRAPH_HTTP = process.env.DGRAPH_HTTP ?? "http://localhost:8081";

const reachable = await dgraphReachable();

describe.skipIf(!reachable)("projectSpecFile acceptance", () => {
  const dgraphClient = new dgraph.DgraphClient(
    new dgraph.DgraphClientStub(DGRAPH_HTTP),
  );

  let createdRepo: string | undefined;

  beforeAll(() => {
    const applier = join(
      findRepoRoot(),
      "scripts",
      "infra",
      "setup-spec-trace-schema.sh",
    );

    execFileSync("bash", [applier], {
      env: { ...process.env, DGRAPH_HTTP },
    });
  });

  afterEach(async () => {
    if (createdRepo) {
      const deleteRepoNodes = makeDeleteRepoNodes(dgraphClient);

      await deleteRepoNodes(createdRepo);
      createdRepo = undefined;
    }
  });

  async function readGraph(query: string, vars: Record<string, string>) {
    const txn = dgraphClient.newTxn();

    try {
      const res = await txn.queryWithVars(query, vars);

      return res.data;
    } finally {
      await txn.discard().catch(() => {});
    }
  }

  it("yields the actual test name via fallback when the label is generic", async () => {
    const repo = `test-proj/${randomUUID()}`;

    createdRepo = repo;

    const filePath = "specs/example/spec.md";
    const testPath = "src/x.test.ts";
    const testContent = `
import { it } from 'vitest';
it('actually tests the thing', () => {
  // test body
});
`;

    const content = `## Overview\n\n- Statement ([validated by](${testPath}#L3))\n`;

    await projectSpecFile({ repo, filePath, content }, dgraphClient, {
      readLinked: async (path) => (path === testPath ? testContent : null),
    });

    const graph = (await readGraph(
      `query q($sx: string) {
        stmt(func: eq(Statement.xid, $sx)) {
          Statement.validated_by {
            TestChunk.test_name
            TestChunk.link_label
          }
        }
      }`,
      { $sx: `${repo}|${filePath}|0` },
    )) as { stmt?: { "Statement.validated_by"?: Record<string, unknown>[] }[] };

    const testChunks = graph.stmt?.[0]?.["Statement.validated_by"] ?? [];

    expect(testChunks).toHaveLength(1);
    expect(testChunks[0]).toMatchObject({
      "TestChunk.test_name": "actually tests the thing",
      "TestChunk.link_label": "validated by",
    });
  });
});

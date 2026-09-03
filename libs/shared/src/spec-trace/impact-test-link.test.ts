import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { findRepoRoot } from "../lib/repo-root.js";
import { randomUUID } from "node:crypto";
import * as dgraph from "dgraph-js-http";
import { testFileImpact } from "./impact-test-link.js";

const DGRAPH_HTTP = process.env.DGRAPH_HTTP ?? "http://localhost:8081";
const APPLIER = join(
  findRepoRoot(),
  "scripts",
  "infra",
  "setup-spec-trace-schema.sh",
);

async function dgraphReachable(): Promise<boolean> {
  try {
    return (
      await fetch(`${DGRAPH_HTTP}/health`, { signal: AbortSignal.timeout(800) })
    ).ok;
  } catch {
    return false;
  }
}

const reachable = await dgraphReachable();

describe.skipIf(!reachable)("testFileImpact (live Dgraph)", () => {
  const dgraphClient = new dgraph.DgraphClient(
    new dgraph.DgraphClientStub(DGRAPH_HTTP),
  );
  let repo = "";
  const specPath = "specs/login/spec.md";

  beforeAll(() => {
    execFileSync("bash", [APPLIER], {
      env: { ...process.env, DGRAPH_HTTP },
      stdio: "pipe",
    });
  });

  async function seedStatementValidatedBy(
    testFile: string,
    startLine: number,
    endLine: number,
  ): Promise<void> {
    const txn = dgraphClient.newTxn();

    try {
      await txn.mutate({
        setJson: {
          uid: "_:spec",
          "dgraph.type": "Spec",
          "Spec.xid": `${repo}|${specPath}`,
          "Spec.repo": repo,
          "Spec.file_path": specPath,
          "Spec.title": "Login Spec",
          "Spec.sections": [
            {
              uid: "_:stmt",
              "dgraph.type": "Statement",
              "Statement.xid": `${repo}|${specPath}|2`,
              "Statement.repo": repo,
              "Statement.text": "Users MUST re-auth after password change.",
              "Statement.spec": { uid: "_:spec" },
              "Statement.validated_by": {
                uid: "_:tc",
                "dgraph.type": "TestChunk",
                "TestChunk.xid": `${repo}|${testFile}`,
                "TestChunk.repo": repo,
                "TestChunk.file_path": testFile,
                "TestChunk.test_name": "re-auth flow",
                "TestChunk.start_line": startLine,
                "TestChunk.end_line": endLine,
              },
            },
          ],
        },
        commitNow: true,
      });
    } finally {
      await txn.discard().catch(() => {});
    }
  }

  afterEach(async () => {
    const txn = dgraphClient.newTxn();

    try {
      const res = await txn.queryWithVars(
        `query nodes($repo: string) {
          specs(func: eq(Spec.repo, $repo)) { uid }
          stmts(func: eq(Statement.repo, $repo)) { uid }
          chunks(func: eq(TestChunk.repo, $repo)) { uid }
        }`,
        { $repo: repo },
      );
      const written = res.data as Record<string, { uid: string }[]>;
      const uids = Object.values(written)
        .flat()
        .map((n) => n.uid);

      if (uids.length) {
        await txn.mutate({
          deleteNquads: uids.map((uid) => `<${uid}> * * .`).join("\n"),
          commitNow: true,
        });
      }
    } catch {
      void 0;
    } finally {
      await txn.discard().catch(() => {});
    }
  });

  it("surfaces the statement a changed test file validates", async () => {
    repo = `test-link/${randomUUID()}`;
    await seedStatementValidatedBy("test/login.test.ts", 40, 60);

    expect(
      await testFileImpact(dgraphClient, repo, "test/login.test.ts", {
        ranges: [[45, 50]],
      }),
    ).toMatchObject([
      {
        specPath,
        specTitle: "Login Spec",
        statementText: "Users MUST re-auth after password change.",
        changedFile: "test/login.test.ts",
        evidence: "test-link",
        tests: [{ file: "test/login.test.ts", name: "re-auth flow", line: 40 }],
      },
    ]);
  });

  it("returns nothing when the changed range misses the test's own line span", async () => {
    repo = `test-link/${randomUUID()}`;
    await seedStatementValidatedBy("test/login.test.ts", 40, 60);

    expect(
      await testFileImpact(dgraphClient, repo, "test/login.test.ts", {
        ranges: [[100, 110]],
      }),
    ).toEqual([]);
  });

  it("matches file-wide when the test chunk carries no end_line to bound it", async () => {
    repo = `test-link/${randomUUID()}`;
    await seedStatementValidatedBy("test/login.test.ts", 40, 0);

    expect(
      await testFileImpact(dgraphClient, repo, "test/login.test.ts", {
        ranges: [[100, 110]],
      }),
    ).toMatchObject([{ evidence: "test-link" }]);
  });

  it("returns nothing for a test file the graph has never seen", async () => {
    repo = `test-link/${randomUUID()}`;
    await seedStatementValidatedBy("test/login.test.ts", 40, 60);

    expect(
      await testFileImpact(dgraphClient, repo, "test/other.test.ts", {
        ranges: [[1, 5]],
      }),
    ).toEqual([]);
  });
});

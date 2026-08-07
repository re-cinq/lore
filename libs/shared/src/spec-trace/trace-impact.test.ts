import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { findRepoRoot } from "../lib/repo-root.js";
import { randomUUID } from "node:crypto";
import * as dgraph from "dgraph-js-http";
import {
  parseRanges,
  computeImpact,
  buildImpactAnnotations,
  buildImpactComment,
  IMPACT_COMMENT_MARKER,
} from "./trace-impact.js";

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

/**
 * trace-impact — the deterministic, zero-LLM impact query that walks the
 * spec-traceability graph from a PR's changed file+line ranges to the coupled
 * spec Statements.
 *
 * KERNEL facet: `parseRanges` is the pure inverse of ingest-coverage's
 * `serializeRanges` — it reads the `Coverage.covers|ranges` facet string
 * ("5-10,20-25") back into `[start, end]` intervals so they can be overlapped
 * against a diff. No Dgraph; pure and unit-testable.
 */
describe("parseRanges", () => {
  it("parses comma-separated start-end intervals into number pairs", () => {
    expect(parseRanges("5-10,20-25")).toEqual([
      [5, 10],
      [20, 25],
    ]);
  });

  it("returns empty array for an empty facet (round-trips serializeRanges([]))", () => {
    expect(parseRanges("")).toEqual([]);
  });

  it("drops malformed parts that are not two finite numbers", () => {
    expect(parseRanges("5-10,garbage,30-")).toEqual([[5, 10]]);
  });
});

describe("computeImpact (live Dgraph)", () => {
  it("returns status unavailable when no dgraph client is given", async () => {
    expect(await computeImpact(null, "any/repo", [])).toMatchObject({
      status: "unavailable",
      statements: [],
      orphaned: [],
    });
  });
});

describe("buildImpactAnnotations", () => {
  it("emits a warning annotation on the changed range for a coupled statement", () => {
    const annotations = buildImpactAnnotations(
      {
        status: "ok",
        testSelectors: [],
        orphaned: [],
        statements: [
          {
            specPath: "specs/widget/spec.md",
            specTitle: "Widget Spec",
            statementText: "The widget MUST render on mount.",
            statementAnchor: "specs/widget/spec.md",
            tests: [{ file: "test/widget.test.ts", name: "renders", line: 12 }],
            changedFile: "src/widget.ts",
            evidence: "coverage",
          },
        ],
      },
      [{ path: "src/widget.ts", ranges: [[5, 8]] }],
    );

    expect(annotations).toMatchObject([
      {
        path: "src/widget.ts",
        start_line: 5,
        end_line: 8,
        annotation_level: "warning",
      },
    ]);
    expect(annotations[0].message).toContain("Widget Spec");
    expect(annotations[0].message).toContain(
      "The widget MUST render on mount.",
    );
    expect(annotations[0].message).toContain("test/widget.test.ts");
  });

  it("emits a notice annotation on the deleted range for an orphaned statement", () => {
    const annotations = buildImpactAnnotations(
      {
        status: "ok",
        testSelectors: [],
        statements: [],
        orphaned: [
          {
            specPath: "specs/legacy/spec.md",
            specTitle: "Legacy Spec",
            statementText: "Coverage reports MUST attribute ranges per test.",
            statementAnchor: "specs/legacy/spec.md",
            wasCoveredBy: "src/legacy.ts:10-20",
          },
        ],
      },
      [{ path: "src/legacy.ts", ranges: [], deleted: [[10, 20]] }],
    );

    expect(annotations).toMatchObject([
      {
        path: "src/legacy.ts",
        start_line: 10,
        end_line: 20,
        annotation_level: "notice",
      },
    ]);
    expect(annotations[0].message).toContain("only coverage");
  });
});

describe("buildImpactComment", () => {
  const marker = IMPACT_COMMENT_MARKER;

  it("renders the neutral skip comment when the graph is unavailable", () => {
    const comment = buildImpactComment({
      status: "unavailable",
      statements: [],
      orphaned: [],
      testSelectors: [],
    });

    expect(comment).toContain("Graph not available");
    expect(comment).toContain(marker);
  });

  it("renders coupled statements and orphan warnings with the sticky marker", () => {
    const comment = buildImpactComment({
      status: "ok",
      testSelectors: ["test/widget.test.ts"],
      statements: [
        {
          specPath: "specs/widget/spec.md",
          specTitle: "Widget Spec",
          statementText: "The widget MUST render on mount.",
          statementAnchor: "specs/widget/spec.md",
          tests: [{ file: "test/widget.test.ts", name: "renders", line: 12 }],
          changedFile: "src/widget.ts",
          evidence: "coverage",
        },
      ],
      orphaned: [
        {
          specPath: "specs/legacy/spec.md",
          specTitle: "Legacy Spec",
          statementText: "Coverage reports MUST attribute ranges per test.",
          statementAnchor: "specs/legacy/spec.md",
          wasCoveredBy: "src/legacy.ts:10-20",
        },
      ],
    });

    expect(comment).toContain("Widget Spec");
    expect(comment).toContain("The widget MUST render on mount.");
    expect(comment).toContain("Legacy Spec");
    expect(comment).toContain("lost its only coverage");
    expect(comment).toContain(marker);
  });

  it("states no impact when ok with no statements or orphans", () => {
    const comment = buildImpactComment({
      status: "ok",
      statements: [],
      orphaned: [],
      testSelectors: [],
    });

    expect(comment).toContain("No spec impact");
    expect(comment).toContain(marker);
  });
});

describe.skipIf(!reachable)("computeImpact coupling (live Dgraph)", () => {
  const dgraphClient = new dgraph.DgraphClient(
    new dgraph.DgraphClientStub(DGRAPH_HTTP),
  );

  beforeAll(() => {
    execFileSync("bash", [APPLIER], {
      env: { ...process.env, DGRAPH_HTTP },
      stdio: "pipe",
    });
  });

  async function deleteRepoNodes(repo: string): Promise<void> {
    const txn = dgraphClient.newTxn();

    try {
      const res = await txn.queryWithVars(
        `query nodes($repo: string) {
          specs(func: eq(Spec.repo, $repo)) { uid }
          stmts(func: eq(Statement.repo, $repo)) { uid }
          codechunks(func: eq(CodeChunk.repo, $repo)) { uid }
        }`,
        { $repo: repo },
      );
      const data = res.data as Record<string, { uid: string }[]>;
      const uids = Object.values(data)
        .flat()
        .map((n) => n.uid);

      if (uids.length) {
        await txn.mutate({
          deleteNquads: uids.map((uid) => `<${uid}> * * .`).join("\n"),
          commitNow: true,
        });
      }
    } catch {
      /* best-effort cleanup */
    } finally {
      await txn.discard().catch(() => {});
    }
  }

  let createdRepo = "";

  afterEach(async () => {
    if (createdRepo) {
      await deleteRepoNodes(createdRepo);
    }
  });

  it("surfaces a statement whose implemented_by CodeChunk overlaps a changed range", async () => {
    const repo = `test-impact/${randomUUID()}`;

    createdRepo = repo;
    const specPath = "specs/widget/spec.md";

    const txn = dgraphClient.newTxn();

    try {
      await txn.mutate({
        setJson: {
          uid: "_:spec",
          "dgraph.type": "Spec",
          "Spec.xid": `${repo}|${specPath}`,
          "Spec.repo": repo,
          "Spec.file_path": specPath,
          "Spec.title": "Widget Spec",
          "Spec.sections": [
            {
              uid: "_:stmt",
              "dgraph.type": "Statement",
              "Statement.xid": `${repo}|${specPath}|3`,
              "Statement.repo": repo,
              "Statement.text": "The widget MUST render on mount.",
              "Statement.spec": { uid: "_:spec" },
              "Statement.implemented_by": {
                uid: "_:cc",
                "dgraph.type": "CodeChunk",
                "CodeChunk.xid": `${repo}|src/widget.ts|1`,
                "CodeChunk.repo": repo,
                "CodeChunk.file_path": "src/widget.ts",
                "CodeChunk.start_line": 1,
                "CodeChunk.end_line": 10,
              },
            },
          ],
        },
        commitNow: true,
      });
    } finally {
      await txn.discard().catch(() => {});
    }

    const report = await computeImpact(dgraphClient, repo, [
      { path: "src/widget.ts", ranges: [[5, 8]] },
    ]);

    expect(report.status).toBe("ok");
    expect(report.statements).toMatchObject([
      {
        specPath,
        specTitle: "Widget Spec",
        statementText: "The widget MUST render on mount.",
        changedFile: "src/widget.ts",
      },
    ]);

    const noOverlap = await computeImpact(dgraphClient, repo, [
      { path: "src/widget.ts", ranges: [[50, 60]] },
    ]);

    expect(noOverlap.statements).toEqual([]);
  });

  it("surfaces a validated_by statement via a Coverage facet range overlapping the diff, with the test selector", async () => {
    const repo = `test-impact/${randomUUID()}`;

    createdRepo = repo;
    const specPath = "specs/login/spec.md";

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
                "TestChunk.xid": `${repo}|test/login.test.ts`,
                "TestChunk.repo": repo,
                "TestChunk.file_path": "test/login.test.ts",
                "TestChunk.test_name": "re-auth flow",
                "TestChunk.start_line": 42,
                "TestChunk.coverage": {
                  uid: "_:cov",
                  "dgraph.type": "Coverage",
                  "Coverage.xid": `${repo}|test/login.test.ts|re-auth flow`,
                  "Coverage.repo": repo,
                  "Coverage.covers": [
                    {
                      uid: "_:file",
                      "dgraph.type": "File",
                      "File.xid": `${repo}|src/auth.ts`,
                      "File.repo": repo,
                      "File.path": "src/auth.ts",
                      "Coverage.covers|ranges": "20-40",
                    },
                  ],
                },
              },
            },
          ],
        },
        commitNow: true,
      });
    } finally {
      await txn.discard().catch(() => {});
    }

    const report = await computeImpact(dgraphClient, repo, [
      { path: "src/auth.ts", ranges: [[30, 35]] },
    ]);

    expect(report.statements).toMatchObject([
      {
        specPath,
        specTitle: "Login Spec",
        statementText: "Users MUST re-auth after password change.",
        changedFile: "src/auth.ts",
        tests: [{ file: "test/login.test.ts", name: "re-auth flow", line: 42 }],
      },
    ]);
    expect(report.testSelectors).toEqual(["test/login.test.ts"]);
  });

  it("flags a statement as orphaned when the diff deletes its only covering range", async () => {
    const repo = `test-impact/${randomUUID()}`;

    createdRepo = repo;
    const specPath = "specs/legacy/spec.md";

    const txn = dgraphClient.newTxn();

    try {
      await txn.mutate({
        setJson: {
          uid: "_:spec",
          "dgraph.type": "Spec",
          "Spec.xid": `${repo}|${specPath}`,
          "Spec.repo": repo,
          "Spec.file_path": specPath,
          "Spec.title": "Legacy Spec",
          "Spec.sections": [
            {
              uid: "_:stmt",
              "dgraph.type": "Statement",
              "Statement.xid": `${repo}|${specPath}|7`,
              "Statement.repo": repo,
              "Statement.text":
                "Coverage reports MUST attribute ranges per test.",
              "Statement.spec": { uid: "_:spec" },
              "Statement.validated_by": {
                uid: "_:tc",
                "dgraph.type": "TestChunk",
                "TestChunk.xid": `${repo}|test/legacy.test.ts`,
                "TestChunk.repo": repo,
                "TestChunk.file_path": "test/legacy.test.ts",
                "TestChunk.test_name": "attributes ranges",
                "TestChunk.coverage": {
                  uid: "_:cov",
                  "dgraph.type": "Coverage",
                  "Coverage.xid": `${repo}|test/legacy.test.ts|attributes ranges`,
                  "Coverage.repo": repo,
                  "Coverage.covers": [
                    {
                      uid: "_:file",
                      "dgraph.type": "File",
                      "File.xid": `${repo}|src/legacy.ts`,
                      "File.repo": repo,
                      "File.path": "src/legacy.ts",
                      "Coverage.covers|ranges": "10-20",
                    },
                  ],
                },
              },
            },
          ],
        },
        commitNow: true,
      });
    } finally {
      await txn.discard().catch(() => {});
    }

    const report = await computeImpact(dgraphClient, repo, [
      { path: "src/legacy.ts", ranges: [], deleted: [[10, 20]] },
    ]);

    expect(report.statements).toEqual([]);
    expect(report.orphaned).toMatchObject([
      {
        specPath,
        specTitle: "Legacy Spec",
        statementText: "Coverage reports MUST attribute ranges per test.",
        wasCoveredBy: "src/legacy.ts:10-20",
      },
    ]);
  });
});

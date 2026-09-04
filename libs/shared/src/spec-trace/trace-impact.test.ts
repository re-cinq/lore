import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { findRepoRoot } from "../lib/repo-root.js";
import { stampGraphBaseline } from "./graph-baseline.js";
import { randomUUID, createHash } from "node:crypto";
import * as dgraph from "dgraph-js-http";
import {
  parseRanges,
  computeImpact,
  buildImpactAnnotations,
  buildImpactComment,
  IMPACT_COMMENT_MARKER,
  type ImpactReport,
  type ImpactStatement,
} from "./trace-impact.js";
import { makeDeleteRepoNodes } from "./test-helpers/delete-repo-nodes.js";

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

  const deleteRepoNodes = makeDeleteRepoNodes(dgraphClient, [
    { alias: "specs", type: "Spec" },
    { alias: "stmts", type: "Statement" },
    { alias: "codechunks", type: "CodeChunk" },
  ]);

  let createdRepo = "";

  afterEach(async () => {
    if (createdRepo) {
      await deleteRepoNodes(createdRepo);
    }
  });

  it("surfaces a statement whose implemented_by CodeChunk overlaps a changed range", async () => {
    const repo = `test-impact/${randomUUID()}`;

    createdRepo = repo;
    await stampGraphBaseline(dgraphClient, repo, "base1", new Date());
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

    const report = await computeImpact(
      dgraphClient,
      repo,
      [{ path: "src/widget.ts", ranges: [[5, 8]], aligned: true }],
      { protocol: 2 },
    );

    expect(report.status).toBe("ok");
    expect(report.statements).toMatchObject([
      {
        specPath,
        specTitle: "Widget Spec",
        statementText: "The widget MUST render on mount.",
        changedFile: "src/widget.ts",
      },
    ]);

    const noOverlap = await computeImpact(
      dgraphClient,
      repo,
      [{ path: "src/widget.ts", ranges: [[50, 60]], aligned: true }],
      { protocol: 2 },
    );

    expect(noOverlap.statements).toEqual([]);
  });

  it("surfaces a validated_by statement via a Coverage facet range overlapping the diff, with the test selector", async () => {
    const repo = `test-impact/${randomUUID()}`;

    createdRepo = repo;
    await stampGraphBaseline(dgraphClient, repo, "base1", new Date());
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

    const report = await computeImpact(
      dgraphClient,
      repo,
      [{ path: "src/auth.ts", ranges: [[30, 35]], aligned: true }],
      { protocol: 2 },
    );

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
    await stampGraphBaseline(dgraphClient, repo, "base1", new Date());
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

    const report = await computeImpact(
      dgraphClient,
      repo,
      [
        {
          path: "src/legacy.ts",
          ranges: [],
          deleted: [[10, 20]],
          aligned: true,
        },
      ],
      { protocol: 2 },
    );

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

describe.skipIf(!reachable)("spec-only PR (live Dgraph)", () => {
  const dgraphClient = new dgraph.DgraphClient(
    new dgraph.DgraphClientStub(DGRAPH_HTTP),
  );
  let createdRepo = "";

  beforeAll(() => {
    execFileSync("bash", [APPLIER], {
      env: { ...process.env, DGRAPH_HTTP },
      stdio: "pipe",
    });
  });

  afterEach(async () => {
    const txn = dgraphClient.newTxn();

    try {
      const res = await txn.queryWithVars(
        `query nodes($repo: string) {
          specs(func: eq(Spec.repo, $repo)) { uid }
          stmts(func: eq(Statement.repo, $repo)) { uid }
          chunks(func: eq(TestChunk.repo, $repo)) { uid }
        }`,
        { $repo: createdRepo },
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
      return;
    } finally {
      await txn.discard().catch(() => {});
    }
  });

  it("couples a spec-only diff with no changed code to the statement whose text it edited, per #1076", async () => {
    const repo = `spec-only/${randomUUID()}`;

    createdRepo = repo;
    await stampGraphBaseline(dgraphClient, repo, "base1", new Date());
    const specPath = "specs/widget/spec.md";
    const oldText = "The widget MUST render within 100ms.";
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
              "Statement.xid": `${repo}|${specPath}|1`,
              "Statement.repo": repo,
              "Statement.text": oldText,
              "Statement.text_hash": createHash("sha256")
                .update(oldText)
                .digest("hex"),
              "Statement.spec": { uid: "_:spec" },
              "Statement.validated_by": {
                uid: "_:tc",
                "dgraph.type": "TestChunk",
                "TestChunk.xid": `${repo}|test/widget.test.ts`,
                "TestChunk.repo": repo,
                "TestChunk.file_path": "test/widget.test.ts",
                "TestChunk.test_name": "renders fast",
                "TestChunk.start_line": 12,
              },
            },
          ],
        },
        commitNow: true,
      });
    } finally {
      await txn.discard().catch(() => {});
    }

    const report = await computeImpact(
      dgraphClient,
      repo,
      [{ path: specPath, ranges: [[5, 5]], aligned: true }],
      {
        protocol: 2,
        docs: [
          {
            path: specPath,
            content:
              "# Widget Spec\n\n## FR\n\nThe widget MUST render within 50ms.\n",
          },
        ],
      },
    );

    expect(report.statements).toMatchObject([
      {
        specPath,
        statementText: oldText,
        evidence: "statement-edit",
        changeKind: "changed",
        tests: [{ file: "test/widget.test.ts", name: "renders fast" }],
      },
    ]);
    expect(report.examined).toMatchObject({ docs: 1, newStatements: 1 });
  });
});

describe("buildImpactComment presentation (regression #1077 — dup rows, empty spec/statement columns)", () => {
  const coupled = (over: Partial<ImpactStatement>): ImpactStatement => ({
    specPath: "specs/widget/spec.md",
    specTitle: "Widget Spec",
    statementText: "The widget MUST render on mount.",
    statementAnchor: "specs/widget/spec.md",
    tests: [{ file: "test/widget.test.ts", name: "renders", line: 12 }],
    changedFile: "src/widget.ts",
    evidence: "coverage",
    ...over,
  });

  const render = (over: Partial<ImpactReport>) =>
    buildImpactComment({
      status: "ok",
      statements: [],
      orphaned: [],
      testSelectors: [],
      ...over,
    });

  it("drops a finding whose spec and statement did not resolve", () => {
    const comment = render({
      statements: [
        coupled({}),
        coupled({ specPath: "", specTitle: "", statementText: "" }),
      ],
    });

    expect(comment).toContain("**1 statement(s)**");
  });

  it("dedups repeated statement, test and changed-file triples", () => {
    const comment = render({ statements: [coupled({}), coupled({})] });

    expect(
      comment.split("The widget MUST render on mount.").length - 1,
    ).toEqual(1);
  });

  it("folds spec-linked findings away from coverage-backed ones", () => {
    const comment = render({
      statements: [
        coupled({}),
        coupled({
          statementText: "The widget MUST unmount cleanly.",
          evidence: "file-link",
        }),
      ],
    });

    expect(comment).toContain("<details>");
    expect(comment).toContain("Weaker signals (1)");
  });

  it("names what it examined instead of claiming a clean bill of health", () => {
    const comment = render({
      examined: {
        files: 23,
        withGraphData: 3,
        docs: 2,
        newStatements: 4,
        changedWithoutTests: 114,
      },
    });

    expect(comment).toContain("Examined **23 changed file(s)**");
    expect(comment).toContain("3 had graph data");
    expect(comment).toContain("18 had none");
    expect(comment).toContain("**4 new statement(s)**");
    expect(comment).toContain("**114 changed statement(s)** had no validating");
  });

  it("says the baseline is unknown rather than printing graph @ unknown", () => {
    const comment = render({ statements: [coupled({})] });

    expect(comment).toContain("graph baseline unknown");
    expect(comment).not.toContain("graph @ `unknown`");
  });

  it("names the baseline commit and projection date when the repo is stamped", () => {
    const comment = render({
      statements: [coupled({})],
      graphCommit: "8f2a1c3d9e0b",
      graphCommitAt: "2026-08-07T10:30:00.000Z",
    });

    expect(comment).toContain("graph @ `8f2a1c3`");
    expect(comment).toContain("projected 2026-08-07");
  });
});

describe("protocol gating", () => {
  it("suppresses findings from a client that did not declare protocol 2", async () => {
    const report = await computeImpact({} as never, "any/repo", [
      { path: "src/a.ts", ranges: [[1, 5]] },
    ]);

    expect(report).toMatchObject({
      status: "ok",
      protocol: 1,
      statements: [],
      skipped: [{ path: "*", reason: "legacy-client" }],
    });
  });

  it("tells a legacy client why its findings were withheld", () => {
    const comment = buildImpactComment({
      status: "ok",
      protocol: 1,
      statements: [],
      orphaned: [],
      testSelectors: [],
    });

    expect(comment).toContain("is version 1");
    expect(comment).toContain("merge base");
    expect(comment).toContain("suppressed");
  });

  it("does not count a spec it read at statement level among the files it cannot speak for", () => {
    const comment = buildImpactComment({
      status: "ok",
      protocol: 2,
      statements: [],
      orphaned: [],
      testSelectors: [],
      examined: {
        files: 3,
        withGraphData: 1,
        docs: 2,
        newStatements: 0,
        changedWithoutTests: 0,
      },
    });

    expect(comment).toContain("0 had none");
  });

  it("does not claim nothing moved while also reporting statements that moved", () => {
    const comment = buildImpactComment({
      status: "ok",
      protocol: 2,
      statements: [],
      orphaned: [],
      testSelectors: [],
      examined: {
        files: 1,
        withGraphData: 0,
        docs: 1,
        newStatements: 39,
        changedWithoutTests: 114,
      },
    });

    expect(comment).not.toContain("no projected statement changed");
    expect(comment).toContain("**114 changed statement(s)**");
  });

  it("says line-precise coupling was skipped when the repo has no baseline", () => {
    const comment = buildImpactComment({
      status: "ok",
      protocol: 2,
      statements: [],
      orphaned: [],
      testSelectors: [],
      coordinates: "unverified",
      skipped: [{ path: "src/a.ts", reason: "no-baseline" }],
      examined: {
        files: 1,
        withGraphData: 0,
        docs: 0,
        newStatements: 0,
        changedWithoutTests: 0,
      },
    });

    expect(comment).toContain("line-precise coupling skipped");
  });
});

describe.skipIf(!reachable)(
  "implemented_by without end_line couples file-wide, since CodeChunk.end_line has no producer (live Dgraph)",
  () => {
    const dgraphClient = new dgraph.DgraphClient(
      new dgraph.DgraphClientStub(DGRAPH_HTTP),
    );
    let repo = "";

    beforeAll(() => {
      execFileSync("bash", [APPLIER], {
        env: { ...process.env, DGRAPH_HTTP },
        stdio: "pipe",
      });
    });

    afterEach(async () => {
      const txn = dgraphClient.newTxn();

      try {
        const res = await txn.queryWithVars(
          `query nodes($repo: string) {
          specs(func: eq(Spec.repo, $repo)) { uid }
          stmts(func: eq(Statement.repo, $repo)) { uid }
          chunks(func: eq(CodeChunk.repo, $repo)) { uid }
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
        return;
      } finally {
        await txn.discard().catch(() => {});
      }
    });

    async function seedAnchorOnlyChunk(): Promise<void> {
      const txn = dgraphClient.newTxn();

      try {
        await txn.mutate({
          setJson: {
            uid: "_:spec",
            "dgraph.type": "Spec",
            "Spec.xid": `${repo}|specs/widget/spec.md`,
            "Spec.repo": repo,
            "Spec.file_path": "specs/widget/spec.md",
            "Spec.title": "Widget Spec",
            "Spec.sections": [
              {
                uid: "_:stmt",
                "dgraph.type": "Statement",
                "Statement.xid": `${repo}|specs/widget/spec.md|3`,
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

    it("couples file-wide when the chunk carries no end_line to bound it", async () => {
      repo = `impl-anchor/${randomUUID()}`;
      await stampGraphBaseline(dgraphClient, repo, "base1", new Date());
      await seedAnchorOnlyChunk();

      const report = await computeImpact(
        dgraphClient,
        repo,
        [{ path: "src/widget.ts", ranges: [[900, 910]], aligned: true }],
        { protocol: 2 },
      );

      expect(report.statements).toMatchObject([
        {
          specPath: "specs/widget/spec.md",
          statementText: "The widget MUST render on mount.",
          evidence: "file-link",
        },
      ]);
    });

    it("returns nothing for a file the graph holds no chunk for", async () => {
      repo = `impl-anchor/${randomUUID()}`;
      await stampGraphBaseline(dgraphClient, repo, "base1", new Date());
      await seedAnchorOnlyChunk();

      const report = await computeImpact(
        dgraphClient,
        repo,
        [{ path: "src/other.ts", ranges: [[1, 5]], aligned: true }],
        { protocol: 2 },
      );

      expect(report.statements).toEqual([]);
    });
  },
);

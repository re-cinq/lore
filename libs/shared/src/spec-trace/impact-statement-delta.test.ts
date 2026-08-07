import { describe, it, expect, beforeAll, afterEach } from "vitest";
import {
  diffStatements,
  specFileImpact,
  type GraphStatementRef,
} from "./impact-statement-delta.js";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { findRepoRoot } from "../lib/repo-root.js";
import * as dgraph from "dgraph-js-http";

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

const hash = (text: string) => createHash("sha256").update(text).digest("hex");

function graphRef(text: string, tests: string[] = []): GraphStatementRef {
  return {
    xid: `acme/repo|specs/x/spec.md|${text.slice(0, 8)}`,
    textHash: hash(text),
    text,
    specTitle: "X Spec",
    tests: tests.map((file) => ({ file, name: "t", line: 1 })),
  };
}

const SPEC = `# X Spec

## Functional Requirements

The widget MUST render on mount.

The widget MUST unmount cleanly.
`;

/**
 * impact-statement-delta — the doc-side coupling direction, by content identity.
 *
 * Statements carry no line position in the graph, so a changed spec is diffed by
 * `text_hash` rather than by line arithmetic. That makes this lookup immune to
 * line drift and usable with no graph baseline at all — which matters, because a
 * spec-only PR is exactly the case the line-based lookups reported as "no spec
 * impact" (#1076).
 */
describe("diffStatements", () => {
  it("reports nothing changed when the file still contains every known statement", () => {
    const graph = [
      graphRef("The widget MUST render on mount."),
      graphRef("The widget MUST unmount cleanly."),
    ];

    expect(diffStatements(SPEC, graph)).toEqual({ changed: [], added: 0 });
  });

  it("reports a statement whose text the file no longer contains", () => {
    const graph = [
      graphRef("The widget MUST render on mount."),
      graphRef("The widget MUST render within 100ms.", ["test/widget.test.ts"]),
    ];

    expect(diffStatements(SPEC, graph)).toMatchObject({
      changed: [
        {
          text: "The widget MUST render within 100ms.",
          tests: [{ file: "test/widget.test.ts" }],
        },
      ],
    });
  });

  it("counts a statement present in the file but absent from the graph as added", () => {
    const graph = [graphRef("The widget MUST render on mount.")];

    expect(diffStatements(SPEC, graph)).toMatchObject({
      added: 1,
      changed: [],
    });
  });

  it("ignores acceptance-criteria segments, which are not Statement nodes", () => {
    const withAc = `${SPEC}
## Acceptance Criteria

The widget renders in under a second.
`;

    const graph = [
      graphRef("The widget MUST render on mount."),
      graphRef("The widget MUST unmount cleanly."),
    ];

    expect(diffStatements(withAc, graph)).toEqual({ changed: [], added: 0 });
  });

  it("treats an empty graph as every statement added rather than as drift", () => {
    expect(diffStatements(SPEC, [])).toMatchObject({ added: 2, changed: [] });
  });
});

describe.skipIf(!reachable)("specFileImpact (live Dgraph)", () => {
  const dgraphClient = new dgraph.DgraphClient(
    new dgraph.DgraphClientStub(DGRAPH_HTTP),
  );
  let repo = "";
  const specPath = "specs/widget/spec.md";

  beforeAll(() => {
    execFileSync("bash", [APPLIER], {
      env: { ...process.env, DGRAPH_HTTP },
      stdio: "pipe",
    });
  });

  async function seedSpec(statementText: string): Promise<void> {
    const txn = dgraphClient.newTxn();

    try {
      await txn.mutate({
        setJson: {
          uid: "_:spec",
          "dgraph.type": "Spec",
          "Spec.xid": `${repo}|${specPath}`,
          "Spec.repo": repo,
          "Spec.file_path": specPath,
          "Spec.title": "X Spec",
          "Spec.sections": [
            {
              uid: "_:stmt",
              "dgraph.type": "Statement",
              "Statement.xid": `${repo}|${specPath}|1`,
              "Statement.repo": repo,
              "Statement.text": statementText,
              "Statement.text_hash": hash(statementText),
              "Statement.spec": { uid: "_:spec" },
              "Statement.validated_by": {
                uid: "_:tc",
                "dgraph.type": "TestChunk",
                "TestChunk.xid": `${repo}|test/widget.test.ts`,
                "TestChunk.repo": repo,
                "TestChunk.file_path": "test/widget.test.ts",
                "TestChunk.test_name": "renders",
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
  });

  it("reports the edited statement with the test that still claims to validate it", async () => {
    repo = `stmt-delta/${randomUUID()}`;
    await seedSpec("The widget MUST render within 100ms.");

    expect(
      await specFileImpact(dgraphClient, repo, specPath, SPEC),
    ).toMatchObject({
      statements: [
        {
          specPath,
          specTitle: "X Spec",
          statementText: "The widget MUST render within 100ms.",
          evidence: "statement-edit",
          changeKind: "changed",
          tests: [{ file: "test/widget.test.ts", name: "renders", line: 12 }],
        },
      ],
    });
  });

  it("reports no changed statement when the spec still contains the projected text", async () => {
    repo = `stmt-delta/${randomUUID()}`;
    await seedSpec("The widget MUST render on mount.");

    expect(
      await specFileImpact(dgraphClient, repo, specPath, SPEC),
    ).toMatchObject({ statements: [], added: 1 });
  });
});

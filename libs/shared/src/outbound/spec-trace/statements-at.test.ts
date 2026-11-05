import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import * as dgraph from "dgraph-js-http";
import { findRepoRoot } from "../../lib/repo-root.js";
import { dgraphReachable } from "../../lib/dgraph-test-gate.js";
import { upsertByXid, replaceEdgeWithFacets } from "./dgraph-upsert.js";
import { statementsAt } from "./statements-at.js";
import { mainScope, scopedXid } from "../../domain/spec-trace/trace-scope.js";

const DGRAPH_HTTP = process.env.DGRAPH_HTTP ?? "http://localhost:8081";
const APPLIER = join(
  findRepoRoot(),
  "scripts",
  "infra",
  "setup-spec-trace-schema.sh",
);

const reachable = await dgraphReachable();

describe.skipIf(!reachable)("statementsAt (live Dgraph)", () => {
  const client = new dgraph.DgraphClient(
    new dgraph.DgraphClientStub(DGRAPH_HTTP),
  );

  beforeAll(() => {
    execFileSync("bash", [APPLIER], {
      env: { ...process.env, DGRAPH_HTTP },
      stdio: "pipe",
    });
  });

  const freshRepo = () => `spec-trace/${randomUUID()}`;

  async function seedStatement(
    repo: string,
    text: string,
    edge: Record<string, unknown>,
  ): Promise<void> {
    await upsertByXid(client, "Statement", scopedXid(mainScope(repo), text), {
      "Statement.text": text,
      ...edge,
    });
  }

  async function seedTest(
    repo: string,
    lines: { file: string; start: number; end: number },
    coverageUid?: string,
  ): Promise<string> {
    return upsertByXid(
      client,
      "TestChunk",
      scopedXid(mainScope(repo), `${lines.file}:${lines.start}`),
      {
        "TestChunk.repo": repo,
        "TestChunk.file_path": lines.file,
        "TestChunk.test_name": `test at ${lines.start}`,
        "TestChunk.start_line": lines.start,
        "TestChunk.end_line": lines.end,
        ...(coverageUid ? { "TestChunk.coverage": { uid: coverageUid } } : {}),
      },
    );
  }

  async function seedCoverage(
    repo: string,
    covered: { file: string; ranges: string },
  ): Promise<string> {
    const scope = mainScope(repo);
    const fileUid = await upsertByXid(
      client,
      "File",
      scopedXid(scope, covered.file),
      { "File.repo": repo, "File.path": covered.file },
    );
    const coverageUid = await upsertByXid(
      client,
      "Coverage",
      scopedXid(scope, covered.file, covered.ranges),
      { "Coverage.repo": repo, "Coverage.tool": "seed" },
    );

    await replaceEdgeWithFacets(client, coverageUid, "Coverage.covers", [
      { uid: fileUid, facets: { ranges: covered.ranges } },
    ]);

    return coverageUid;
  }

  it("returns the statement a test declared in the selected lines validates", async () => {
    const repo = freshRepo();
    const testUid = await seedTest(repo, {
      file: "src/widget.test.ts",
      start: 10,
      end: 20,
    });

    await seedStatement(repo, "The widget spins.", {
      "Statement.validated_by": { uid: testUid },
    });

    expect(
      await statementsAt(client, repo, {
        file: "src/widget.test.ts",
        startLine: 12,
        endLine: 14,
      }),
    ).toEqual([{ text: "The widget spins.", via: "validated" }]);
  });

  it("returns the statement a code chunk in the selected lines implements", async () => {
    const repo = freshRepo();
    const codeUid = await upsertByXid(
      client,
      "CodeChunk",
      scopedXid(mainScope(repo), "src/widget.ts:5"),
      {
        "CodeChunk.repo": repo,
        "CodeChunk.file_path": "src/widget.ts",
        "CodeChunk.start_line": 5,
        "CodeChunk.end_line": 9,
      },
    );

    await seedStatement(repo, "The widget stops.", {
      "Statement.implemented_by": { uid: codeUid },
    });

    expect(
      await statementsAt(client, repo, {
        file: "src/widget.ts",
        startLine: 1,
        endLine: 5,
      }),
    ).toEqual([{ text: "The widget stops.", via: "implemented" }]);
  });

  it("returns the statement of a test whose coverage overlaps the selected lines", async () => {
    const repo = freshRepo();
    const coverageUid = await seedCoverage(repo, {
      file: "src/widget.ts",
      ranges: "30-40",
    });
    const testUid = await seedTest(
      repo,
      { file: "src/widget.test.ts", start: 1, end: 3 },
      coverageUid,
    );

    await seedStatement(repo, "The widget glows.", {
      "Statement.validated_by": { uid: testUid },
    });

    expect(
      await statementsAt(client, repo, {
        file: "src/widget.ts",
        startLine: 35,
        endLine: 50,
      }),
    ).toEqual([{ text: "The widget glows.", via: "covered" }]);
  });

  it("returns nothing for lines no statement reaches", async () => {
    const repo = freshRepo();
    const testUid = await seedTest(repo, {
      file: "src/widget.test.ts",
      start: 10,
      end: 20,
    });

    await seedStatement(repo, "The widget spins.", {
      "Statement.validated_by": { uid: testUid },
    });

    expect(
      await statementsAt(client, repo, {
        file: "src/widget.test.ts",
        startLine: 40,
        endLine: 50,
      }),
    ).toEqual([]);
  });
});

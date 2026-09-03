import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { findRepoRoot } from "../lib/repo-root.js";
import { randomUUID } from "node:crypto";
import * as dgraph from "dgraph-js-http";
import { projectSpecFile } from "./project-spec-file.js";
import { ingestCoverageReport } from "./ingest-coverage.js";

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

interface NodeRecord {
  key: string;
  fields: Record<string, unknown>;
}

function normalizeEdgeValue(value: unknown): unknown {
  if (!Array.isArray(value)) {
    return value;
  }

  return value
    .map(
      (target) => Object.values(target as Record<string, unknown>)[0] as string,
    )
    .sort();
}

function nodeRecordOf(
  group: string,
  node: Record<string, unknown>,
): NodeRecord {
  const xidKey = Object.keys(node).find((k) => k.endsWith(".xid"))!;
  const fields: Record<string, unknown> = {};

  for (const [pred, value] of Object.entries(node)) {
    fields[pred] = normalizeEdgeValue(value);
  }

  return { key: `${group}|${node[xidKey] as string}`, fields };
}

describe.skipIf(!reachable)("Spec Traceability Graph", () => {
  const dgraphClient = new dgraph.DgraphClient(
    new dgraph.DgraphClientStub(DGRAPH_HTTP),
  );

  beforeAll(() => {
    execFileSync("bash", [APPLIER], {
      env: { ...process.env, DGRAPH_HTTP },
      stdio: "pipe",
    });
  });

  async function snapshot(repo: string): Promise<NodeRecord[]> {
    const txn = dgraphClient.newTxn();

    try {
      const res = await txn.queryWithVars(
        `query g($repo: string){
          spec(func: eq(Spec.repo, $repo)){ Spec.xid Spec.content_hash
            Spec.sections { Section.xid } Spec.blocks { Block.xid } Spec.acceptance_criteria { AcceptanceCriterion.xid } }
          section(func: eq(Section.repo, $repo)){ Section.xid Section.ordinal Section.heading Section.level }
          statement(func: eq(Statement.repo, $repo)){ Statement.xid Statement.ordinal Statement.text Statement.text_hash
            Statement.kind Statement.testability Statement.category
            Statement.validated_by { TestChunk.xid } Statement.implemented_by { CodeChunk.xid } Statement.section { Section.xid } }
          ac(func: eq(AcceptanceCriterion.repo, $repo)){ AcceptanceCriterion.xid AcceptanceCriterion.ordinal
            AcceptanceCriterion.text AcceptanceCriterion.text_hash
            AcceptanceCriterion.validated_by { TestChunk.xid } AcceptanceCriterion.implemented_by { CodeChunk.xid } }
          block(func: eq(Block.repo, $repo)){ Block.xid Block.ordinal Block.kind Block.text Block.level }
          codechunk(func: eq(CodeChunk.repo, $repo)){ CodeChunk.xid CodeChunk.file_path CodeChunk.start_line CodeChunk.end_line CodeChunk.content_hash CodeChunk.symbol_name }
          testchunk(func: eq(TestChunk.repo, $repo)){ TestChunk.xid TestChunk.test_name TestChunk.file_path TestChunk.start_line TestChunk.link_label TestChunk.coverage { Coverage.xid } }
          coverage(func: eq(Coverage.repo, $repo)){ Coverage.xid Coverage.tool Coverage.commit Coverage.covers { CodeChunk.xid } }
        }`,
        { $repo: repo },
      );
      const data = res.data as Record<string, Array<Record<string, unknown>>>;

      const records: NodeRecord[] = Object.entries(data).flatMap(
        ([group, nodes]) =>
          (nodes ?? []).map((node) => nodeRecordOf(group, node)),
      );

      return records.sort((a, b) => a.key.localeCompare(b.key));
    } finally {
      await txn.discard().catch(() => {});
    }
  }

  async function deleteRepoNodes(repo: string): Promise<void> {
    const txn = dgraphClient.newTxn();

    try {
      const res = await txn.queryWithVars(
        `query nodes($repo: string) {
          specs(func: eq(Spec.repo, $repo)) { uid }
          root(func: eq(Repo.xid, $repo)) { uid }
          blocks(func: eq(Block.repo, $repo)) { uid }
          sections(func: eq(Section.repo, $repo)) { uid }
          statements(func: eq(Statement.repo, $repo)) { uid }
          acs(func: eq(AcceptanceCriterion.repo, $repo)) { uid }
          codechunks(func: eq(CodeChunk.repo, $repo)) { uid }
          testchunks(func: eq(TestChunk.repo, $repo)) { uid }
          coverages(func: eq(Coverage.repo, $repo)) { uid }
        }`,
        { $repo: repo },
      );
      const data = res.data as Record<string, { uid: string }[]>;
      const uids = Object.values(data)
        .flat()
        .map((node) => node.uid);

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
  }

  const specPath = "specs/example/spec.md";
  const content =
    "## Overview\n\n" +
    "- The widget emits a click. ([validated by](spec/widget_spec.rb#L5), [impl](src/widget.rb#L10))\n" +
    "- It is responsive.\n\n" +
    "## Acceptance Criteria\n\n" +
    "1. The button is keyboard reachable. ([validated by](spec/a11y_spec.rb#L3))\n";

  async function runUnits(repo: string): Promise<void> {
    await projectSpecFile(repo, specPath, content, dgraphClient);
    await ingestCoverageReport(
      dgraphClient,
      { repo, tool: "lcov", commit: "c1" },
      [
        {
          testFile: "spec/widget_spec.rb",
          testName: "validated by",
          covered: [{ file: "src/other.rb", startLine: 1, endLine: 3 }],
        },
      ],
    );
  }

  let createdRepo = "";

  afterEach(async () => {
    if (createdRepo) {
      await deleteRepoNodes(createdRepo);
    }
    createdRepo = "";
  });

  describe("The graph is a derived projection only — no DB linker tables are reintroduced; deleting the entire graph and re-running the units from markdown + chunks + coverage reproduces it exactly.", () => {
    it("reproduces the identical subgraph after deleting it and re-running the units", async () => {
      const repo = `determinism/${randomUUID()}`;

      createdRepo = repo;

      await runUnits(repo);
      const before = await snapshot(repo);

      expect(before.length).toBeGreaterThan(0);

      await deleteRepoNodes(repo);
      expect(await snapshot(repo)).toEqual([]);

      await runUnits(repo);
      const after = await snapshot(repo);

      expect(after).toEqual(before);
    });
  });
});

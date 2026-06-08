import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import * as dgraph from "dgraph-js-http";
import {
  segmentStatements,
  parseTestLinksInStatement,
  parseCodeLinksInStatement,
  buildIntroOrdinals,
  classifyByHeuristic,
  segmentBlocks,
  parseEmbedding,
} from "@re-cinq/lore-shared";
import { projectSpecFile } from "../project-spec-file.js";
import { recomputeFile } from "../recompute-spec-file.js";

/**
 * projectSpecFile (spec-traceability-graph, Phase 1 projection unit) — writes
 * Repo + Spec + Statement nodes into the REAL local Dgraph cluster, keyed by
 * deterministic xids (`${repo}|${filePath}`, `${repo}|${filePath}|${ordinal}`),
 * with the Spec attached to a Repo root via Repo.specs and each Statement linked
 * back via Statement.spec. Tested against live Dgraph (no mocks). Container-gated:
 * skips when Dgraph isn't reachable so `npm test` passes without a container.
 *
 * Exercised here: Spec content_hash, Statement projection (incl. classifier
 * kind/testability/category), validated_by TestChunk links, implemented_by
 * CodeChunk links, Section grouping, and AcceptanceCriterion projection off the
 * Spec. Idempotent re-projection pruning is a LATER facet.
 */

const DGRAPH_HTTP = process.env.DGRAPH_HTTP ?? "http://localhost:8081";
// vitest cwd is the `agent/` package root, so `..` resolves to the repo root.
const REPO_ROOT = join(process.cwd(), "..");
const APPLIER = join(REPO_ROOT, "scripts", "infra", "setup-spec-trace-schema.sh");

async function dgraphReachable(): Promise<boolean> {
  try {
    return (await fetch(`${DGRAPH_HTTP}/health`, { signal: AbortSignal.timeout(800) })).ok;
  } catch {
    return false;
  }
}

const reachable = await dgraphReachable();

describe.skipIf(!reachable)("projectSpecFile (live Dgraph)", () => {
  const dgraphClient = new dgraph.DgraphClient(new dgraph.DgraphClientStub(DGRAPH_HTTP));

  beforeAll(() => {
    execFileSync("bash", [APPLIER], { env: { ...process.env, DGRAPH_HTTP }, stdio: "pipe" });
  });

  async function readGraph(query: string, vars: Record<string, string>): Promise<Record<string, unknown>> {
    const txn = dgraphClient.newTxn();
    try {
      const res = await txn.queryWithVars(query, vars);
      return (res.data ?? {}) as Record<string, unknown>;
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
        }`,
        { $repo: repo },
      );
      const data = res.data as {
        specs?: { uid: string }[];
        root?: { uid: string }[];
        blocks?: { uid: string }[];
      };
      const uids = [...(data.specs ?? []), ...(data.root ?? []), ...(data.blocks ?? [])].map(
        (node) => node.uid,
      );
      if (uids.length) {
        await txn.mutate({
          deleteNquads: uids.map((uid) => `<${uid}> * * .`).join("\n"),
          commitNow: true,
        });
      }
    } catch {
      // best-effort cleanup must never mask the assertion
    } finally {
      await txn.discard().catch(() => {});
    }
  }

  let createdRepo = "";
  afterEach(async () => {
    if (createdRepo) await deleteRepoNodes(createdRepo);
  });

  it("writes a Spec node keyed by repo|filePath with content_hash = sha256(content)", async () => {
    const repo = `test-proj/${randomUUID()}`;
    createdRepo = repo;
    const filePath = "specs/example/spec.md";
    const content = "# Example Spec\nThe widget MUST emit a click event.";
    const expectedHash = createHash("sha256").update(content).digest("hex");
    const expectedXid = `${repo}|${filePath}`;

    await projectSpecFile(repo, filePath, content, dgraphClient);

    const data = (await readGraph(
      `query q($xid: string) {
        node(func: eq(Spec.xid, $xid)) {
          Spec.xid Spec.repo Spec.file_path Spec.content_hash
        }
      }`,
      { $xid: expectedXid },
    )) as { node?: Record<string, unknown>[] };
    expect(data.node?.[0]).toMatchObject({
      "Spec.xid": expectedXid,
      "Spec.repo": repo,
      "Spec.file_path": filePath,
      "Spec.content_hash": expectedHash,
    });
  });

  it("projects two Statement nodes linked to the Spec with verbatim text and sha256 text_hash", async () => {
    const repo = `test-proj/${randomUUID()}`;
    createdRepo = repo;
    const filePath = "specs/example/spec.md";
    const content = "## Overview\n\nFirst statement here.\n\nSecond statement here.\n";
    const segments = segmentStatements(content);
    expect(segments).toHaveLength(2);

    const expectedStatements = segments.map((segment) => ({
      "Statement.xid": `${repo}|${filePath}|${segment.ordinal}`,
      "Statement.ordinal": segment.ordinal,
      "Statement.text": segment.text,
      "Statement.text_hash": createHash("sha256").update(segment.text).digest("hex"),
    }));

    await projectSpecFile(repo, filePath, content, dgraphClient);

    const data = (await readGraph(
      `query q($xid: string) {
        spec(func: eq(Spec.xid, $xid)) {
          uid
          stmts: ~Statement.spec {
            Statement.xid Statement.ordinal Statement.text Statement.text_hash
          }
        }
      }`,
      { $xid: `${repo}|${filePath}` },
    )) as { spec?: { stmts?: Record<string, unknown>[] }[] };
    const statements = data.spec?.[0]?.stmts ?? [];
    const sortedByOrdinal = [...statements].sort(
      (left, right) => (left["Statement.ordinal"] as number) - (right["Statement.ordinal"] as number),
    );
    expect(sortedByOrdinal).toMatchObject(expectedStatements);
  });

  it("stores Statement and AcceptanceCriterion embeddings from the injected embedder", async () => {
    const repo = `test-proj/${randomUUID()}`;
    createdRepo = repo;
    const filePath = "specs/example/spec.md";
    const content = "## Overview\n\nThe widget must emit a click.\n\n## Acceptance Criteria\n\n- The click is debounced.\n";
    // 768-dim to match the shared Statement.embedding/AcceptanceCriterion.embedding
    // HNSW index (the real Vertex text-embedding-005 dimension); values are exact in float32.
    const vector = new Array(768).fill(0);
    vector[0] = 0.5;
    vector[1] = 0.25;
    vector[2] = 0.125;

    await projectSpecFile(repo, filePath, content, dgraphClient, async () => vector);

    const data = (await readGraph(
      `query q($xid: string) {
        spec(func: eq(Spec.xid, $xid)) {
          stmts: ~Statement.spec { Statement.embedding }
          acs: ~AcceptanceCriterion.spec { AcceptanceCriterion.embedding }
        }
      }`,
      { $xid: `${repo}|${filePath}` },
    )) as { spec?: { stmts?: Record<string, unknown>[]; acs?: Record<string, unknown>[] }[] };

    expect(parseEmbedding(data.spec?.[0]?.stmts?.[0]?.["Statement.embedding"])).toEqual(vector);
    expect(parseEmbedding(data.spec?.[0]?.acs?.[0]?.["AcceptanceCriterion.embedding"])).toEqual(vector);
  });

  it("links the Statement to a TestChunk via validated_by for an inline test link", async () => {
    const repo = `test-proj/${randomUUID()}`;
    createdRepo = repo;
    const filePath = "specs/example/spec.md";
    const content = "## Overview\n\n- Returns the value ([validated by](src/x.test.ts#L42))\n";
    const segments = segmentStatements(content);
    expect(segments).toHaveLength(1);
    const [link] = parseTestLinksInStatement(segments[0].text);
    const expectedXid = `${repo}|${link.path}|${link.line ?? link.label}`;

    await projectSpecFile(repo, filePath, content, dgraphClient);

    const data = (await readGraph(
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
    const testChunks = data.stmt?.[0]?.["Statement.validated_by"] ?? [];
    expect(testChunks).toHaveLength(1);
    expect(testChunks[0]).toMatchObject({
      "TestChunk.xid": expectedXid,
      "TestChunk.repo": repo,
      "TestChunk.file_path": link.path,
      "TestChunk.test_name": link.label,
      "TestChunk.link_label": link.label,
      "TestChunk.start_line": link.line,
    });
  });

  it("links the Statement to a CodeChunk via implemented_by for an inline code link", async () => {
    const repo = `test-proj/${randomUUID()}`;
    createdRepo = repo;
    const filePath = "specs/example/spec.md";
    const content = "## Overview\n\n- The widget renders on mount ([impl](src/widget.ts#L10))\n";
    const segments = segmentStatements(content);
    expect(segments).toHaveLength(1);
    const [link] = parseCodeLinksInStatement(segments[0].text);
    const expectedXid = `${repo}|${link.path}|${link.line ?? link.label}`;

    await projectSpecFile(repo, filePath, content, dgraphClient);

    const data = (await readGraph(
      `query q($sx: string) {
        stmt(func: eq(Statement.xid, $sx)) {
          Statement.implemented_by {
            CodeChunk.xid CodeChunk.repo CodeChunk.file_path CodeChunk.start_line
          }
        }
      }`,
      { $sx: `${repo}|${filePath}|0` },
    )) as { stmt?: { "Statement.implemented_by"?: Record<string, unknown>[] }[] };
    const codeChunks = data.stmt?.[0]?.["Statement.implemented_by"] ?? [];
    expect(codeChunks).toHaveLength(1);
    expect(codeChunks[0]).toMatchObject({
      "CodeChunk.xid": expectedXid,
      "CodeChunk.repo": repo,
      "CodeChunk.file_path": link.path,
      "CodeChunk.start_line": link.line,
    });
  });

  it("returns projected true on first call and projected false on an unchanged second call", async () => {
    const repo = `test-proj/${randomUUID()}`;
    createdRepo = repo;
    const filePath = "specs/example/spec.md";
    const content = "## Overview\n\n- A point\n";

    const first = await projectSpecFile(repo, filePath, content, dgraphClient);
    expect(first).toEqual({ projected: true });

    const second = await projectSpecFile(repo, filePath, content, dgraphClient);
    expect(second).toEqual({ projected: false });
  });

  it("re-projects changed content and updates the reworded statement's text_hash", async () => {
    const repo = `test-proj/${randomUUID()}`;
    createdRepo = repo;
    const filePath = "specs/example/spec.md";

    await projectSpecFile(repo, filePath, "## Overview\n\n- A point\n", dgraphClient);

    const reworded = "## Overview\n\n- A reworded point\n";
    const second = await projectSpecFile(repo, filePath, reworded, dgraphClient);
    expect(second).toEqual({ projected: true });

    const [stmt] = segmentStatements(reworded);
    const expectedTextHash = createHash("sha256").update(stmt.text).digest("hex");

    const data = (await readGraph(
      `query q($xid: string) {
        stmt(func: eq(Statement.xid, $xid)) { Statement.text Statement.text_hash }
      }`,
      { $xid: `${repo}|${filePath}|0` },
    )) as { stmt?: Array<Record<string, unknown>> };

    expect(data.stmt?.[0]).toMatchObject({
      "Statement.text": stmt.text,
      "Statement.text_hash": expectedTextHash,
    });
  });

  it("carries classifier kind/testability/category on an untestable Background statement", async () => {
    const repo = `test-proj/${randomUUID()}`;
    createdRepo = repo;
    const filePath = "specs/example/spec.md";
    const content = "## Background\n\nThis section describes the prior art and context.\n";
    const segments = segmentStatements(content);
    expect(segments).toHaveLength(1);
    const intro = buildIntroOrdinals(segments);
    const classification = classifyByHeuristic(segments[0], intro);
    expect(classification.testability).toBe("untestable");

    await projectSpecFile(repo, filePath, content, dgraphClient);

    const data = (await readGraph(
      `query q($xid: string) {
        stmt(func: eq(Statement.xid, $xid)) {
          Statement.kind Statement.testability Statement.category
        }
      }`,
      { $xid: `${repo}|${filePath}|0` },
    )) as { stmt?: Record<string, unknown>[] };
    expect(data.stmt?.[0]).toMatchObject({
      "Statement.kind": segments[0].kind,
      "Statement.testability": classification.testability,
      "Statement.category": classification.category,
    });
  });

  it("groups both statements under one Section keyed by repo|filePath|0 reachable via Spec.sections", async () => {
    const repo = `test-proj/${randomUUID()}`;
    createdRepo = repo;
    const filePath = "specs/example/spec.md";
    const content = "## Overview\n\n- First point\n- Second point\n";
    const segments = segmentStatements(content);
    expect(segments).toHaveLength(2);
    expect(segments.every((segment) => segment.enclosingHeading === "Overview")).toBe(true);

    const expectedStatementXids = segments
      .map((segment) => `${repo}|${filePath}|${segment.ordinal}`)
      .sort();

    await projectSpecFile(repo, filePath, content, dgraphClient);

    const data = (await readGraph(
      `query q($xid: string) {
        spec(func: eq(Spec.xid, $xid)) {
          Spec.sections {
            Section.xid Section.heading
            stmts: ~Statement.section { Statement.xid }
          }
        }
      }`,
      { $xid: `${repo}|${filePath}` },
    )) as {
      spec?: {
        "Spec.sections"?: {
          "Section.xid": string;
          "Section.heading": string;
          stmts?: { "Statement.xid": string }[];
        }[];
      }[];
    };
    const sections = data.spec?.[0]?.["Spec.sections"] ?? [];
    expect(sections).toHaveLength(1);
    const [section] = sections;
    expect(section).toMatchObject({
      "Section.xid": `${repo}|${filePath}|0`,
      "Section.heading": "Overview",
    });
    const sectionStatementXids = (section.stmts ?? []).map((stmt) => stmt["Statement.xid"]).sort();
    expect(sectionStatementXids).toEqual(expectedStatementXids);
  });

  it("prunes the orphaned second Statement when re-projecting content with only the first", async () => {
    const repo = `test-proj/${randomUUID()}`;
    createdRepo = repo;
    const filePath = "specs/example/spec.md";
    const withTwo = "## Overview\n\n- First point\n- Second point\n";
    const withOne = "## Overview\n\n- First point\n";
    expect(segmentStatements(withOne)).toHaveLength(1);

    await projectSpecFile(repo, filePath, withTwo, dgraphClient);
    await projectSpecFile(repo, filePath, withOne, dgraphClient);

    const data = (await readGraph(
      `query q($xid: string) {
        spec(func: eq(Spec.xid, $xid)) {
          stmts: ~Statement.spec { Statement.xid Statement.ordinal }
        }
      }`,
      { $xid: `${repo}|${filePath}` },
    )) as { spec?: { stmts?: Record<string, unknown>[] }[] };
    const stmts = data.spec?.[0]?.stmts ?? [];
    expect(stmts).toHaveLength(1);
    expect(stmts[0]).toMatchObject({
      "Statement.xid": `${repo}|${filePath}|0`,
      "Statement.ordinal": 0,
    });
  });

  it("prunes an orphaned Section and its Spec.sections edge when a heading is removed on re-projection", async () => {
    const repo = `test-proj/${randomUUID()}`;
    createdRepo = repo;
    const filePath = "specs/example/spec.md";
    const withTwo = "## Alpha\n\nAlpha statement.\n\n## Beta\n\nBeta statement.\n";
    const withOne = "## Alpha\n\nAlpha statement.\n";

    await projectSpecFile(repo, filePath, withTwo, dgraphClient);
    await projectSpecFile(repo, filePath, withOne, dgraphClient);

    const data = (await readGraph(
      `query q($xid: string) {
        spec(func: eq(Spec.xid, $xid)) {
          viaReverse: ~Section.spec { Section.xid }
          viaForward: Spec.sections { Section.xid }
        }
      }`,
      { $xid: `${repo}|${filePath}` },
    )) as { spec?: { viaReverse?: Record<string, unknown>[]; viaForward?: Record<string, unknown>[] }[] };

    expect(data.spec?.[0]?.viaReverse).toEqual([{ "Section.xid": `${repo}|${filePath}|0` }]);
    expect(data.spec?.[0]?.viaForward).toEqual([{ "Section.xid": `${repo}|${filePath}|0` }]);
  });

  it("prunes an orphaned AcceptanceCriterion and its Spec.acceptance_criteria edge when an item is removed", async () => {
    const repo = `test-proj/${randomUUID()}`;
    createdRepo = repo;
    const filePath = "specs/example/spec.md";
    const withTwo = "## Acceptance Criteria\n\n- The first criterion.\n- The second criterion.\n";
    const withOne = "## Acceptance Criteria\n\n- The first criterion.\n";

    await projectSpecFile(repo, filePath, withTwo, dgraphClient);
    await projectSpecFile(repo, filePath, withOne, dgraphClient);

    const data = (await readGraph(
      `query q($xid: string) {
        spec(func: eq(Spec.xid, $xid)) {
          viaReverse: ~AcceptanceCriterion.spec { AcceptanceCriterion.text }
          viaForward: Spec.acceptance_criteria { AcceptanceCriterion.text }
        }
      }`,
      { $xid: `${repo}|${filePath}` },
    )) as { spec?: { viaReverse?: Record<string, unknown>[]; viaForward?: Record<string, unknown>[] }[] };

    expect(data.spec?.[0]?.viaReverse).toEqual([{ "AcceptanceCriterion.text": "The first criterion." }]);
    expect(data.spec?.[0]?.viaForward).toEqual([{ "AcceptanceCriterion.text": "The first criterion." }]);
  });

  it("projects ordered Block nodes reconstructing heading, blank, and paragraph source off the Spec", async () => {
    const repo = `test-proj/${randomUUID()}`;
    createdRepo = repo;
    const filePath = "specs/example/spec.md";
    const content = "## Overview\n\nThe widget emits a click event.";
    const expectedBlocks = segmentBlocks(content);
    expect(expectedBlocks).toHaveLength(3);

    await projectSpecFile(repo, filePath, content, dgraphClient);

    const data = (await readGraph(
      `query q($xid: string) {
        spec(func: eq(Spec.xid, $xid)) {
          blocks: ~Block.spec {
            Block.ordinal Block.kind Block.text Block.level
          }
        }
      }`,
      { $xid: `${repo}|${filePath}` },
    )) as { spec?: { blocks?: Record<string, unknown>[] }[] };
    const blocks = [...(data.spec?.[0]?.blocks ?? [])].sort(
      (left, right) => (left["Block.ordinal"] as number) - (right["Block.ordinal"] as number),
    );

    expect(
      blocks.map((block) => ({
        ordinal: block["Block.ordinal"],
        kind: block["Block.kind"],
        text: block["Block.text"],
      })),
    ).toEqual(expectedBlocks.map((block) => ({ ordinal: block.ordinal, kind: block.kind, text: block.text })));
    expect(blocks[0]["Block.level"]).toBe(2);
  });

  it("projects Acceptance Criteria items as AcceptanceCriterion nodes off the Spec and not as Statements", async () => {
    const repo = `test-proj/${randomUUID()}`;
    createdRepo = repo;
    const filePath = "specs/example/spec.md";
    const content = [
      "## Acceptance Criteria",
      "",
      "1. The system MUST respond within 200ms.",
      "2. Errors MUST be logged with a request id.",
      "",
    ].join("\n");

    const segs = segmentStatements(content);
    const acSegs = segs.filter((segment) => segment.enclosingHeading === "Acceptance Criteria");
    expect(acSegs.length).toBeGreaterThanOrEqual(2);

    const expectedCriteria = acSegs
      .map((segment) => ({
        "AcceptanceCriterion.xid": `${repo}|${filePath}|ac|${segment.ordinal}`,
        "AcceptanceCriterion.ordinal": segment.ordinal,
        "AcceptanceCriterion.text": segment.text,
        "AcceptanceCriterion.text_hash": createHash("sha256").update(segment.text).digest("hex"),
      }))
      .sort(
        (left, right) =>
          (left["AcceptanceCriterion.ordinal"] as number) - (right["AcceptanceCriterion.ordinal"] as number),
      );

    await projectSpecFile(repo, filePath, content, dgraphClient);

    const acData = (await readGraph(
      `query q($xid: string) {
        spec(func: eq(Spec.xid, $xid)) {
          Spec.acceptance_criteria {
            AcceptanceCriterion.xid AcceptanceCriterion.ordinal
            AcceptanceCriterion.text AcceptanceCriterion.text_hash
          }
        }
      }`,
      { $xid: `${repo}|${filePath}` },
    )) as { spec?: { "Spec.acceptance_criteria"?: Record<string, unknown>[] }[] };
    const criteria = (acData.spec?.[0]?.["Spec.acceptance_criteria"] ?? []).sort(
      (left, right) =>
        (left["AcceptanceCriterion.ordinal"] as number) - (right["AcceptanceCriterion.ordinal"] as number),
    );
    expect(criteria).toMatchObject(expectedCriteria);

    const stmtData = (await readGraph(
      `query q($xid: string) {
        spec(func: eq(Spec.xid, $xid)) {
          stmts: ~Statement.spec { Statement.xid }
        }
      }`,
      { $xid: `${repo}|${filePath}` },
    )) as { spec?: { stmts?: Record<string, unknown>[] }[] };
    expect(stmtData.spec?.[0]?.stmts ?? []).toEqual([]);
  });

  it("recomputes the exact source of a multi-kind document from its projected Blocks", async () => {
    const repo = `test-proj/${randomUUID()}`;
    createdRepo = repo;
    const filePath = "specs/example/spec.md";
    const content = [
      "# Title",
      "",
      "Intro paragraph.",
      "",
      "## Section",
      "",
      "- item one",
      "- item two",
      "",
      "```ts",
      "const x = 1;",
      "```",
    ].join("\n");

    await projectSpecFile(repo, filePath, content, dgraphClient);
    const recomputed = await recomputeFile(repo, filePath, dgraphClient);

    expect(recomputed).toBe(content);
  });

  it("recomputes the shorter source when re-projecting fewer blocks prunes the orphaned Blocks", async () => {
    const repo = `test-proj/${randomUUID()}`;
    createdRepo = repo;
    const filePath = "specs/example/spec.md";
    const longContent = ["# Title", "", "Para one.", "", "Para two."].join("\n");
    const shortContent = "# Title";

    await projectSpecFile(repo, filePath, longContent, dgraphClient);
    await projectSpecFile(repo, filePath, shortContent, dgraphClient);

    const recomputed = await recomputeFile(repo, filePath, dgraphClient);

    expect(recomputed).toBe(shortContent);
  });

  it("replaces a surviving statement's validated_by link when its inline test link changes on re-projection", async () => {
    const repo = `test-proj/${randomUUID()}`;
    createdRepo = repo;
    const filePath = "specs/example/spec.md";
    const linkedToA = "## Overview\n\n- Returns the value ([validated by](src/a.test.ts#L1))\n";
    const linkedToB = "## Overview\n\n- Returns the value ([validated by](src/b.test.ts#L2))\n";

    await projectSpecFile(repo, filePath, linkedToA, dgraphClient);
    await projectSpecFile(repo, filePath, linkedToB, dgraphClient);

    const data = (await readGraph(
      `query q($xid: string) {
        stmt(func: eq(Statement.xid, $xid)) {
          Statement.validated_by { TestChunk.file_path }
        }
      }`,
      { $xid: `${repo}|${filePath}|0` },
    )) as { stmt?: { "Statement.validated_by"?: Record<string, unknown>[] }[] };

    expect(data.stmt?.[0]?.["Statement.validated_by"]).toEqual([{ "TestChunk.file_path": "src/b.test.ts" }]);
  });
});

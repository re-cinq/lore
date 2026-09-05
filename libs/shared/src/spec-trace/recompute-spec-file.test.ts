import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { findRepoRoot } from "../lib/repo-root.js";
import { randomUUID } from "node:crypto";
import * as dgraph from "dgraph-js-http";
import { recomputeFile, sourceFromBlockRows } from "./recompute-spec-file.js";
import { makeDeleteRepoNodes } from "./test-helpers/delete-repo-nodes.js";
import { dgraphReachable } from "../lib/dgraph-test-gate.js";

describe("sourceFromBlockRows (pure)", () => {
  it("returns null for zero rows (a never-projected document)", () => {
    expect(sourceFromBlockRows([])).toBeNull();
  });

  it("returns empty string for a single blank block (a genuinely empty document)", () => {
    expect(
      sourceFromBlockRows([
        { "Block.ordinal": 0, "Block.kind": "blank", "Block.text": "" },
      ]),
    ).toBe("");
  });

  it("defaults an omitted Block.text to empty string (Dgraph omits stored empty scalars)", () => {
    expect(
      sourceFromBlockRows([{ "Block.ordinal": 0, "Block.kind": "blank" }]),
    ).toBe("");
  });

  it("reassembles rows in ordinal order regardless of query order", () => {
    const rows = [
      {
        "Block.ordinal": 2,
        "Block.kind": "paragraph" as const,
        "Block.text": "Body.",
      },
      { "Block.ordinal": 1, "Block.kind": "blank" as const, "Block.text": "" },
      {
        "Block.ordinal": 0,
        "Block.kind": "heading" as const,
        "Block.text": "# Title",
        "Block.level": 1,
      },
    ];

    expect(sourceFromBlockRows(rows)).toBe("# Title\n\nBody.");
  });
});

const DGRAPH_HTTP = process.env.DGRAPH_HTTP ?? "http://localhost:8081";
const APPLIER = join(
  findRepoRoot(),
  "scripts",
  "infra",
  "setup-spec-trace-schema.sh",
);

const reachable = await dgraphReachable();

describe.skipIf(!reachable)("recomputeFile (live Dgraph)", () => {
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
    { alias: "blocks", type: "Block" },
  ]);

  let createdRepo = "";

  afterEach(async () => {
    if (createdRepo) {
      await deleteRepoNodes(createdRepo);
    }
  });

  it("returns null for a never-projected file with no Block nodes", async () => {
    const repo = `test-recompute/${randomUUID()}`;

    createdRepo = repo;

    const result = await recomputeFile(
      repo,
      "specs/never/spec.md",
      dgraphClient,
    );

    expect(result).toBeNull();
  });
});

import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { findRepoRoot } from "../lib/repo-root.js";
import { randomUUID } from "node:crypto";
import * as dgraph from "dgraph-js-http";
import { recomputeFile, sourceFromBlockRows } from "./recompute-spec-file.js";

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

  async function deleteRepoNodes(repo: string): Promise<void> {
    const txn = dgraphClient.newTxn();

    try {
      const res = await txn.queryWithVars(
        `query nodes($repo: string) {
          blocks(func: eq(Block.repo, $repo)) { uid }
        }`,
        { $repo: repo },
      );
      const written = res.data as { blocks?: { uid: string }[] };
      const uids = (written.blocks ?? []).map((node) => node.uid);

      if (uids.length) {
        await txn.mutate({
          deleteNquads: uids.map((uid) => `<${uid}> * * .`).join("\n"),
          commitNow: true,
        });
      }
      // eslint-disable-next-line no-empty
    } catch {
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

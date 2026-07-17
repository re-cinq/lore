import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import * as dgraph from "dgraph-js-http";
import { projectAdrFile } from "./project-adr-file.js";
import { recomputeFile } from "./recompute-spec-file.js";

/**
 * projectAdrFile + recomputeFile (spec-traceability-graph) — the ADR artifact
 * joins the lossless Block layer that specs already enjoy. projectAdrFile
 * projects one Block per source block keyed by file_path (no Spec node), and
 * recomputeFile reconstructs ANY ingested document from its Blocks by file_path.
 * Kernel invariant exercised here: an ADR round-trips through the real graph
 * byte-exactly. Tested against live Dgraph (no mocks); skips when unreachable.
 */

const DGRAPH_HTTP = process.env.DGRAPH_HTTP ?? "http://localhost:8081";
const REPO_ROOT = join(process.cwd(), "..");
const APPLIER = join(
  REPO_ROOT,
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

describe.skipIf(!reachable)("projectAdrFile (live Dgraph)", () => {
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
          adrs(func: eq(ADR.repo, $repo)) { uid }
          root(func: eq(Repo.xid, $repo)) { uid }
        }`,
        { $repo: repo },
      );
      const data = res.data as {
        blocks?: { uid: string }[];
        adrs?: { uid: string }[];
        root?: { uid: string }[];
      };
      const uids = [
        ...(data.blocks ?? []),
        ...(data.adrs ?? []),
        ...(data.root ?? []),
      ].map((node) => node.uid);

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
    if (createdRepo) {
      await deleteRepoNodes(createdRepo);
    }
  });

  it("recomputes the exact ADR source after projecting it through the graph", async () => {
    const repo = `test-adr/${randomUUID()}`;

    createdRepo = repo;
    const filePath = "adrs/0016-dark-factory.md";
    const content = [
      "# ADR-016: Dark Factory mode",
      "",
      "## Status",
      "",
      "Accepted",
      "",
      "## Context",
      "",
      "- pressure one",
      "- pressure two",
      "",
      "## Decision",
      "",
      "We do the thing.",
    ].join("\n");

    await projectAdrFile(repo, filePath, content, dgraphClient);
    const recomputed = await recomputeFile(repo, filePath, dgraphClient);

    expect(recomputed).toBe(content);
  });

  it("attaches the projected ADR to its Repo root via Repo.adrs", async () => {
    const repo = `test-adr/${randomUUID()}`;

    createdRepo = repo;
    const filePath = "adrs/0020-x.md";
    const content = ["# ADR-020", "", "## Status", "", "Accepted"].join("\n");

    await projectAdrFile(repo, filePath, content, dgraphClient);

    const txn = dgraphClient.newTxn();
    const res = await txn.queryWithVars(
      `query q($repo: string){ root(func: eq(Repo.xid, $repo)){ adrs: Repo.adrs { ADR.file_path } } }`,
      { $repo: repo },
    );

    await txn.discard().catch(() => {});
    const data = res.data as {
      root?: Array<{ adrs?: Array<{ "ADR.file_path"?: string }> }>;
    };

    expect((data.root?.[0]?.adrs ?? []).map((a) => a["ADR.file_path"])).toEqual(
      [filePath],
    );
  });

  it("returns projected true then false on an unchanged re-projection (content_hash gate)", async () => {
    const repo = `test-adr/${randomUUID()}`;

    createdRepo = repo;
    const filePath = "adrs/0001-gate.md";
    const content = ["# ADR-001", "", "## Status", "", "Accepted"].join("\n");

    const first = await projectAdrFile(repo, filePath, content, dgraphClient);
    const second = await projectAdrFile(repo, filePath, content, dgraphClient);

    expect(first).toEqual({ projected: true });
    expect(second).toEqual({ projected: false });
  });

  it("recomputes the shorter source after re-projecting a SHORTER ADR over a longer one", async () => {
    const repo = `test-adr/${randomUUID()}`;

    createdRepo = repo;
    const filePath = "adrs/0016.md";
    const longContent = [
      "# ADR-016",
      "",
      "## Status",
      "",
      "Accepted",
      "",
      "## Context",
      "",
      "Old context.",
    ].join("\n");
    const shortContent = ["# ADR-016", "", "## Status", "", "Accepted"].join(
      "\n",
    );

    await projectAdrFile(repo, filePath, longContent, dgraphClient);
    await projectAdrFile(repo, filePath, shortContent, dgraphClient);
    const recomputed = await recomputeFile(repo, filePath, dgraphClient);

    expect(recomputed).toBe(shortContent);
  });
});

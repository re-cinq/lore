import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { findRepoRoot } from "../lib/repo-root.js";
import { randomUUID } from "node:crypto";
import * as dgraph from "dgraph-js-http";
import { projectAdrFile } from "./project-adr-file.js";
import { recomputeFile } from "./recompute-spec-file.js";
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

  const deleteRepoNodes = makeDeleteRepoNodes(dgraphClient, [
    { alias: "blocks", type: "Block" },
    { alias: "adrs", type: "ADR" },
    { alias: "root", type: "Repo", field: "xid" },
  ]);

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

    await projectAdrFile({ repo, filePath, content }, dgraphClient);
    const recomputed = await recomputeFile(repo, filePath, dgraphClient);

    expect(recomputed).toBe(content);
  });

  it("attaches the projected ADR to its Repo root via Repo.adrs", async () => {
    const repo = `test-adr/${randomUUID()}`;

    createdRepo = repo;
    const filePath = "adrs/0020-x.md";
    const content = ["# ADR-020", "", "## Status", "", "Accepted"].join("\n");

    await projectAdrFile({ repo, filePath, content }, dgraphClient);

    const txn = dgraphClient.newTxn();
    const res = await txn.queryWithVars(
      `query q($repo: string){ root(func: eq(Repo.xid, $repo)){ adrs: Repo.adrs { ADR.file_path } } }`,
      { $repo: repo },
    );

    await txn.discard().catch(() => {});
    const written = res.data as {
      root?: Array<{ adrs?: Array<{ "ADR.file_path"?: string }> }>;
    };

    expect(
      (written.root?.[0]?.adrs ?? []).map((a) => a["ADR.file_path"]),
    ).toEqual([filePath]);
  });

  it("returns projected true then false on an unchanged re-projection (content_hash gate)", async () => {
    const repo = `test-adr/${randomUUID()}`;

    createdRepo = repo;
    const filePath = "adrs/0001-gate.md";
    const content = ["# ADR-001", "", "## Status", "", "Accepted"].join("\n");

    const first = await projectAdrFile(
      { repo, filePath, content },
      dgraphClient,
    );
    const second = await projectAdrFile(
      { repo, filePath, content },
      dgraphClient,
    );

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

    await projectAdrFile(
      { repo, filePath, content: longContent },
      dgraphClient,
    );
    await projectAdrFile(
      { repo, filePath, content: shortContent },
      dgraphClient,
    );
    const recomputed = await recomputeFile(repo, filePath, dgraphClient);

    expect(recomputed).toBe(shortContent);
  });
});

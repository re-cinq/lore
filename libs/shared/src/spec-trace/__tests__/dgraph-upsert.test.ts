import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import * as dgraph from "dgraph-js-http";
import { upsertByXid, replaceEdgeWithFacets } from "../dgraph-upsert.js";

/**
 * replaceEdgeWithFacets (spec-traceability-graph) — sets a `[uid]` edge to a set
 * of targets, each carrying a scalar facet (`predicate|key`). Used to put the
 * covered line intervals on the `Coverage --covers--> File` edge. Tested against
 * live Dgraph (no mocks); container-gated.
 */

const DGRAPH_HTTP = process.env.DGRAPH_HTTP ?? "http://localhost:8081";
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

describe.skipIf(!reachable)("replaceEdgeWithFacets (live Dgraph)", () => {
  const dgraphClient = new dgraph.DgraphClient(new dgraph.DgraphClientStub(DGRAPH_HTTP));

  beforeAll(() => {
    execFileSync("bash", [APPLIER], { env: { ...process.env, DGRAPH_HTTP }, stdio: "pipe" });
  });

  async function readGraph(query: string, vars: Record<string, string>): Promise<Record<string, unknown>> {
    const txn = dgraphClient.newTxn();
    try {
      return ((await txn.queryWithVars(query, vars)).data ?? {}) as Record<string, unknown>;
    } finally {
      await txn.discard().catch(() => {});
    }
  }

  let createdRepo = "";
  afterEach(async () => {
    if (!createdRepo) return;
    const txn = dgraphClient.newTxn();
    try {
      const res = await txn.queryWithVars(
        `query q($r: string){ cov(func: eq(Coverage.repo,$r)){uid} f(func: eq(File.repo,$r)){uid} }`,
        { $r: createdRepo },
      );
      const data = res.data as { cov?: { uid: string }[]; f?: { uid: string }[] };
      const uids = [...(data.cov ?? []), ...(data.f ?? [])].map((n) => n.uid);
      if (uids.length) await txn.mutate({ deleteNquads: uids.map((u) => `<${u}> * * .`).join("\n"), commitNow: true });
    } catch {
      // best-effort
    } finally {
      await txn.discard().catch(() => {});
    }
  });

  it("sets a Coverage.covers edge to a File with a `ranges` string facet, readable via @facets", async () => {
    const repo = `test-facet/${randomUUID()}`;
    createdRepo = repo;
    const coverageUid = await upsertByXid(dgraphClient, "Coverage", `${repo}|t|t`, { "Coverage.repo": repo });
    const fileUid = await upsertByXid(dgraphClient, "File", `${repo}|src/a.ts`, {
      "File.repo": repo,
      "File.path": "src/a.ts",
    });

    await replaceEdgeWithFacets(dgraphClient, coverageUid, "Coverage.covers", [
      { uid: fileUid, facets: { ranges: "12-18,30-40" } },
    ]);

    const data = (await readGraph(
      `query q($uid: string) {
        cov(func: uid($uid)) {
          Coverage.covers @facets(ranges) { uid File.path }
        }
      }`,
      { $uid: coverageUid },
    )) as { cov?: { "Coverage.covers"?: Record<string, unknown>[] }[] };
    const covers = data.cov?.[0]?.["Coverage.covers"] ?? [];
    expect(covers).toHaveLength(1);
    expect(covers[0]).toMatchObject({ uid: fileUid, "File.path": "src/a.ts", "Coverage.covers|ranges": "12-18,30-40" });
  });
});

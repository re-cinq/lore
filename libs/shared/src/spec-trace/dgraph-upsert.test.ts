import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { findRepoRoot } from "../lib/repo-root.js";
import { randomUUID } from "node:crypto";
import * as dgraph from "dgraph-js-http";
import {
  upsertByXid,
  replaceEdgeWithFacets,
  withTxn,
  isTxnAborted,
} from "./dgraph-upsert.js";
import { enforceTrue } from "../lib/enforce.js";
import type { DgraphClientPort, DgraphTxn } from "../memory-store.js";

/**
 * replaceEdgeWithFacets (spec-traceability-graph) — sets a `[uid]` edge to a set
 * of targets, each carrying a scalar facet (`predicate|key`). Used to put the
 * covered line intervals on the `Coverage --covers--> File` edge. Tested against
 * live Dgraph (no mocks); container-gated.
 */

const DGRAPH_HTTP = process.env.DGRAPH_HTTP ?? "http://localhost:8081";
const REPO_ROOT = findRepoRoot();
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

describe.skipIf(!reachable)("replaceEdgeWithFacets (live Dgraph)", () => {
  const dgraphClient = new dgraph.DgraphClient(
    new dgraph.DgraphClientStub(DGRAPH_HTTP),
  );

  beforeAll(() => {
    execFileSync("bash", [APPLIER], {
      env: { ...process.env, DGRAPH_HTTP },
      stdio: "pipe",
    });
  });

  async function readGraph(
    query: string,
    vars: Record<string, string>,
  ): Promise<Record<string, unknown>> {
    const txn = dgraphClient.newTxn();

    try {
      return ((await txn.queryWithVars(query, vars)).data ?? {}) as Record<
        string,
        unknown
      >;
    } finally {
      await txn.discard().catch(() => {});
    }
  }

  let createdRepo = "";

  afterEach(async () => {
    if (!createdRepo) {
      return;
    }
    const txn = dgraphClient.newTxn();

    try {
      const res = await txn.queryWithVars(
        `query q($r: string){ cov(func: eq(Coverage.repo,$r)){uid} f(func: eq(File.repo,$r)){uid} }`,
        { $r: createdRepo },
      );
      const data = res.data as {
        cov?: { uid: string }[];
        f?: { uid: string }[];
      };
      const uids = [...(data.cov ?? []), ...(data.f ?? [])].map((n) => n.uid);

      if (uids.length) {
        await txn.mutate({
          deleteNquads: uids.map((u) => `<${u}> * * .`).join("\n"),
          commitNow: true,
        });
      }
    } catch {
      // best-effort
    } finally {
      await txn.discard().catch(() => {});
    }
  });

  it("sets a Coverage.covers edge to a File with a `ranges` string facet, readable via @facets", async () => {
    const repo = `test-facet/${randomUUID()}`;

    createdRepo = repo;
    const coverageUid = await upsertByXid(
      dgraphClient,
      "Coverage",
      `${repo}|t|t`,
      { "Coverage.repo": repo },
    );
    const fileUid = await upsertByXid(
      dgraphClient,
      "File",
      `${repo}|src/a.ts`,
      {
        "File.repo": repo,
        "File.path": "src/a.ts",
      },
    );

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
    expect(covers[0]).toMatchObject({
      uid: fileUid,
      "File.path": "src/a.ts",
      "Coverage.covers|ranges": "12-18,30-40",
    });
  });
});

/**
 * Retry-on-abort (spec-traceability-graph #36 context): dgraph normalizes
 * aborts AND write-write conflicts into one Error whose message is the only
 * discriminator ("Transaction has been aborted. Please retry"). withTxn
 * retries those on a FRESH transaction per attempt (an aborted txn is
 * finished) and rethrows anything else immediately. Fake 3-method port — no
 * container needed.
 */
describe("withTxn retry-on-abort (fake port)", () => {
  const ABORT = "Transaction has been aborted. Please retry";

  interface ScriptedTxn {
    txn: DgraphTxn;
    discarded: boolean;
  }

  function scriptedPort(behaviors: Array<"abort" | "ok" | "schema-error">): {
    port: DgraphClientPort;
    txns: ScriptedTxn[];
  } {
    const txns: ScriptedTxn[] = [];

    return {
      txns,
      port: {
        newTxn: () => {
          const behavior = behaviors[txns.length] ?? "ok";
          const scripted: ScriptedTxn = {
            discarded: false,
            txn: {
              queryWithVars: async () => {
                enforceTrue(behavior !== "abort", Error, ABORT);
                enforceTrue(
                  behavior !== "schema-error",
                  Error,
                  "Schema not defined for predicate Spec.xid",
                );

                return { data: { found: [{ uid: "0xok" }] } };
              },

              mutate: async () => ({ data: {} }),

              discard: async () => {
                scripted.discarded = true;
              },
            },
          };

          txns.push(scripted);

          return scripted.txn;
        },
      },
    };
  }

  const recordingSleep = () => {
    const slept: number[] = [];

    const sleep = async (ms: number): Promise<void> => {
      slept.push(ms);
    };

    return { slept, sleep };
  };

  it("retries an abort on a fresh txn, sleeping 200ms, and returns the 2nd attempt's result", async () => {
    const { port, txns } = scriptedPort(["abort", "ok"]);
    const { slept, sleep } = recordingSleep();
    const result = await withTxn(
      port,
      async (txn) => (await txn.queryWithVars("q", {})).data,
      { sleep },
    );

    expect(result).toEqual({ found: [{ uid: "0xok" }] });
    expect(txns).toHaveLength(2);
    expect(slept).toEqual([200]);
    expect(txns.map((t) => t.discarded)).toEqual([true, true]);
  });

  it("rethrows a non-abort error immediately: 1 txn, 0 sleeps", async () => {
    const { port, txns } = scriptedPort(["schema-error"]);
    const { slept, sleep } = recordingSleep();

    await expect(
      withTxn(port, async (txn) => txn.queryWithVars("q", {}), { sleep }),
    ).rejects.toThrow("Schema not defined for predicate Spec.xid");
    expect(txns).toHaveLength(1);
    expect(slept).toEqual([]);
  });

  it("exhausts after 4 attempts sleeping 200/500/1000ms and rethrows the abort", async () => {
    const { port, txns } = scriptedPort(["abort", "abort", "abort", "abort"]);
    const { slept, sleep } = recordingSleep();

    await expect(
      withTxn(port, async (txn) => txn.queryWithVars("q", {}), { sleep }),
    ).rejects.toThrow(ABORT);
    expect(txns).toHaveLength(4);
    expect(slept).toEqual([200, 500, 1000]);
  });

  it("isTxnAborted accepts the driver's abort shapes and rejects everything else", () => {
    expect(isTxnAborted(new Error(ABORT))).toBe(true);
    expect(isTxnAborted(new Error("Transaction aborted, please retry"))).toBe(
      true,
    );
    expect(isTxnAborted(new Error("connection refused"))).toBe(false);
    expect(isTxnAborted(new Error("retry later"))).toBe(false);
    expect(isTxnAborted("Transaction has been aborted. Please retry")).toBe(
      false,
    );
    expect(isTxnAborted(undefined)).toBe(false);
  });

  it("upsertByXid survives a first-attempt abort and reuses the node the retry finds", async () => {
    const { port, txns } = scriptedPort(["abort", "ok"]);
    const uid = await upsertByXid(port, "Spec", "re-cinq/lore|specs/a.md", {
      "Spec.repo": "re-cinq/lore",
    });

    expect(uid).toBe("0xok");
    expect(txns).toHaveLength(2);
  });
});

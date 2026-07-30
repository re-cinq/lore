import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { findRepoRoot } from "./lib/repo-root.js";

/**
 * T003 — the memory Dgraph schema applier
 * (`scripts/infra/setup-memory-dgraph-schema.sh`) is idempotent and lands the
 * native HNSW vector index + the `xid` upsert index. Runs against the REAL
 * local Dgraph container (no mocks), per the memory-dgraph-migration spec
 * (AC10). Skips when Dgraph isn't reachable so `npm test` still passes without
 * a container. Bring one up with `npm run services:up` (or `dgraph:up`).
 */

const DGRAPH_HTTP = process.env.DGRAPH_HTTP ?? "http://localhost:8081";
const APPLIER = join(
  findRepoRoot(),
  "scripts",
  "infra",
  "setup-memory-dgraph-schema.sh",
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

function applySchema(): void {
  execFileSync("bash", [APPLIER], {
    env: { ...process.env, DGRAPH_HTTP },
    stdio: "pipe",
  });
}

async function querySchema(
  dql: string,
): Promise<{ schema: Array<Record<string, unknown>> }> {
  const res = await fetch(`${DGRAPH_HTTP}/query`, {
    method: "POST",
    headers: { "Content-Type": "application/dql" },
    body: dql,
  });

  return (await res.json()).data;
}

const reachable = await dgraphReachable();

describe.skipIf(!reachable)(
  "setup-memory-dgraph-schema applier (live Dgraph)",
  () => {
    beforeAll(() => applySchema());

    it("declares the HNSW vector index and the xid upsert index", async () => {
      const { schema } = await querySchema(
        "schema(pred: [Memory.embedding, Memory.xid]) {type index tokenizer upsert}",
      );
      const byPred = Object.fromEntries(schema.map((s) => [s.predicate, s]));

      expect(byPred["Memory.embedding"]).toMatchObject({
        type: "float32vector",
      });
      expect(
        String((byPred["Memory.embedding"].tokenizer as string[])?.[0]),
      ).toMatch(/hnsw/);
      expect(byPred["Memory.xid"]).toMatchObject({ index: true, upsert: true });
    });

    it("is idempotent — a second apply leaves the predicate schema unchanged", async () => {
      const sortByPred = (s: Array<Record<string, unknown>>) =>
        [...s].sort((a, b) =>
          String(a.predicate).localeCompare(String(b.predicate)),
        );

      const before = sortByPred((await querySchema("schema {}")).schema);

      applySchema(); // second run — must be a no-op
      const after = sortByPred((await querySchema("schema {}")).schema);

      expect(after).toEqual(before);
    });
  },
);

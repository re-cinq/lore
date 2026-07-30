import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { findRepoRoot } from "./lib/repo-root.js";

/**
 * The spec-traceability-graph Dgraph schema applier
 * (`scripts/infra/setup-spec-trace-schema.sh`) lands the core traceability
 * predicates: the `Statement.xid` hash upsert index and the
 * `Statement.embedding` float32vector HNSW index. Runs against the REAL local
 * Dgraph container (no mocks), per the spec-traceability-graph data-model.
 * Skips when Dgraph isn't reachable so `npm test` still passes without a
 * container. Bring one up with `npm run services:up` (or `dgraph:up`).
 */

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
  "setup-spec-trace-schema applier (live Dgraph)",
  () => {
    beforeAll(() => applySchema());

    it("declares the Statement xid upsert index and the Statement embedding HNSW vector index", async () => {
      const { schema } = await querySchema(
        "schema(pred: [Statement.embedding, Statement.xid]) {type index tokenizer upsert}",
      );
      const byPred = Object.fromEntries(schema.map((s) => [s.predicate, s]));

      expect(byPred["Statement.embedding"]).toMatchObject({
        type: "float32vector",
      });
      expect(
        String((byPred["Statement.embedding"].tokenizer as string[])?.[0]),
      ).toMatch(/hnsw/);
      expect(byPred["Statement.xid"]).toMatchObject({
        index: true,
        upsert: true,
      });
    });

    it("declares every traceability node type's xid as a hash upsert index", async () => {
      const xids = [
        "Repo.xid",
        "Spec.xid",
        "Section.xid",
        "Statement.xid",
        "AcceptanceCriterion.xid",
        "CodeChunk.xid",
        "TestChunk.xid",
        "TestSuite.xid",
        "Coverage.xid",
        "ADR.xid",
      ];
      const { schema } = await querySchema(
        `schema(pred: [${xids.join(", ")}]) {index upsert tokenizer}`,
      );
      const byPred = Object.fromEntries(schema.map((s) => [s.predicate, s]));

      for (const pred of xids) {
        expect(byPred[pred], `${pred} should be declared`).toMatchObject({
          index: true,
          upsert: true,
        });
        expect(String((byPred[pred].tokenizer as string[])?.[0])).toBe("hash");
      }
    });

    it("declares every embedding predicate as a float32vector HNSW index", async () => {
      const embeds = [
        "Statement.embedding",
        "AcceptanceCriterion.embedding",
        "CodeChunk.embedding",
        "TestChunk.embedding",
        "ADR.embedding",
      ];
      const { schema } = await querySchema(
        `schema(pred: [${embeds.join(", ")}]) {type tokenizer}`,
      );
      const byPred = Object.fromEntries(schema.map((s) => [s.predicate, s]));

      for (const pred of embeds) {
        expect(byPred[pred], `${pred} should be a vector`).toMatchObject({
          type: "float32vector",
        });
        expect(String((byPred[pred].tokenizer as string[])?.[0])).toMatch(
          /hnsw/,
        );
      }
    });

    it("declares the relationship edge predicates as uid lists", async () => {
      const edges = [
        "Repo.specs",
        "Spec.sections",
        "Section.statements",
        "Statement.validated_by",
        "Coverage.covers",
      ];
      const { schema } = await querySchema(
        `schema(pred: [${edges.join(", ")}]) {type list}`,
      );
      const byPred = Object.fromEntries(schema.map((s) => [s.predicate, s]));

      for (const pred of edges) {
        expect(byPred[pred], `${pred} should be a uid list`).toMatchObject({
          type: "uid",
          list: true,
        });
      }
    });

    it("lists Statement.violated and Statement.violation_reason in the Statement type", async () => {
      const res = await fetch(`${DGRAPH_HTTP}/query`, {
        method: "POST",
        headers: { "Content-Type": "application/dql" },
        body: "schema(type: Statement) {}",
      });
      const types = (await res.json()).data.types as Array<{
        name: string;
        fields: Array<{ name: string }>;
      }>;
      const statement = types.find((t) => t.name === "Statement");
      const fields = (statement?.fields ?? []).map((f) => f.name);

      expect(fields).toContain("Statement.violated");
      expect(fields).toContain("Statement.violation_reason");
    });

    it("lists AcceptanceCriterion.violated and AcceptanceCriterion.violation_reason in the type", async () => {
      const res = await fetch(`${DGRAPH_HTTP}/query`, {
        method: "POST",
        headers: { "Content-Type": "application/dql" },
        body: "schema(type: AcceptanceCriterion) {}",
      });
      const types = (await res.json()).data.types as Array<{
        name: string;
        fields: Array<{ name: string }>;
      }>;
      const ac = types.find((t) => t.name === "AcceptanceCriterion");
      const fields = (ac?.fields ?? []).map((f) => f.name);

      expect(fields).toContain("AcceptanceCriterion.violated");
      expect(fields).toContain("AcceptanceCriterion.violation_reason");
    });

    it("is idempotent — a second apply leaves the predicate schema unchanged", async () => {
      const sortByPred = (s: Array<Record<string, unknown>>) =>
        [...s].sort((a, b) =>
          String(a.predicate).localeCompare(String(b.predicate)),
        );
      const before = sortByPred((await querySchema("schema {}")).schema);

      applySchema();
      const after = sortByPred((await querySchema("schema {}")).schema);

      expect(after).toEqual(before);
    });

    it("coexists with the memory schema — Memory.xid stays intact on the shared cluster", async () => {
      const { schema } = await querySchema(
        "schema(pred: [Memory.xid]) {index upsert}",
      );
      const byPred = Object.fromEntries(schema.map((s) => [s.predicate, s]));

      expect(byPred["Memory.xid"]).toMatchObject({ index: true, upsert: true });
    });
  },
);

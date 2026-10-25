import { describe, it, expect, beforeAll } from "vitest";
import { dgraphReachable } from "../lib/dgraph-test-gate.js";
import { createDgraphClient } from "./dgraph-client.js";

// @ts-expect-error - not yet implemented
import { setupSpecTraceSchema } from "./setup-spec-trace-schema.js";

const DGRAPH_HTTP = process.env.DGRAPH_HTTP ?? "http://localhost:8081";

async function querySchema(
  dql: string,
): Promise<{ schema: Array<Record<string, unknown>> }> {
  const res = await fetch(`${DGRAPH_HTTP}/query`, {
    signal: AbortSignal.timeout(30_000),
    method: "POST",
    headers: { "Content-Type": "application/dql" },
    body: dql,
  });

  return (await res.json()).data;
}

const reachable = await dgraphReachable();

describe.skipIf(!reachable)("setup-spec-trace-schema applier (TS)", () => {
  beforeAll(async () => {
    const client = createDgraphClient({ LORE_DGRAPH_HTTP: DGRAPH_HTTP });
    if (!client) throw new Error("Could not create client");
    await setupSpecTraceSchema(client);
  });

  it("declares the Statement xid upsert index and the Statement embedding HNSW vector index. ([validated by FR — setup-spec-trace-schema applier](libs/shared/src/outbound/setup-spec-trace-schema.acceptance.test.ts#L36))", async () => {
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

  it("declares every traceability node type's xid as a hash upsert index. ([validated by FR — setup-spec-trace-schema applier](libs/shared/src/outbound/setup-spec-trace-schema.acceptance.test.ts#L54))", async () => {
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

  it("declares every embedding predicate as a float32vector HNSW index. ([validated by FR — setup-spec-trace-schema applier](libs/shared/src/outbound/setup-spec-trace-schema.acceptance.test.ts#L83))", async () => {
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
      expect(String((byPred[pred].tokenizer as string[])?.[0])).toMatch(/hnsw/);
    }
  });

  it("declares the relationship edge predicates as uid lists. ([validated by FR — setup-spec-trace-schema applier](libs/shared/src/outbound/setup-spec-trace-schema.acceptance.test.ts#L106))", async () => {
    const edges = [
      "Repo.specs",
      "Spec.sections",
      "Section.statements",
      "Statement.validated_by",
      "Coverage.covers",
      "TestChunk.coverage",
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

  it("lists Statement.violated and Statement.violation_reason in the Statement type. ([validated by FR — setup-spec-trace-schema applier](libs/shared/src/outbound/setup-spec-trace-schema.acceptance.test.ts#L128))", async () => {
    const res = await fetch(`${DGRAPH_HTTP}/query`, {
      signal: AbortSignal.timeout(30_000),
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

  it("lists AcceptanceCriterion.violated and AcceptanceCriterion.violation_reason in the type. ([validated by FR — setup-spec-trace-schema applier](libs/shared/src/outbound/setup-spec-trace-schema.acceptance.test.ts#L146))", async () => {
    const res = await fetch(`${DGRAPH_HTTP}/query`, {
      signal: AbortSignal.timeout(30_000),
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

  it("declares CodeChunk.references and CodeChunk.imports as uid list predicates for the call graph. ([validated by FR — setup-spec-trace-schema applier](libs/shared/src/outbound/setup-spec-trace-schema.acceptance.test.ts#L164))", async () => {
    const { schema } = await querySchema(
      "schema(pred: [CodeChunk.references, CodeChunk.imports]) {type list reverse}",
    );
    const byPred = Object.fromEntries(schema.map((s) => [s.predicate, s]));

    expect(
      byPred["CodeChunk.references"],
      "CodeChunk.references should be declared as a uid list",
    ).toMatchObject({ type: "uid", list: true });
    expect(
      byPred["CodeChunk.imports"],
      "CodeChunk.imports should be declared as a uid list",
    ).toMatchObject({ type: "uid", list: true });
  });

  it("is idempotent — a second apply leaves the predicate schema unchanged. ([validated by FR — setup-spec-trace-schema applier](libs/shared/src/outbound/setup-spec-trace-schema.acceptance.test.ts#L181))", async () => {
    const sortByPred = (s: Array<Record<string, unknown>>) =>
      [...s].sort((a, b) =>
        String(a.predicate).localeCompare(String(b.predicate)),
      );
    const before = sortByPred((await querySchema("schema {}")).schema);

    const client = createDgraphClient({ LORE_DGRAPH_HTTP: DGRAPH_HTTP });
    if (!client) throw new Error("Could not create client");
    await setupSpecTraceSchema(client);

    const after = sortByPred((await querySchema("schema {}")).schema);

    expect(after).toEqual(before);
  });

  it("coexists with the memory schema — Memory.xid stays intact on the shared cluster. ([validated by FR — setup-spec-trace-schema applier](libs/shared/src/outbound/setup-spec-trace-schema.acceptance.test.ts#L198))", async () => {
    const { schema } = await querySchema(
      "schema(pred: [Memory.xid]) {index upsert}",
    );
    const byPred = Object.fromEntries(schema.map((s) => [s.predicate, s]));

    expect(byPred["Memory.xid"]).toMatchObject({ index: true, upsert: true });
  });

  it("declares Overlay.xid as a hash upsert index so a branch's overlay upserts independently of main. ([validated by FR — setup-spec-trace-schema applier](libs/shared/src/outbound/setup-spec-trace-schema.acceptance.test.ts#L207))", async () => {
    const { schema } = await querySchema(
      "schema(pred: [Overlay.xid, Overlay.branch, Overlay.head_commit]) {index upsert tokenizer}",
    );
    const byPred = Object.fromEntries(schema.map((s) => [s.predicate, s]));

    expect(byPred["Overlay.xid"]).toMatchObject({
      index: true,
      upsert: true,
    });
    expect(byPred["Overlay.branch"]).toMatchObject({ index: true });
    expect(byPred["Overlay.head_commit"]).toMatchObject({ index: true });
  });

  it("declares the Overlay chunk edges as uid lists so a branch's nodes hang off it instead of the Repo root. ([validated by FR — setup-spec-trace-schema applier](libs/shared/src/outbound/setup-spec-trace-schema.acceptance.test.ts#L222))", async () => {
    const { schema } = await querySchema(
      "schema(pred: [Overlay.test_chunks, Overlay.code_chunks, Overlay.coverage, Overlay.files]) {type list}",
    );
    const byPred = Object.fromEntries(schema.map((s) => [s.predicate, s]));

    for (const pred of [
      "Overlay.test_chunks",
      "Overlay.code_chunks",
      "Overlay.coverage",
      "Overlay.files",
    ]) {
      expect(byPred[pred], `${pred} should be a uid list`).toMatchObject({
        type: "uid",
        list: true,
      });
    }
  });
});

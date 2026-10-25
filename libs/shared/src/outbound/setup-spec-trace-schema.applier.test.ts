import { describe, it, expect, vi, afterEach } from "vitest";
import { setupSpecTraceSchema } from "./setup-spec-trace-schema.js";
import type { DgraphClientPort } from "../domain/memory-store-types.js";

type AlterCapture = DgraphClientPort & {
  alter(op: { schema: string }): Promise<unknown>;
  capturedSchema: string | undefined;
};

function makeCapturingClient(): AlterCapture {
  const client: AlterCapture = {
    capturedSchema: undefined,
    newTxn() {
      throw new Error("newTxn should not be called");
    },
    alter(op) {
      client.capturedSchema = op.schema;
      return Promise.resolve({});
    },
  };
  return client;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("setupSpecTraceSchema (applier unit)", () => {
  it("calls alter with a schema declaring Statement.xid as a hash upsert index. ([validated by FR — setup-spec-trace-schema applier](libs/shared/src/outbound/setup-spec-trace-schema.applier.test.ts#L30))", async () => {
    const client = makeCapturingClient();
    await setupSpecTraceSchema(client as unknown as DgraphClientPort);
    expect(client.capturedSchema).toContain(
      "Statement.xid: string @index(hash) @upsert",
    );
  });

  it("calls alter with a schema declaring Statement.embedding as a float32vector HNSW index. ([validated by FR — setup-spec-trace-schema applier](libs/shared/src/outbound/setup-spec-trace-schema.applier.test.ts#L39))", async () => {
    const client = makeCapturingClient();
    await setupSpecTraceSchema(client as unknown as DgraphClientPort);
    expect(client.capturedSchema).toContain(
      "Statement.embedding: float32vector @index(hnsw",
    );
  });

  it("calls alter with a schema declaring every traceability node type's xid. ([validated by FR — setup-spec-trace-schema applier](libs/shared/src/outbound/setup-spec-trace-schema.applier.test.ts#L48))", async () => {
    const client = makeCapturingClient();
    await setupSpecTraceSchema(client as unknown as DgraphClientPort);
    const s = client.capturedSchema ?? "";
    for (const xid of [
      "Repo.xid",
      "Spec.xid",
      "Section.xid",
      "AcceptanceCriterion.xid",
      "CodeChunk.xid",
      "TestChunk.xid",
      "TestSuite.xid",
      "Coverage.xid",
      "ADR.xid",
    ]) {
      expect(s, `${xid} should appear in schema`).toContain(
        `${xid}: string @index(hash) @upsert`,
      );
    }
  });

  it("retries alter on transient errors and resolves on the third attempt. ([validated by FR — setup-spec-trace-schema applier](libs/shared/src/outbound/setup-spec-trace-schema.applier.test.ts#L65))", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const client = {
      newTxn() {
        throw new Error("unexpected");
      },
      alter(_op: { schema: string }) {
        calls++;
        if (calls < 3) {
          return Promise.reject(
            new Error("Pending transactions found, cannot alter schema"),
          );
        }
        return Promise.resolve({});
      },
    } as unknown as DgraphClientPort;

    const promise = setupSpecTraceSchema(client);
    // Advance past the two retry delays (2s each)
    await vi.advanceTimersByTimeAsync(10_000);
    await promise;
    expect(calls).toBe(3);
  });
});

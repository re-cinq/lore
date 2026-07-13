import { describe, it, expect } from "vitest";
import { Audit } from "./audit.js";
import { PgAudit } from "./audit-pg.js";
import type { PgPool } from "../../memory-store.js";

function fakePool(): {
  pool: PgPool;
  calls: Array<{ text: string; params?: unknown[] }>;
} {
  const calls: Array<{ text: string; params?: unknown[] }> = [];
  const pool: PgPool = {
    async query(text: string, params?: unknown[]) {
      calls.push({ text, params });
      return { rows: [] };
    },
  };
  return { pool, calls };
}

describe("Audit sub-facade", () => {
  it("stamps the bound repo onto every entry", async () => {
    const { pool, calls } = fakePool();
    const audit = new Audit("octo/repo", new PgAudit(pool));

    await audit.write({
      event_type: "lease_expired",
      task_id: "t1",
      payload: { holder: "pod-a" },
    });

    expect(calls[0]?.params).toEqual([
      "lease_expired",
      "t1",
      "octo/repo",
      null,
      JSON.stringify({ holder: "pod-a" }),
    ]);
  });
});

describe("PgAudit adapter", () => {
  it("inserts into pipeline.audit_log with null defaults for optional columns", async () => {
    const { pool, calls } = fakePool();

    await new PgAudit(pool).write({
      event_type: "auto_merge_decision",
      payload: { outcome: "merged" },
    });

    expect(calls[0]?.text).toContain("INSERT INTO pipeline.audit_log");
    expect(calls[0]?.params).toEqual([
      "auto_merge_decision",
      null,
      null,
      null,
      JSON.stringify({ outcome: "merged" }),
    ]);
  });
});

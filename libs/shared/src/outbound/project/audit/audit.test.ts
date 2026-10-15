import { describe, it, expect } from "vitest";
import { Audit } from "./audit.js";
import { InMemoryAudit } from "./audit-memory.js";
import { PgAudit } from "./audit-pg.js";
import type { PgPool } from "../../memory-store.js";

function fakePool(): {
  pool: PgPool;
  calls: Array<{ text: string; params?: unknown[] }>;
} {
  const calls: Array<{ text: string; params?: unknown[] }> = [];
  const pool: PgPool = {
    async query<T>(text: string, params?: unknown[]): Promise<{ rows: T[] }> {
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

describe("Audit recorded", () => {
  it("is true for octo/repo's pr_merged of PR 7 only, not PR 8 nor octo/other's PR 9", async () => {
    const port = new InMemoryAudit();
    const audit = new Audit("octo/repo", port);

    await audit.write({ event_type: "pr_merged", payload: { prNumber: 7 } });
    await new Audit("octo/other", port).write({
      event_type: "pr_merged",
      payload: { prNumber: 9 },
    });

    expect({
      seven: await audit.recorded("pr_merged", { prNumber: 7 }),
      eight: await audit.recorded("pr_merged", { prNumber: 8 }),
      nineOfOther: await audit.recorded("pr_merged", { prNumber: 9 }),
      otherType: await audit.recorded("pr_blocked_reason", { prNumber: 7 }),
    }).toEqual({
      seven: true,
      eight: false,
      nineOfOther: false,
      otherType: false,
    });
  });

  it("asks pipeline.audit_log for one row of the type and repo whose payload contains the fields", async () => {
    const { pool, calls } = fakePool();

    await new Audit("octo/repo", new PgAudit(pool)).recorded("pr_merged", {
      prNumber: 7,
    });

    expect({ text: calls[0]?.text, params: calls[0]?.params }).toEqual({
      text: expect.stringContaining("payload @> $3::jsonb"),
      params: ["pr_merged", "octo/repo", JSON.stringify({ prNumber: 7 })],
    });
  });
});

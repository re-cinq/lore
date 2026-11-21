import { describe, it, expect } from "vitest";
import { writeAuditLog } from "./audit.js";
import { InMemoryAudit } from "./audit-memory.js";
import { PgAudit } from "./audit-pg.js";
import type { PgPool } from "../../memory-store.js";

describe("writeAuditLog", () => {
  it("inserts the audit entry into the injected repository", async () => {
    const audit = new InMemoryAudit();

    await writeAuditLog(
      {
        event_type: "auto_merge_decision",
        task_id: "t1",
        repo: "re-cinq/lore",
        actor: "lore-agent",
        payload: { outcome: "merged" },
      },
      audit,
    );

    expect(audit.entries).toEqual([
      {
        event_type: "auto_merge_decision",
        task_id: "t1",
        repo: "re-cinq/lore",
        actor: "lore-agent",
        payload: { outcome: "merged" },
      },
    ]);
  });

  it("accepts entries that omit the optional fields", async () => {
    const memory = new InMemoryAudit();

    await writeAuditLog(
      { event_type: "lease_expired", payload: { n: 1 } },
      memory,
    );

    const queries: Array<{ text: string; params?: unknown[] }> = [];
    const pool: PgPool = {
      async query<T>(text: string, params?: unknown[]): Promise<{ rows: T[] }> {
        queries.push({ text, params });

        return { rows: [] };
      },
    };

    await writeAuditLog(
      { event_type: "lease_expired", payload: { n: 1 } },
      new PgAudit(pool),
    );

    expect(memory.entries).toEqual([
      { event_type: "lease_expired", payload: { n: 1 } },
    ]);
    expect(queries[0]?.params).toEqual([
      "lease_expired",
      null,
      null,
      null,
      JSON.stringify({ n: 1 }),
    ]);
  });

  it("accumulates entries in insertion order", async () => {
    const audit = new InMemoryAudit();

    await writeAuditLog({ event_type: "a", payload: { seq: 1 } }, audit);
    await writeAuditLog({ event_type: "b", payload: { seq: 2 } }, audit);

    expect(audit.entries).toEqual([
      { event_type: "a", payload: { seq: 1 } },
      { event_type: "b", payload: { seq: 2 } },
    ]);
  });
});

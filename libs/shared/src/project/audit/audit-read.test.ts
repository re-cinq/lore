import { describe, it, expect } from "vitest";
import { InMemoryAudit } from "./audit-memory.js";
import { PgAudit } from "./audit-pg.js";
import type { PgPool } from "../../memory-store.js";

describe("audit listRecentByType", () => {
  it("returns newest-first entries of exactly the asked type, capped at the limit", async () => {
    let tick = 0;
    const audit = new InMemoryAudit(
      () => new Date(Date.UTC(2026, 7, 26, 10, 0, tick++)),
    );

    await audit.write({
      event_type: "cluster_agent_offline",
      payload: { n: 1 },
    });
    await audit.write({ event_type: "auto_merge_decision", payload: {} });
    await audit.write({
      event_type: "cluster_agent_offline",
      payload: { n: 2 },
    });
    await audit.write({
      event_type: "cluster_agent_offline",
      payload: { n: 3 },
    });

    const recent = await audit.listRecentByType("cluster_agent_offline", 2);

    expect(recent.map((e) => e.payload.n)).toEqual([3, 2]);
    expect(recent[0].createdAt).toBeInstanceOf(Date);
  });

  it("selects by type newest-first with the limit in the SQL", async () => {
    const calls: Array<{ text: string; params?: unknown[] }> = [];
    const pool: PgPool = {
      async query<T>(text: string, params?: unknown[]): Promise<{ rows: T[] }> {
        calls.push({ text, params });

        return { rows: [] };
      },
    };

    await new PgAudit(pool).listRecentByType("cluster_agent_offline", 20);

    expect(calls[0]?.text).toContain("WHERE event_type = $1");
    expect(calls[0]?.text).toContain("ORDER BY created_at DESC");
    expect(calls[0]?.params).toEqual(["cluster_agent_offline", 20]);
  });
});

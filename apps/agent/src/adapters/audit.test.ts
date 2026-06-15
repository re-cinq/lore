import { describe, it, expect } from "vitest";
import { writeAuditLog } from "./audit.js";
import { InMemoryAuditLogRepository } from "../data/repositories/index.js";

describe("writeAuditLog", () => {
  it("inserts the entry into the injected repository", async () => {
    const repo = new InMemoryAuditLogRepository();
    await writeAuditLog(
      {
        event_type: "auto_merge_decision",
        task_id: "t1",
        repo: "re-cinq/lore",
        actor: "lore-agent",
        payload: { outcome: "merged" },
      },
      repo,
    );
    expect(repo.rows).toEqual([
      {
        event_type: "auto_merge_decision",
        task_id: "t1",
        repo: "re-cinq/lore",
        actor: "lore-agent",
        payload: { outcome: "merged" },
      },
    ]);
  });

  it("accepts an entry that omits the optional fields", async () => {
    const repo = new InMemoryAuditLogRepository();
    await writeAuditLog({ event_type: "lease_expired", payload: { n: 1 } }, repo);
    expect(repo.rows[0]).toMatchObject({ event_type: "lease_expired", payload: { n: 1 } });
  });

  it("accumulates entries in insertion order", async () => {
    const repo = new InMemoryAuditLogRepository();
    await writeAuditLog({ event_type: "a", payload: {} }, repo);
    await writeAuditLog({ event_type: "b", payload: {} }, repo);
    expect(repo.rows.map((r) => r.event_type)).toEqual(["a", "b"]);
  });
});

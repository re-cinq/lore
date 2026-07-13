import { describe, it, expect } from "vitest";
import { writeAuditLog } from "./audit.js";
import { InMemoryAudit } from "@re-cinq/lore-shared/project/audit/audit-memory.js";

describe("writeAuditLog", () => {
  it("inserts the entry into the injected repository", async () => {
    const repo = new InMemoryAudit();
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
    expect(repo.entries).toEqual([
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
    const repo = new InMemoryAudit();
    await writeAuditLog(
      { event_type: "lease_expired", payload: { n: 1 } },
      repo,
    );
    expect(repo.entries[0]).toMatchObject({
      event_type: "lease_expired",
      payload: { n: 1 },
    });
  });

  it("accumulates entries in insertion order", async () => {
    const repo = new InMemoryAudit();
    await writeAuditLog({ event_type: "a", payload: {} }, repo);
    await writeAuditLog({ event_type: "b", payload: {} }, repo);
    expect(repo.entries.map((r) => r.event_type)).toEqual(["a", "b"]);
  });
});

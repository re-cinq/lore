import { describe, it, expect } from "vitest";
import { InMemoryAudit } from "./audit-memory.js";

describe("InMemoryAudit", () => {
  it("captures written entries for assertion", async () => {
    const audit = new InMemoryAudit();
    await audit.write({
      event_type: "lease_expired",
      task_id: "t1",
      payload: { branch_name: "b" },
    });
    expect(audit.entries).toEqual([
      {
        event_type: "lease_expired",
        task_id: "t1",
        payload: { branch_name: "b" },
      },
    ]);
  });
});

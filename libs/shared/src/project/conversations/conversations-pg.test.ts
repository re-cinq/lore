import { describe, it, expect } from "vitest";
import { PgConversations } from "./conversations-pg.js";
import { fakePgPool } from "../../test-helpers/fake-pg-pool.js";

describe("PgConversations column names (agent_conversations deliberately keeps assembly_line_id, FR6.44)", () => {
  const thread = {
    kind: "args",
    value: "feature-1",
    nodeId: "analyze",
  } as const;

  it("reserve writes the assembly_line_id column", async () => {
    const { pool, calls } = fakePgPool([{}]);

    await new PgConversations(pool).reserve({
      thread,
      conversationId: "c1",
      assemblyLineId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    });

    expect(calls[0]?.text).toContain("assembly_line_id");
    expect(calls[0]?.text).not.toContain("assembly_run_id");
  });

  it("latestFor reads the assembly_line_id column when excluding a run", async () => {
    const { pool, calls } = fakePgPool([{}]);

    await new PgConversations(pool).latestFor(thread, {
      exclude: {
        assemblyLineId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
        iteration: 1,
      },
    });

    expect(calls[0]?.text).toContain("assembly_line_id");
    expect(calls[0]?.text).not.toContain("assembly_run_id");
  });
});

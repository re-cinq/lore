import { describe, it, expect } from "vitest";
import { fakePgPool } from "../../test-helpers/fake-pg-pool.js";
import { PgAssemblyRuns } from "./assembly-runs-pg.js";

describe("PgAssemblyRuns start fans out its own event", () => {
  it("delivers the start event to its subscribers in the same statement as the run row", async () => {
    const { pool, calls } = fakePgPool([{ rows: [{ id: "run-1" }] }]);

    await new PgAssemblyRuns(pool).start({
      blueprintName: "implementation",
      repo: "re-cinq/lore",
    });

    expect(calls[0].text).toContain("INSERT INTO pipeline.assembly_runs");
    expect(calls[0].text).toContain("INSERT INTO pipeline.events");
    expect(calls[0].text).toContain("INSERT INTO pipeline.event_deliveries");
  });

  it("returns the event from its CTE so the fan-out has a row to read", async () => {
    const { pool, calls } = fakePgPool([{ rows: [{ id: "run-1" }] }]);

    await new PgAssemblyRuns(pool).start({
      blueprintName: "implementation",
      repo: "re-cinq/lore",
    });

    expect(calls[0].text).toContain("RETURNING id, event_name");
  });
});

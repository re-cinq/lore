import { describe, it, expect } from "vitest";
import { createInMemoryPipelineRepositories } from "./pipeline-repositories-memory.js";
import { InMemoryAudit } from "../audit/audit-memory.js";
import { InMemoryJobRuns } from "../job-runs/job-runs-memory.js";

describe("createInMemoryPipelineRepositories", () => {
  it("carries a working double behind every field", async () => {
    const pipeline = createInMemoryPipelineRepositories();

    const runId = await pipeline.jobRuns.start("nightly-reindex");

    await pipeline.audit.write({
      event_type: "auto_merge_decision",
      repo: "re-cinq/lore",
      payload: { rule: "paths" },
    });
    await pipeline.eventQueue.markDone("1");

    expect({
      lastRun: await pipeline.jobRuns.lastRun("nightly-reindex"),
      audited: (pipeline.audit as InMemoryAudit).entries,
      runIdMinted: runId.length > 0,
    }).toMatchObject({
      lastRun: { startedAt: expect.any(Date) },
      audited: [{ event_type: "auto_merge_decision", repo: "re-cinq/lore" }],
      runIdMinted: true,
    });
  });

  it("replaces only the overridden field, leaving the other seven doubles", () => {
    const seeded = new InMemoryJobRuns();

    const pipeline = createInMemoryPipelineRepositories({ jobRuns: seeded });

    expect(pipeline.jobRuns).toBe(seeded);
    expect(pipeline.audit).toBeInstanceOf(InMemoryAudit);
  });
});

import { describe, it, expect } from "vitest";
import { InMemoryUsage } from "./usage-memory.js";

const CALL = {
  model: "claude-sonnet-5",
  inputTokens: 100,
  outputTokens: 20,
  durationMs: 1500,
};

describe("InMemoryUsage.logLlmCall", () => {
  it("correlates a seeded task id onto task_id", async () => {
    const usage = new InMemoryUsage();

    usage.registerTask("task-1");
    const result = await usage.logLlmCall({ ...CALL, taskId: "task-1" });

    expect(result).toEqual({ correlated: true });
    expect(usage.rows[0]).toMatchObject({
      task_id: "task-1",
      assembly_line_id: null,
    });
  });

  it("falls back to assembly_line_id when the given id is a line, not a task", async () => {
    const usage = new InMemoryUsage();

    usage.registerAssemblyLine("line-1");
    const result = await usage.logLlmCall({ ...CALL, taskId: "line-1" });

    expect(result).toEqual({ correlated: true });
    expect(usage.rows[0]).toMatchObject({
      task_id: null,
      assembly_line_id: "line-1",
    });
  });

  it("resolves the agent CR name to the last registered node", async () => {
    const usage = new InMemoryUsage();

    usage.registerNode({ agentCrName: "cr-a", assemblyLineId: "line-old" });
    usage.registerNode({ agentCrName: "cr-a", assemblyLineId: "line-new" });
    const result = await usage.logLlmCall({ ...CALL, agentCrName: "cr-a" });

    expect(result).toEqual({ correlated: true });
    expect(usage.rows[0]).toMatchObject({ assembly_line_id: "line-new" });
  });

  it("takes the identity the call carried over both the CR name and the given id", async () => {
    // Cost attribution stops depending on a node row being findable by name — the
    // failure this replaces is a copied node row stealing another run's cost.
    const usage = new InMemoryUsage();

    usage.registerNode({ agentCrName: "cr-a", assemblyLineId: "guessed-line" });
    const result = await usage.logLlmCall({
      ...CALL,
      agentCrName: "cr-a",
      carried: {
        assemblyLineId: "stated-line",
        nodeId: "review",
        iteration: 1,
        stationRunId: "stated-station-run",
      },
    });

    expect(result).toEqual({ correlated: true });
    expect(usage.rows[0]).toMatchObject({
      assembly_line_id: "stated-line",
      station_run_id: "stated-station-run",
    });
  });

  it("counts a carried identity as correlated even with no seeded node or task", async () => {
    const usage = new InMemoryUsage();

    const result = await usage.logLlmCall({
      ...CALL,
      carried: {
        assemblyLineId: "stated-line",
        nodeId: "review",
        iteration: 1,
        stationRunId: null,
      },
    });

    expect(result).toEqual({ correlated: true });
  });

  it("stores an unknown-but-valid uuid uncorrelated, both ids null, instead of rejecting it", async () => {
    const usage = new InMemoryUsage();
    const result = await usage.logLlmCall({
      ...CALL,
      taskId: "00000000-0000-4000-8000-000000000000",
      agentCrName: "cr-unknown",
    });

    expect(result).toEqual({ correlated: false });
    expect(usage.rows).toHaveLength(1);
    expect(usage.rows[0]).toMatchObject({
      task_id: null,
      assembly_line_id: null,
    });
  });

  it("applies the write defaults: cost 0, status success, null error", async () => {
    const usage = new InMemoryUsage();

    await usage.logLlmCall(CALL);
    expect(usage.rows[0]).toMatchObject({
      job_name: null,
      cost_usd: 0,
      status: "success",
      error: null,
    });
  });
});

describe("InMemoryUsage.processedCounts", () => {
  it("counts rows after local midnight as today and everything as total", async () => {
    let clock = new Date(2026, 7, 3, 23, 0, 0);
    const usage = new InMemoryUsage(() => clock);

    await usage.logLlmCall(CALL);
    clock = new Date(2026, 7, 4, 9, 0, 0);
    await usage.logLlmCall(CALL);

    expect(await usage.processedCounts()).toEqual({ today: 1, total: 2 });
  });
});

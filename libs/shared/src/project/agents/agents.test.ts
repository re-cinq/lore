import { describe, it, expect } from "vitest";
import { Agents } from "./agents.js";
import type { AgentRunnerPort } from "./agent-runner-port.js";

/**
 * project.agents — the run() trust gate only (an Agent is one ephemeral run;
 * only LOCAL execution is refused on the shared server). Definition CRUD lives on
 * project.agentDefs / AgentDefs — see agent-defs.test.ts.
 */

function fakeRunner(): AgentRunnerPort {
  return {
    run: async (repo, taskId, opts) => ({ taskId, mode: opts?.mode ?? "local", started: true }),
  };
}

describe("Agents trust gate", () => {
  it("refuses LOCAL execution on the shared server (LORE_DB_HOST set)", async () => {
    const agents = new Agents("re-cinq/lore", fakeRunner(), { LORE_DB_HOST: "lore-db.internal" });

    await expect(agents.run("task-1")).rejects.toThrow(
      new Error("Test commands run only in a trusted sandbox — run in CI or locally."),
    );
  });

  it("allows cluster mode even with LORE_DB_HOST set (the agent creates CRs on the cluster)", async () => {
    const agents = new Agents("re-cinq/lore", fakeRunner(), { LORE_DB_HOST: "lore-db.internal" });

    expect(await agents.run("task-2", { mode: "cluster" })).toEqual({
      taskId: "task-2",
      mode: "cluster",
      started: true,
    });
  });
});

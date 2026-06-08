import { describe, it, expect } from "vitest";
import { Agents } from "./agents.js";
import type { AgentRunnerPort } from "./agent-runner-port.js";

/**
 * project.agents runs an agent in a sandbox and refuses on the shared server,
 * sharing the same trust gate as project.tests. The fake echoes the mode it
 * routed to.
 */

function fakeRunner(): AgentRunnerPort {
  return {
    run: async (repo, taskId, opts) => ({ taskId, mode: opts?.mode ?? "local", started: true }),
  };
}

describe("Agents trust gate", () => {
  it("refuses to run on the shared server (LORE_DB_HOST set)", async () => {
    const agents = new Agents("re-cinq/lore", fakeRunner(), { LORE_DB_HOST: "lore-db.internal" });

    await expect(agents.run("task-1")).rejects.toThrow(
      new Error("Test commands run only in a trusted sandbox — run in CI or locally."),
    );
  });

  it("routes to the requested mode in a sandbox", async () => {
    const agents = new Agents("re-cinq/lore", fakeRunner(), {});

    expect(await agents.run("task-1", { mode: "cluster" })).toEqual({
      taskId: "task-1",
      mode: "cluster",
      started: true,
    });
  });
});

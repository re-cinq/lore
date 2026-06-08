import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { AgentRunnerLocal } from "./agent-runner-local.js";

/**
 * AgentRunnerLocal spawns the agent CLI for real — pointed at a stub binary via
 * LORE_AGENT_CLI (`true`/`false`) so no actual Claude run or tokens are needed.
 * Integration (real spawn), no mocks. Skips on Windows.
 */

describe.skipIf(process.platform === "win32")("AgentRunnerLocal (live spawn)", () => {
  it("reports started when the agent CLI exits cleanly", async () => {
    const runner = new AgentRunnerLocal({ ...process.env, LORE_AGENT_CLI: "true" });

    expect(await runner.run("re-cinq/lore", "task-1", { workDir: tmpdir() })).toEqual({
      taskId: "task-1",
      mode: "local",
      started: true,
    });
  });

  it("reports not-started when the agent CLI exits non-zero", async () => {
    const runner = new AgentRunnerLocal({ ...process.env, LORE_AGENT_CLI: "false" });

    expect(await runner.run("re-cinq/lore", "task-2", { workDir: tmpdir() })).toMatchObject({ started: false });
  });

  it("defers cluster mode to the pending adapter", async () => {
    const runner = new AgentRunnerLocal({ ...process.env, LORE_AGENT_CLI: "true" });

    await expect(runner.run("re-cinq/lore", "task-3", { mode: "cluster" })).rejects.toThrow(
      'agents.run mode "cluster" needs the cluster/direct adapter (pending)',
    );
  });
});

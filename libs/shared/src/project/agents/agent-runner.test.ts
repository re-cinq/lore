import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { AgentRunner } from "./agent-runner.js";
import type { K8sPort, LoreTaskSpec } from "./k8s-port.js";
import type { LlmPort } from "./llm-port.js";

/**
 * AgentRunner routes the three modes. Local spawns a real (stub) CLI via
 * LORE_AGENT_CLI; cluster/direct delegate to injected fake providers — real
 * objects, no mock library. Skips local spawn on Windows.
 */

describe("AgentRunner", () => {
  it.skipIf(process.platform === "win32")("local mode spawns the agent CLI and reports started", async () => {
    const runner = new AgentRunner({ ...process.env, LORE_AGENT_CLI: "true" });

    expect(await runner.run("re-cinq/lore", "task-1", { workDir: tmpdir() })).toEqual({
      taskId: "task-1",
      mode: "local",
      started: true,
    });
  });

  it("cluster mode creates a LoreTask CR via the injected K8sPort", async () => {
    const created: LoreTaskSpec[] = [];
    const k8s: K8sPort = {
      createLoreTask: async (spec) => {
        created.push(spec);
        return { name: `loretask-${spec.taskId}`, created: true };
      },
    };
    const runner = new AgentRunner(process.env, { k8s });

    const result = await runner.run("re-cinq/lore", "task-2", {
      mode: "cluster",
      taskType: "implementation",
      branch: "feat",
      prNumber: 5,
      extraLabels: { "lore.re-cinq.com/dark-factory": "true" },
      darkFactory: { workflowName: "gap-fill", baseBranch: "main" },
    });

    expect(result).toEqual({ taskId: "task-2", mode: "cluster", started: true });
    expect(created[0]).toMatchObject({
      taskId: "task-2",
      taskType: "implementation",
      targetRepo: "re-cinq/lore",
      branch: "feat",
      prNumber: 5,
      extraLabels: { "lore.re-cinq.com/dark-factory": "true" },
      darkFactory: { workflowName: "gap-fill", baseBranch: "main" },
    });
  });

  it("direct mode calls the injected LlmPort", async () => {
    const prompts: string[] = [];
    const llm: LlmPort = {
      complete: async (prompt) => {
        prompts.push(prompt);
        return { text: "done" };
      },
    };
    const runner = new AgentRunner(process.env, { llm });

    expect(await runner.run("re-cinq/lore", "task-3", { mode: "direct", prompt: "hello" })).toEqual({
      taskId: "task-3",
      mode: "direct",
      started: true,
    });
    expect(prompts).toEqual(["hello"]);
  });

  it("throws when cluster mode has no K8sPort provider", async () => {
    const runner = new AgentRunner(process.env, {});

    await expect(runner.run("re-cinq/lore", "task-4", { mode: "cluster" })).rejects.toThrow(
      'agents.run mode "cluster" needs a K8sPort provider',
    );
  });
});

import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { AgentRunner } from "./agent-runner.js";
import type { LoreTaskSpec } from "./k8s-port.js";
import type { StationBackend } from "./station-port.js";
import type { LlmPort } from "./llm-port.js";

describe("AgentRunner", () => {
  it.skipIf(process.platform === "win32")(
    "local mode spawns the agent CLI and reports started",
    async () => {
      const runner = new AgentRunner({
        ...process.env,
        LORE_AGENT_CLI: "true",
      });

      expect(
        await runner.run("re-cinq/lore", "task-1", { workDir: tmpdir() }),
      ).toEqual({
        taskId: "task-1",
        mode: "local",
        started: true,
      });
    },
  );

  it("cluster mode launches a Station via the injected StationBackend", async () => {
    const created: LoreTaskSpec[] = [];
    const station: StationBackend = {
      launch: async (spec) => {
        created.push(spec);

        return { ref: `loretask-${spec.taskId}`, launched: true };
      },
      isActive: async () => true,
    };
    const runner = new AgentRunner(process.env, { station });

    const result = await runner.run("re-cinq/lore", "task-2", {
      mode: "cluster",
      taskType: "implementation",
      branch: "feat",
      prNumber: 5,
      extraLabels: { "lore.re-cinq.com/dark-factory": "true" },
      darkFactory: { workflowName: "gap-fill", baseBranch: "main" },
    });

    expect(result).toEqual({
      taskId: "task-2",
      mode: "cluster",
      started: true,
    });
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

  it("cluster mode forwards every run option to the Station spec", async () => {
    const created: LoreTaskSpec[] = [];
    const station: StationBackend = {
      launch: async (spec) => {
        created.push(spec);

        return { ref: "r", launched: true };
      },
      isActive: async () => true,
    };
    const runner = new AgentRunner(process.env, { station });

    await runner.run("re-cinq/lore", "task-9", {
      mode: "cluster",
      featureId: "feature-9",
      roundFeedback: '<RoundFeedback round="4"/>',
      resumeFromTask: "task-round-2",
    });

    expect(created[0]).toMatchObject({
      featureId: "feature-9",
      roundFeedback: '<RoundFeedback round="4"/>',
      resumeFromTask: "task-round-2",
    });
  });

  it("cluster mode passes the execution image to the Station", async () => {
    const created: LoreTaskSpec[] = [];
    const station: StationBackend = {
      launch: async (spec) => {
        created.push(spec);

        return { ref: `loretask-${spec.taskId}`, launched: true };
      },
      isActive: async () => true,
    };
    const runner = new AgentRunner(process.env, { station });

    await runner.run("re-cinq/lore", "task-img", {
      mode: "cluster",
      image: "golang:1.23",
    });

    expect(created[0]?.image).toBe("golang:1.23");
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

    expect(
      await runner.run("re-cinq/lore", "task-3", {
        mode: "direct",
        prompt: "hello",
      }),
    ).toEqual({
      taskId: "task-3",
      mode: "direct",
      started: true,
    });
    expect(prompts).toEqual(["hello"]);
  });

  it.skipIf(process.platform === "win32")(
    "runs local mode with a generated prompt when called with no options at all",
    async () => {
      const runner = new AgentRunner({
        ...process.env,
        LORE_AGENT_CLI: "true",
      });

      expect(await runner.run("re-cinq/lore", "task-5")).toEqual({
        taskId: "task-5",
        mode: "local",
        started: true,
      });
    },
  );

  it("throws when cluster mode has no StationBackend provider", async () => {
    const runner = new AgentRunner(process.env, {});

    await expect(
      runner.run("re-cinq/lore", "task-4", { mode: "cluster" }),
    ).rejects.toThrow(
      'agents.run mode "cluster" needs a StationBackend provider',
    );
  });
});

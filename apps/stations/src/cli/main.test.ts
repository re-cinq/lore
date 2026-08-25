import { describe, it, expect, afterEach } from "vitest";
import { runStation } from "./main.js";
import type { NodeStationRun } from "../stations/index.js";
import { Llm } from "@re-cinq/lore-shared/llm/llm.js";
import { FakeLlm } from "@re-cinq/lore-shared/llm/fake-llm.js";

const env = { workspaceDir: "/tmp" };
const inputJson = JSON.stringify({
  assembly_run_id: "al-1",
  node_id: "n",
  node_type: "detect",
  repo: "o/r",
  branch: "lore/x",
  task_id: null,
  params: {},
});

/** The seam is a RESOLVER now, not a map: the registry owns type-to-station, so
 *  this hands back one runner for the type under test and nothing for any other. */
const runners =
  (runner: NodeStationRun) =>
  (type: string): NodeStationRun | undefined =>
    type === "fake" ? runner : undefined;

afterEach(() => Llm.configure({}));

describe("runStation LLM usage tracking", () => {
  it("sums a runner's untracked model calls onto the terminal line", async () => {
    Llm.setInstance(
      new FakeLlm({
        text: "ok",
        usage: {
          inputTokens: 100,
          outputTokens: 10,
          costUsd: 0.001,
          durationMs: 50,
        },
      }),
    );

    const { line, exitCode } = await runStation(
      "fake",
      inputJson,
      env,
      runners(async () => {
        await Llm.instance.complete({ prompt: "a" });
        await Llm.instance.complete({ prompt: "b" });

        return { outcome: "success", extras: {} };
      }),
    );

    expect(exitCode).toBe(0);
    expect(JSON.parse(line)).toMatchObject({
      usage: { input_tokens: 200, output_tokens: 20 },
      total_cost_usd: 0.002,
      duration_ms: 100,
      model: "fake",
    });
  });

  it("prefers a runner's explicit NodeResult.usage over the tracker's sum", async () => {
    Llm.setInstance(
      new FakeLlm({ text: "ok", usage: { inputTokens: 100, costUsd: 0.001 } }),
    );

    const { line } = await runStation(
      "fake",
      inputJson,
      env,
      runners(async () => {
        await Llm.instance.complete({ prompt: "a" });

        return {
          outcome: "success",
          extras: {},
          usage: {
            inputTokens: 7,
            outputTokens: 3,
            costUsd: 0.5,
            durationMs: 9,
            model: "explicit",
          },
        };
      }),
    );

    expect(JSON.parse(line)).toMatchObject({
      usage: { input_tokens: 7, output_tokens: 3 },
      total_cost_usd: 0.5,
      model: "explicit",
    });
  });

  it("carries the partial spend on an infrastructure-failure line", async () => {
    Llm.setInstance(
      new FakeLlm({ text: "ok", usage: { inputTokens: 100, costUsd: 0.001 } }),
    );

    const { line, exitCode } = await runStation(
      "fake",
      inputJson,
      env,
      runners(async () => {
        await Llm.instance.complete({ prompt: "a" });
        throw new Error("dgraph unreachable");
      }),
    );

    expect(exitCode).toBe(1);
    expect(JSON.parse(line)).toMatchObject({
      is_error: true,
      result: "dgraph unreachable",
      usage: { input_tokens: 100, output_tokens: 0 },
      total_cost_usd: 0.001,
    });
  });

  it("emits no usage fields for a runner that makes no model calls", async () => {
    const { line } = await runStation(
      "fake",
      inputJson,
      env,
      runners(async () => ({ outcome: "success", extras: {} })),
    );

    expect(JSON.parse(line)).toEqual({
      type: "result",
      is_error: false,
      result: 'LORE_NODE_RESULT: {"outcome":"success","extras":{}}',
    });
  });

  it("restores the wrapped provider after the run", async () => {
    const fake = new FakeLlm({ text: "ok" });

    Llm.setInstance(fake);
    await runStation(
      "fake",
      inputJson,
      env,
      runners(async () => ({ outcome: "success", extras: {} })),
    );

    expect(Llm.instance).toBe(fake);
  });

  it("suppresses all terminal-line usage when a UsagePort is configured (per-call transport active)", async () => {
    Llm.configure({
      usage: {
        logLlmCall: async () => ({ correlated: true }),
        processedCounts: async () => ({ today: 0, total: 0 }),
      },
    });

    const fake = new FakeLlm({
      text: "ok",
      usage: { inputTokens: 100, costUsd: 0.001 },
    });

    Llm.setInstance(fake);

    const { line, exitCode } = await runStation(
      "fake",
      inputJson,
      env,
      runners(async () => {
        await Llm.instance.complete({ prompt: "a" });

        return {
          outcome: "success",
          extras: {},
          usage: {
            inputTokens: 7,
            outputTokens: 3,
            costUsd: 0.5,
            durationMs: 9,
            model: "explicit",
          },
        };
      }),
    );

    expect(Llm.instance).toBe(fake);
    expect(exitCode).toBe(0);
    expect(JSON.parse(line)).toEqual({
      type: "result",
      is_error: false,
      result: 'LORE_NODE_RESULT: {"outcome":"success","extras":{}}',
    });
  });
});

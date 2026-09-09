import { describe, it, expect } from "vitest";
import { createShutdown } from "./shutdown.js";

function harness(over: Partial<Parameters<typeof createShutdown>[0]> = {}) {
  const log: string[] = [];
  const exits: number[] = [];
  const shutdown = createShutdown({
    stopServing: async () => {
      log.push("stopServing");
    },
    flushTelemetry: async () => {
      log.push("flushTelemetry");
    },
    exit: (code) => {
      log.push(`exit:${code}`);
      exits.push(code);
    },
    ...over,
  });

  return { shutdown, log, exits };
}

describe("createShutdown", () => {
  it("drains queued events after it stops serving and before it exits", async () => {
    const { shutdown, log } = harness({
      flushEvents: async () => {
        log.push("flushEvents");

        return 0;
      },
    });

    await shutdown("SIGTERM");

    expect(log).toEqual([
      "stopServing",
      "flushEvents",
      "flushTelemetry",
      "exit:0",
    ]);
  });

  it("exits even when the event drain throws, rather than holding the rollout open", async () => {
    const { shutdown, log } = harness({
      flushEvents: () => Promise.reject(new Error("router unreachable")),
    });

    await shutdown("SIGTERM");

    expect(log).toEqual(["stopServing", "flushTelemetry", "exit:0"]);
  });

  it("stops serving, flushes telemetry, then EXITS", async () => {
    const { shutdown, log } = harness();

    await shutdown("SIGTERM");

    expect(log).toEqual(["stopServing", "flushTelemetry", "exit:0"]);
  });

  it("exits even when stopping the server throws", async () => {
    const { shutdown, log } = harness({
      stopServing: async () => {
        throw new Error("hapi refused");
      },
    });

    await shutdown("SIGTERM");

    expect(log).toEqual(["flushTelemetry", "exit:0"]);
  });

  it("exits even when the telemetry flush throws", async () => {
    const { shutdown, log } = harness({
      flushTelemetry: async () => {
        throw new Error("no GCP project");
      },
    });

    await shutdown("SIGTERM");

    expect(log).toEqual(["stopServing", "exit:0"]);
  });

  it("runs once however many signals arrive", async () => {
    const { shutdown, log } = harness();

    await Promise.all([shutdown("SIGTERM"), shutdown("SIGINT")]);

    expect(log).toEqual(["stopServing", "flushTelemetry", "exit:0"]);
  });
});

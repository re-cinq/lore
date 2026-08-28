import { describe, it, expect } from "vitest";
import { createShutdown } from "./shutdown.js";

/** Records the order things happened in — the ordering IS the contract. */
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
    // The queue lives in memory. `process.exit` takes it with it, and a terminal
    // event dropped on a rollout leaves its node open until the reaper — so the
    // drain has to happen inside the one handler that owns the lifecycle.
    // After stopServing, because an event produced by an in-flight request must
    // reach the queue before it is drained.
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
    // The bug this exists for: two independent SIGTERM handlers each did their own
    // half and neither exited. Registering any handler overrides Node's default
    // terminate, and the drain loop keeps the event loop alive — so the Floor stopped
    // answering and never died. In a rollout that is a pod which fails its liveness
    // probe for the whole grace period while looking like a slow shutdown.
    const { shutdown, log } = harness();

    await shutdown("SIGTERM");

    expect(log).toEqual(["stopServing", "flushTelemetry", "exit:0"]);
  });

  it("exits even when stopping the server throws", async () => {
    // A shutdown that cannot finish must still terminate, or the zombie is back.
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
    // SIGTERM then SIGINT, or a supervisor sending twice: the second must not
    // re-enter and flush again while the first is still draining.
    const { shutdown, log } = harness();

    await Promise.all([shutdown("SIGTERM"), shutdown("SIGINT")]);

    expect(log).toEqual(["stopServing", "flushTelemetry", "exit:0"]);
  });
});

import { describe, it, expect, vi } from "vitest";
import { shutdownGracefully } from "./http-server.js";

describe("shutdownGracefully", () => {
  it("stops the server, then flushes telemetry", async () => {
    // Order matters: spans recorded while draining in-flight requests are only
    // exported if the flush runs after the server stops.
    const order: string[] = [];

    await shutdownGracefully(
      { stop: async () => void order.push("stop") },
      async () => void order.push("flush"),
    );

    expect(order).toEqual(["stop", "flush"]);
  });

  it("flushes telemetry even when stopping the server fails", async () => {
    // The whole point of the flush is a clean rollout. A server that fails to
    // stop is exactly when the last batch is most worth having.
    const flush = vi.fn(async () => {});

    await shutdownGracefully(
      { stop: async () => Promise.reject(new Error("port stuck")) },
      flush,
    );

    expect(flush).toHaveBeenCalledOnce();
  });

  it("does not reject when the telemetry flush fails", async () => {
    // Telemetry is best-effort; an unauthed environment has no project id and the
    // export rejects. Crashing the shutdown over it would turn a clean rollout
    // into a SIGKILL.
    await expect(
      shutdownGracefully({ stop: async () => {} }, async () =>
        Promise.reject(new Error("no project id")),
      ),
    ).resolves.toBeUndefined();
  });
});

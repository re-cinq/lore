import { describe, it, expect, vi } from "vitest";
import { shutdownGracefully } from "./http-server.js";

describe("shutdownGracefully", () => {
  it("stops the server, then flushes telemetry", async () => {
    const order: string[] = [];

    await shutdownGracefully(
      { stop: async () => void order.push("stop") },
      async () => void order.push("flush"),
    );

    expect(order).toEqual(["stop", "flush"]);
  });

  it("flushes telemetry even when stopping the server fails", async () => {
    const flush = vi.fn(async () => {});

    await shutdownGracefully(
      { stop: async () => Promise.reject(new Error("port stuck")) },
      flush,
    );

    expect(flush).toHaveBeenCalledOnce();
  });

  it("does not reject when the telemetry flush fails", async () => {
    await expect(
      shutdownGracefully({ stop: async () => {} }, async () =>
        Promise.reject(new Error("no project id")),
      ),
    ).resolves.toBeUndefined();
  });
});

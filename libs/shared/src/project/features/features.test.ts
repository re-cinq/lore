import { describe, it, expect } from "vitest";
import { Features } from "./features.js";
import type { FeaturesPort, Feature } from "./features-port.js";

function recordingPort(): { port: FeaturesPort; calls: any[] } {
  const calls: any[] = [];
  const stub = (op: string) =>
    (...args: unknown[]) => {
      calls.push({ op, args });
      return Promise.resolve({} as Feature);
    };
  const port = {
    create: stub("create"),
    get: stub("get"),
    list: stub("list"),
    appendIteration: stub("appendIteration"),
    setIterationResult: stub("setIterationResult"),
    transitionStatus: stub("transitionStatus"),
    createSplitChild: stub("createSplitChild"),
  } as unknown as FeaturesPort;
  return { port, calls };
}

describe("Features facade", () => {
  it("stamps the bound repo as the first argument on create", async () => {
    const { port, calls } = recordingPort();
    await new Features("octo/repo", port).create({ title: "T", prompt: "P" });
    expect(calls[0]).toEqual({
      op: "create",
      args: ["octo/repo", { title: "T", prompt: "P" }],
    });
  });

  it("stamps the bound repo on list with a status filter", async () => {
    const { port, calls } = recordingPort();
    await new Features("octo/repo", port).list("draft");
    expect(calls[0]).toEqual({ op: "list", args: ["octo/repo", "draft"] });
  });

  it("stamps the bound repo on appendIteration", async () => {
    const { port, calls } = recordingPort();
    await new Features("octo/repo", port).appendIteration("f1", "t1", { a: 1 });
    expect(calls[0]).toEqual({
      op: "appendIteration",
      args: ["octo/repo", "f1", "t1", { a: 1 }],
    });
  });
});

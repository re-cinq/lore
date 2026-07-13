import { describe, it, expect } from "vitest";
import { Features } from "./features.js";
import type { FeaturesPort, Feature } from "./features-port.js";

interface RecordedCall {
  op: string;
  args: unknown[];
}

function recordingPort(): { port: FeaturesPort; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const stub =
    (op: string) =>
    (...args: unknown[]) => {
      calls.push({ op, args });
      return Promise.resolve({} as Feature);
    };
  const port = {
    create: stub("create"),
    get: stub("get"),
    list: stub("list"),
    appendIteration: stub("appendIteration"),
    attachIterationTask: stub("attachIterationTask"),
    setIterationResult: stub("setIterationResult"),
    transitionStatus: stub("transitionStatus"),
    createSplitChild: stub("createSplitChild"),
    delete: stub("delete"),
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
    await new Features("octo/repo", port).appendIteration("f1", { a: 1 });
    expect(calls[0]).toEqual({
      op: "appendIteration",
      args: ["octo/repo", "f1", { a: 1 }],
    });
  });

  it("stamps the bound repo on attachIterationTask", async () => {
    const { port, calls } = recordingPort();
    await new Features("octo/repo", port).attachIterationTask("f1", 2, "t1");
    expect(calls[0]).toEqual({
      op: "attachIterationTask",
      args: ["octo/repo", "f1", 2, "t1"],
    });
  });

  it("stamps the bound repo on delete", async () => {
    const { port, calls } = recordingPort();
    await new Features("octo/repo", port).delete("f1");
    expect(calls[0]).toEqual({ op: "delete", args: ["octo/repo", "f1"] });
  });
});

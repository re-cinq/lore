import { describe, it, expect, vi } from "vitest";
import {
  createProductionRetrospectiveHandler,
  createProductionHandlers,
} from "./handlers.js";
import type { WorkflowNode } from "./loader.js";
import type { NodeContext } from "./assembly-line-executor.js";

const node: WorkflowNode = {
  id: "retrospective",
  type: "retrospective",
};

const ctx: NodeContext = {
  taskId: "task-1",
  branchName: "lore/feature/x",
  gitDir: "/tmp/foo",
  iteration: 1,
  workflowName: "general",
};

describe("createProductionRetrospectiveHandler", () => {
  it("writes an episode with the task summary", async () => {
    const writeEpisode = vi.fn(async () => "ep-1");
    const writeEpisodeWithCuration = vi.fn(async () => undefined);
    const handler = createProductionRetrospectiveHandler({
      writeEpisode,
      writeEpisodeWithCuration,
      curate: false,
    });

    const r = await handler(node, ctx);
    expect(r.outcome).toBe("success");
    expect(writeEpisode).toHaveBeenCalledTimes(1);
    expect(writeEpisode).toHaveBeenCalledWith(
      expect.stringContaining("task-1"),
      "retrospective",
      "dark-factory/task-1",
      "supervisor",
    );
    expect(writeEpisodeWithCuration).not.toHaveBeenCalled();
  });

  it("calls curation when curate is true (default)", async () => {
    const writeEpisode = vi.fn(async () => "ep-1");
    const writeEpisodeWithCuration = vi.fn(async () => undefined);
    const handler = createProductionRetrospectiveHandler({
      writeEpisode,
      writeEpisodeWithCuration,
    });

    await handler(node, ctx);
    expect(writeEpisodeWithCuration).toHaveBeenCalledTimes(1);
    expect(writeEpisode).not.toHaveBeenCalled();
  });

  it("includes workflow name + branch + iteration in the summary", async () => {
    const captured: string[] = [];
    const handler = createProductionRetrospectiveHandler({
      writeEpisode: async (content) => {
        captured.push(content);
        return "ep";
      },
      writeEpisodeWithCuration: async () => undefined,
      curate: false,
    });
    await handler(node, ctx);
    expect(captured[0]).toContain("general");
    expect(captured[0]).toContain("lore/feature/x");
    expect(captured[0]).toContain("iteration 1");
  });
});

describe("createProductionHandlers", () => {
  it("supplies safe defaults for validate, gate, retrospective", async () => {
    const handlers = createProductionHandlers({
      agent: async () => ({ outcome: "success" }),
      episodeDeps: {
        writeEpisode: vi.fn(async () => "ep"),
        writeEpisodeWithCuration: vi.fn(async () => undefined),
        curate: false,
      },
    });
    expect((await handlers.validate(node, ctx)).outcome).toBe("success");
    expect((await handlers.gate(node, ctx)).outcome).toBe("success");
    expect((await handlers.retrospective(node, ctx)).outcome).toBe("success");
  });

  it("respects per-handler overrides", async () => {
    const customValidate = vi.fn(async () => ({ outcome: "failed" as const }));
    const handlers = createProductionHandlers({
      agent: async () => ({ outcome: "success" }),
      validate: customValidate,
      episodeDeps: {
        writeEpisode: vi.fn(async () => "ep"),
        writeEpisodeWithCuration: vi.fn(async () => undefined),
        curate: false,
      },
    });
    const r = await handlers.validate(node, ctx);
    expect(r.outcome).toBe("failed");
    expect(customValidate).toHaveBeenCalled();
  });
});

import { describe, it, expect, vi } from "vitest";
import { createClaudeCodeAgentHandler } from "./claude-code-handler.js";
import type { AssemblyLineNode } from "./loader.js";
import type { NodeContext } from "./assembly-line-executor.js";
import type { ClaudeCodeResult } from "./claude-code.js";

const node: AssemblyLineNode = {
  id: "implement",
  type: "agent",
  prompt_ref: "implementation",
  model: "claude-sonnet-4-6",
};

const ctx: NodeContext = {
  taskId: "t-1",
  assemblyLineId: "al-test-1",
  branchName: "lore/feature/x",
  gitDir: "/workspace/repo",
  iteration: 1,
  assemblyLineName: "implementation",
};

function ccResult(overrides: Partial<ClaudeCodeResult> = {}): ClaudeCodeResult {
  return { output: "ok", exitCode: 0, durationMs: 100, ...overrides };
}

describe("createClaudeCodeAgentHandler", () => {
  it("returns success on exit 0 with duration trailer", async () => {
    const runner = vi.fn(async () => ccResult());
    const handler = createClaudeCodeAgentHandler(
      {
        runClaudeCode: runner,
        resolvePrompt: () => "resolved prompt",
      },
      { taskId: "t-1", description: "do thing", taskType: "implementation" },
    );

    const r = await handler(node, ctx);

    expect(r.outcome).toBe("success");
    expect(r.extras?.["Lore-CLI-Duration-Ms"]).toBe("100");
    expect(runner).toHaveBeenCalledWith({
      prompt: "resolved prompt",
      workDir: "/workspace/repo",
      model: "claude-sonnet-4-6",
      taskId: "t-1",
    });
  });

  it("returns failed on non-zero exit with cli-nonzero status", async () => {
    const runner = vi.fn(async () =>
      ccResult({ exitCode: 2, output: "syntax error: foo" }),
    );
    const handler = createClaudeCodeAgentHandler(
      { runClaudeCode: runner, resolvePrompt: () => "p" },
      { taskId: "t", description: "d", taskType: "implementation" },
    );
    const r = await handler(node, ctx);

    expect(r.outcome).toBe("failed");
    expect(r.extras?.["Lore-Validation-Status"]).toBe("cli-nonzero");
    expect(r.extras?.["Lore-Validation-Summary"]).toContain("exited 2");
  });

  it("returns failed when runClaudeCode throws (timeout, missing CLI)", async () => {
    const runner = vi.fn(async () => {
      throw new Error("Claude Code timed out after 900s");
    });
    const handler = createClaudeCodeAgentHandler(
      { runClaudeCode: runner, resolvePrompt: () => "p" },
      { taskId: "t", description: "d", taskType: "implementation" },
    );
    const r = await handler(node, ctx);

    expect(r.outcome).toBe("failed");
    expect(r.extras?.["Lore-Validation-Status"]).toBe("cli-error");
    expect(r.extras?.["Lore-Validation-Summary"]).toContain("timed out");
  });

  it("returns failed config-error when prompt_ref missing", async () => {
    const runner = vi.fn(async () => ccResult());
    const handler = createClaudeCodeAgentHandler(
      { runClaudeCode: runner, resolvePrompt: () => "p" },
      { taskId: "t", description: "d", taskType: "implementation" },
    );
    const r = await handler(
      { id: "implement", type: "agent" } as AssemblyLineNode,
      ctx,
    );

    expect(r.outcome).toBe("failed");
    expect(r.extras?.["Lore-Validation-Status"]).toBe("config-error");
    expect(runner).not.toHaveBeenCalled();
  });

  it("returns failed config-error when resolvePrompt returns null", async () => {
    const runner = vi.fn(async () => ccResult());
    const handler = createClaudeCodeAgentHandler(
      { runClaudeCode: runner, resolvePrompt: () => null },
      { taskId: "t", description: "d", taskType: "implementation" },
    );
    const r = await handler(node, ctx);

    expect(r.outcome).toBe("failed");
    expect(r.extras?.["Lore-Validation-Status"]).toBe("config-error");
  });
});

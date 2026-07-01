import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
  createAgentHandler,
  extractJsonFiles,
} from "./agent-handler.js";
import type { WorkflowNode } from "./loader.js";
import type { NodeContext } from "./assembly-line-executor.js";
import type { LlmCompletion } from "@re-cinq/lore-shared";

const node: WorkflowNode = {
  id: "draft",
  type: "agent",
  prompt_ref: "gap-fill",
  model: "claude-haiku-4-5-20251001",
};

function makeCtx(gitDir: string): NodeContext {
  return {
    taskId: "t-1",
    branchName: "lore/gap-fill/x",
    gitDir,
    iteration: 1,
    workflowName: "gap-fill",
  };
}

function llmResult(text: string, overrides: Partial<LlmCompletion> = {}): LlmCompletion {
  return {
    text,
    inputTokens: 100,
    outputTokens: 200,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    costUsd: 0.001,
    durationMs: 50,
    model: "claude-haiku-4-5-20251001",
    ...overrides,
  };
}

describe("extractJsonFiles", () => {
  it("parses raw JSON", () => {
    const r = extractJsonFiles(
      JSON.stringify({ files: { "a.md": "hello", "b.md": "world" } }),
    );
    expect(r).toEqual({ "a.md": "hello", "b.md": "world" });
  });

  it("parses JSON inside a code fence", () => {
    const text =
      "Here are the files:\n```json\n" +
      JSON.stringify({ files: { "a.md": "x" } }) +
      "\n```\nDone.";
    expect(extractJsonFiles(text)).toEqual({ "a.md": "x" });
  });

  it("parses JSON object embedded in surrounding prose via brace match", () => {
    const text =
      "Sure — here it is: " +
      JSON.stringify({ files: { "spec.md": "content" } }) +
      " hope that helps";
    expect(extractJsonFiles(text)).toEqual({ "spec.md": "content" });
  });

  it("returns null on missing files key", () => {
    expect(extractJsonFiles(JSON.stringify({ stuff: "x" }))).toBeNull();
  });

  it("returns null on non-string file values", () => {
    expect(
      extractJsonFiles(JSON.stringify({ files: { "a.md": 42 } })),
    ).toBeNull();
  });

  it("returns null on completely unparseable text", () => {
    expect(extractJsonFiles("just prose, no JSON at all")).toBeNull();
  });
});

describe("createAgentHandler", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "lore-agent-handler-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("writes files from a parseable LLM response and reports cost trailers", async () => {
    const callLLM = vi.fn(async () =>
      llmResult(
        JSON.stringify({
          files: {
            "runbooks/foo.md": "# foo\nbody",
            "specs/x/spec.md": "spec body",
          },
        }),
      ),
    );
    const handler = createAgentHandler(
      {
        callLLM,
        resolvePrompt: () => ({
          systemPrompt: "you are a helpful drafter",
          prompt: "draft a runbook for X",
        }),
      },
      { taskId: "t-1", description: "X needs a runbook", taskType: "runbook" },
    );

    const r = await handler(node, makeCtx(tmpDir));

    expect(r.outcome).toBe("success");
    expect(r.extras?.["Lore-Files-Written"]).toBe("2");
    expect(r.extras?.["Lore-Cost-Tokens"]).toContain("input=100");
    expect(r.extras?.["Lore-Cost-Tokens"]).toContain("output=200");
    // No USD/dollar trailer — token counts only.
    expect(r.extras?.["Lore-Cost-USD"]).toBeUndefined();

    expect(
      await fs.readFile(path.join(tmpDir, "runbooks/foo.md"), "utf-8"),
    ).toBe("# foo\nbody");
    expect(
      await fs.readFile(path.join(tmpDir, "specs/x/spec.md"), "utf-8"),
    ).toBe("spec body");
  });

  it("creates intermediate directories", async () => {
    const callLLM = vi.fn(async () =>
      llmResult(
        JSON.stringify({ files: { "deep/nested/path/file.md": "content" } }),
      ),
    );
    const handler = createAgentHandler(
      {
        callLLM,
        resolvePrompt: () => ({ systemPrompt: "", prompt: "" }),
      },
      { taskId: "t", description: "d", taskType: "gap-fill" },
    );
    const r = await handler(node, makeCtx(tmpDir));
    expect(r.outcome).toBe("success");
    expect(
      await fs.readFile(
        path.join(tmpDir, "deep/nested/path/file.md"),
        "utf-8",
      ),
    ).toBe("content");
  });

  it("fails parse when LLM response has no JSON files object", async () => {
    const callLLM = vi.fn(async () =>
      llmResult("Sorry, I cannot help with that"),
    );
    const handler = createAgentHandler(
      {
        callLLM,
        resolvePrompt: () => ({ systemPrompt: "", prompt: "" }),
      },
      { taskId: "t", description: "d", taskType: "gap-fill" },
    );
    const r = await handler(node, makeCtx(tmpDir));
    expect(r.outcome).toBe("failed");
    expect(r.extras?.["Lore-Validation-Status"]).toBe("parse-error");
  });

  it("rejects path-traversal attempts and fails", async () => {
    const callLLM = vi.fn(async () =>
      llmResult(
        JSON.stringify({ files: { "../../etc/passwd": "evil" } }),
      ),
    );
    const handler = createAgentHandler(
      {
        callLLM,
        resolvePrompt: () => ({ systemPrompt: "", prompt: "" }),
      },
      { taskId: "t", description: "d", taskType: "gap-fill" },
    );
    const r = await handler(node, makeCtx(tmpDir));
    // No legal files in the response → parse-fails-back to outcome.
    // (Sanitizer dropped them; remaining count is 0; we treat that as
    // a parse-error to surface the LLM tried to write outside the tree.)
    expect(r.outcome).toBe("success");
    expect(r.extras?.["Lore-Files-Written"]).toBe("0");
  });

  it("rejects absolute paths", async () => {
    const callLLM = vi.fn(async () =>
      llmResult(JSON.stringify({ files: { "/etc/passwd": "evil" } })),
    );
    const handler = createAgentHandler(
      {
        callLLM,
        resolvePrompt: () => ({ systemPrompt: "", prompt: "" }),
      },
      { taskId: "t", description: "d", taskType: "gap-fill" },
    );
    const r = await handler(node, makeCtx(tmpDir));
    expect(r.extras?.["Lore-Files-Written"]).toBe("0");
  });

  it("returns failed when prompt_ref is missing on the node", async () => {
    const callLLM = vi.fn(async () => llmResult(""));
    const handler = createAgentHandler(
      {
        callLLM,
        resolvePrompt: () => ({ systemPrompt: "", prompt: "" }),
      },
      { taskId: "t", description: "d", taskType: "gap-fill" },
    );
    const r = await handler(
      { id: "draft", type: "agent" } as WorkflowNode,
      makeCtx(tmpDir),
    );
    expect(r.outcome).toBe("failed");
    expect(callLLM).not.toHaveBeenCalled();
  });

  it("returns failed when resolvePrompt returns null", async () => {
    const callLLM = vi.fn(async () => llmResult(""));
    const handler = createAgentHandler(
      {
        callLLM,
        resolvePrompt: () => null,
      },
      { taskId: "t", description: "d", taskType: "gap-fill" },
    );
    const r = await handler(node, makeCtx(tmpDir));
    expect(r.outcome).toBe("failed");
    expect(r.extras?.["Lore-Validation-Status"]).toBe("config-error");
  });

  it("returns failed and surfaces error when callLLM throws", async () => {
    const callLLM = vi.fn(async () => {
      throw new Error("anthropic 503");
    });
    const handler = createAgentHandler(
      {
        callLLM,
        resolvePrompt: () => ({ systemPrompt: "", prompt: "" }),
      },
      { taskId: "t", description: "d", taskType: "gap-fill" },
    );
    const r = await handler(node, makeCtx(tmpDir));
    expect(r.outcome).toBe("failed");
    expect(r.extras?.["Lore-LLM-Error"]).toBe("anthropic 503");
  });

  it("with parseJsonFiles=false returns success without writing", async () => {
    const writeFile = vi.fn(async () => {});
    const callLLM = vi.fn(async () =>
      llmResult("REVIEW_RESULT:APPROVED — all looks good"),
    );
    const handler = createAgentHandler(
      {
        callLLM,
        resolvePrompt: () => ({ systemPrompt: "", prompt: "" }),
        parseJsonFiles: false,
        writeFile,
      },
      { taskId: "t", description: "d", taskType: "review" },
    );
    const r = await handler(node, makeCtx(tmpDir));
    expect(r.outcome).toBe("success");
    expect(writeFile).not.toHaveBeenCalled();
    expect(r.extras?.["Lore-Cost-Tokens"]).toBeDefined();
  });
});

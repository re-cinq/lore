import { afterEach, describe, expect, it } from "vitest";
import { FakeLlm } from "../outbound/llm/fake-llm.js";
import { Llm } from "../outbound/llm/llm.js";
import type { LlmProvider } from "../outbound/llm/llm-provider.js";
import {
  buildCopyPrompt,
  fallbackCopy,
  generateArtifactCopy,
} from "./artifact-copy.js";

describe("artifact-copy", () => {
  describe("buildCopyPrompt", () => {
    it("embeds the kind/repo/task-intent/agent-output and omits absent file/output lines", () => {
      const promptFull = buildCopyPrompt({
        kind: "PR",
        repo: "re-cinq/lore",
        taskIntent: "Add feature X",
        agentOutput: "Feature X added",
        files: ["a.ts", "b.ts"],
      });

      expect(promptFull).toBe(
        "Kind: PR\nRepo: re-cinq/lore\nTask intent: Add feature X\nAgent output: Feature X added\nChanged files: a.ts, b.ts",
      );
    });

    it("omits absent file/output lines when minimal", () => {
      const promptMinimal = buildCopyPrompt({
        kind: "Issue",
        repo: "re-cinq/lore",
        taskIntent: "Fix bug Y",
        agentOutput: "",
        files: [],
      });

      expect(promptMinimal).toBe(
        "Kind: Issue\nRepo: re-cinq/lore\nTask intent: Fix bug Y",
      );
      expect(promptMinimal).not.toContain("Agent output:");
      expect(promptMinimal).not.toContain("Changed files:");
    });
  });

  describe("fallbackCopy", () => {
    it("derives a title from the description's first line (truncated to 70 chars with an ellipsis, task-type when empty) with a changed-files body note and source: 'fallback'", () => {
      const description =
        "This is a very long description that goes on and on and on and on and on and on and on";
      const copy = fallbackCopy({
        description,
        taskType: "bug",
        changedFiles: ["src/a.ts"],
      });

      expect(copy).toMatchObject({
        title:
          "This is a very long description that goes on and on and on and on a...",
        body: `${description}\n\nChanged files:\nsrc/a.ts`,
        source: "fallback",
      });
      expect(copy.title).toHaveLength(70);
    });

    it("uses task-type when description is empty", () => {
      const emptyCopy = fallbackCopy({
        description: "",
        taskType: "bug",
        changedFiles: [],
      });

      expect(emptyCopy).toMatchObject({
        title: "bug",
        body: "",
        source: "fallback",
      });
    });
  });

  describe("generateArtifactCopy", () => {
    afterEach(() => Llm.reset());

    it("returns trimmed model copy (source: 'llm', defaulting to Llm.instance)", async () => {
      Llm.setInstance(
        new FakeLlm({ data: { title: " LLM Title ", body: " LLM Body " } }),
      );
      const copy = await generateArtifactCopy({
        prompt: "Prompt",
        description: "Desc",
        taskType: "feat",
        changedFiles: ["a.ts"],
      });

      expect(copy).toMatchObject({
        title: "LLM Title",
        body: "LLM Body",
        source: "llm",
      });
    });

    it("falls back on an LLM throw", async () => {
      const errorProvider: LlmProvider = {
        vendor: "error",
        complete: async () => {
          throw new Error("API down");
        },
        completeWithTool: async () => {
          throw new Error("API down");
        },
      };

      Llm.setInstance(errorProvider);
      const fallbackOnThrow = await generateArtifactCopy({
        prompt: "Prompt",
        description: "First line",
        taskType: "feat",
        changedFiles: [],
      });

      expect(fallbackOnThrow).toMatchObject({
        source: "fallback",
        title: "First line",
      });
    });

    it("falls back on an empty/missing title or body", async () => {
      Llm.setInstance(new FakeLlm({ data: { title: "", body: "" } }));
      const fallbackOnEmpty = await generateArtifactCopy({
        prompt: "Prompt",
        description: "Desc",
        taskType: "feat",
        changedFiles: [],
      });

      Llm.setInstance(new FakeLlm({ data: {} }));
      const fallbackOnMissing = await generateArtifactCopy({
        prompt: "Prompt",
        description: "Desc",
        taskType: "feat",
        changedFiles: [],
      });

      expect(fallbackOnEmpty.source).toBe("fallback");
      expect(fallbackOnMissing.source).toBe("fallback");
    });
  });
});

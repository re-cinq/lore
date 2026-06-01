import { describe, it, expect, vi } from "vitest";
import {
  buildCopyPrompt,
  fallbackCopy,
  generateArtifactCopy,
  type ArtifactCopyInput,
} from "./artifact-copy.js";
import { callLLMWithTool } from "../anthropic.js";

vi.mock("../anthropic.js", () => ({
  callLLMWithTool: vi.fn(),
}));

const input: ArtifactCopyInput = {
  kind: "pr",
  taskType: "gap-fill",
  description: "Spec drift: specs/6-dark-factory/research.md (100% divergence)",
  agentOutput: "Updated research.md to match the shipped dark-factory settings resolver.",
  changedFiles: 2,
  repo: "re-cinq/lore",
};

describe("buildCopyPrompt", () => {
  it("includes the kind, repo, task intent and agent output", () => {
    const prompt = buildCopyPrompt(input);
    expect(prompt).toContain("pull request");
    expect(prompt).toContain("re-cinq/lore");
    expect(prompt).toContain("Spec drift: specs/6-dark-factory/research.md");
    expect(prompt).toContain("Updated research.md to match");
  });

  it("describes an issue when kind is issue", () => {
    expect(buildCopyPrompt({ ...input, kind: "issue" })).toContain("issue");
  });

  it("omits the files and output lines when neither is provided", () => {
    const prompt = buildCopyPrompt({ ...input, changedFiles: 0, agentOutput: undefined });
    expect(prompt).not.toContain("Files changed");
    expect(prompt).not.toContain("What the agent reported");
  });
});

describe("fallbackCopy", () => {
  it("uses the first line of the description as the title", () => {
    expect(fallbackCopy(input).title).toBe(
      "Spec drift: specs/6-dark-factory/research.md (100% divergence)",
    );
  });

  it("truncates a long first line to 70 chars with an ellipsis", () => {
    const long = "x".repeat(100);
    const copy = fallbackCopy({ ...input, description: long });
    expect(copy.title).toBe("x".repeat(69) + "…");
  });

  it("appends a changed-files note to the body", () => {
    expect(fallbackCopy(input).body).toContain("Changed files: 2");
  });

  it("falls back to the task type when the description is empty", () => {
    expect(fallbackCopy({ ...input, description: "" }).title).toBe("gap-fill");
  });

  it("marks the source as fallback", () => {
    expect(fallbackCopy(input).source).toBe("fallback");
  });

  it("omits the changed-files note when there are no changed files", () => {
    expect(fallbackCopy({ ...input, changedFiles: 0 }).body).not.toContain("Changed files");
  });
});

describe("generateArtifactCopy", () => {
  it("returns model-written copy when the LLM succeeds", async () => {
    const llm = vi.fn().mockResolvedValue({
      data: { title: "Reconcile dark-factory research doc with the settings resolver", body: "## What changed\n..." },
    });
    const copy = await generateArtifactCopy(input, llm);
    expect(copy).toMatchObject({
      title: "Reconcile dark-factory research doc with the settings resolver",
      source: "llm",
    });
    expect(llm).toHaveBeenCalledOnce();
  });

  it("trims whitespace from the model title", async () => {
    const llm = vi.fn().mockResolvedValue({ data: { title: "  Tidy title  ", body: "b" } });
    expect((await generateArtifactCopy(input, llm)).title).toBe("Tidy title");
  });

  it("falls back when the LLM throws", async () => {
    const llm = vi.fn().mockRejectedValue(new Error("rate limited"));
    const copy = await generateArtifactCopy(input, llm);
    expect(copy.source).toBe("fallback");
    expect(copy.title).toBe(input.description);
  });

  it("falls back when the model returns an empty title", async () => {
    const llm = vi.fn().mockResolvedValue({ data: { title: "   ", body: "b" } });
    expect((await generateArtifactCopy(input, llm)).source).toBe("fallback");
  });

  it("falls back when the model omits the title entirely", async () => {
    const llm = vi.fn().mockResolvedValue({ data: { body: "b" } });
    expect((await generateArtifactCopy(input, llm)).source).toBe("fallback");
  });

  it("falls back when the model returns an empty body", async () => {
    const llm = vi.fn().mockResolvedValue({ data: { title: "Good title", body: "" } });
    expect((await generateArtifactCopy(input, llm)).source).toBe("fallback");
  });

  it("uses callLLMWithTool by default when no llm is injected", async () => {
    vi.mocked(callLLMWithTool).mockResolvedValue({
      data: { title: "Default-path title", body: "Body" },
    } as Awaited<ReturnType<typeof callLLMWithTool>>);
    const copy = await generateArtifactCopy(input);
    expect(copy).toMatchObject({ title: "Default-path title", source: "llm" });
    expect(callLLMWithTool).toHaveBeenCalledOnce();
  });
});

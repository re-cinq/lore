import { describe, it, expect } from "vitest";
import { parseAgentDefaultFile } from "./agent-default-file.js";

describe("parseAgentDefaultFile", () => {
  it("reads review.md's frontmatter as the org-default row and its body as the prompt", () => {
    const text = [
      "---",
      "model: claude-sonnet-4-6",
      "timeout_minutes: 30",
      "review_required: false",
      "repo_workdir: false",
      "test_policy: none",
      "disallowed_tools:",
      "  - Bash(npm ci:*)",
      "---",
      "Review the pull request.",
      "",
      "Task: {description}",
      "",
    ].join("\n");

    expect(parseAgentDefaultFile("review", text)).toEqual({
      name: "review",
      model: "claude-sonnet-4-6",
      timeout_minutes: 30,
      prompt: "Review the pull request.\n\nTask: {description}\n",
      image: null,
      execution_mode: "claude-code",
      review_required: false,
      project_id: null,
      config: {
        repo_workdir: false,
        test_policy: "none",
        disallowed_tools: ["Bash(npm ci:*)"],
      },
    });
  });

  it("reads def-validate.md with an empty body as a station row with a null prompt", () => {
    const text = [
      "---",
      "execution_mode: station",
      "timeout_minutes: 15",
      "command: [lore-station, validate]",
      "---",
      "",
    ].join("\n");

    expect(parseAgentDefaultFile("def-validate", text)).toEqual({
      name: "def-validate",
      model: null,
      timeout_minutes: 15,
      prompt: null,
      image: null,
      execution_mode: "station",
      review_required: false,
      project_id: null,
      config: { command: ["lore-station", "validate"] },
    });
  });

  it("refuses general.md with a misspelled prompt_template key instead of dropping it", () => {
    const text = ["---", "prompt_tempalte: hi", "---", "Do it.", ""].join("\n");

    expect(() => parseAgentDefaultFile("general", text)).toThrow(
      /general\.md.*prompt_tempalte/,
    );
  });

  it("refuses general.md with no frontmatter", () => {
    expect(() => parseAgentDefaultFile("general", "Do it.\n")).toThrow(
      new Error("general.md: missing the --- frontmatter block"),
    );
  });
});

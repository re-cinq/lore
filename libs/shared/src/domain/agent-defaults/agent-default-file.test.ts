import { describe, it, expect } from "vitest";
import {
  floorSettingsOf,
  parseAgentDefaultFile,
  readAgentDefaultFile,
} from "./agent-default-file.js";

const REVIEW = [
  "---",
  "review_required: false",
  "model: gemini-4-argon",
  "image: ${LORE_AGENT_IMAGE}",
  "timeout_minutes: 25",
  "prices:",
  "  gemini-4-argon:",
  "    input_per_million: 2",
  "    output_per_million: 10",
  "config:",
  "  max_turns: 150",
  "  skills_source: ${LORE_SKILLS_URL}",
  "  env:",
  "    LORE_TEST_POLICY: none",
  "---",
  "Review the pull request.",
  "",
  "Task: {description}",
  "",
].join("\n");

describe("parseAgentDefaultFile", () => {
  it("reads review.md's frontmatter as the org-default row and its body as the prompt", () => {
    expect(parseAgentDefaultFile("review", REVIEW)).toEqual({
      name: "review",
      model: "gemini-4-argon",
      timeout_minutes: 25,
      prompt: "Review the pull request.\n\nTask: {description}\n",
      image: "${LORE_AGENT_IMAGE}",
      execution_mode: "claude-code",
      review_required: false,
      project_id: null,
      config: {
        max_turns: 150,
        skills_source: "${LORE_SKILLS_URL}",
        env: { LORE_TEST_POLICY: "none" },
      },
    });
  });

  it("reads def-validate.md with an empty body as a station row with a null prompt", () => {
    const text = [
      "---",
      "execution_mode: station",
      "timeout_minutes: 15",
      "config:",
      "  command: [lore-station, validate]",
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

describe("floorSettingsOf", () => {
  it("builds review's floor settings from model, image, timeout, prices and config in the file's order, prompt last, review_required left out", () => {
    const settings = floorSettingsOf(readAgentDefaultFile("review", REVIEW));

    expect(JSON.stringify(settings)).toEqual(
      JSON.stringify({
        model: "gemini-4-argon",
        image: "${LORE_AGENT_IMAGE}",
        timeout_minutes: 25,
        prices: {
          "gemini-4-argon": { input_per_million: 2, output_per_million: 10 },
        },
        config: {
          max_turns: 150,
          skills_source: "${LORE_SKILLS_URL}",
          env: { LORE_TEST_POLICY: "none" },
        },
        prompt: "Review the pull request.\n\nTask: {description}\n",
      }),
    );
  });
});

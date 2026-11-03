import { describe, expect, it } from "vitest";
import {
  COMPOSE_SYSTEM,
  LORE_READ_TOOLS,
  composePrompt,
} from "./builder-prompts.js";

const TASK = {
  query: "Drop POST /api/embed",
  repo: "re-cinq/lore",
  maxTokens: 8000,
};

describe("composePrompt", () => {
  it("names lore_search_context, lore_search_memory, lore-query-trace and lore_get_ci_failures as the only tools to point at", () => {
    const prompt = composePrompt(TASK, [], "{}");

    expect(LORE_READ_TOOLS.map((tool) => tool.split(" ")[0])).toEqual([
      "lore_search_context",
      "lore_search_memory",
      "lore-query-trace",
      "lore_get_ci_failures",
    ]);
    expect(LORE_READ_TOOLS.every((tool) => prompt.includes(tool))).toBe(true);
  });

  it("asks for the closing Unanswered line and quotes of at most 40 words", () => {
    const prompt = composePrompt(TASK, [], "{}");

    expect(prompt).toContain('"Unanswered: ..."');
    expect(prompt).toContain("quote its sentence (at most 40 words)");
  });

  it("asks for earlier outputs as examples when the task writes a digest, changelog or document", () => {
    expect(composePrompt(TASK, [], "{}")).toContain(
      "add one or two earlier outputs of that kind",
    );
  });

  it("keeps the block under 900 words at 8000 or 2000 tokens and under 700 words at 1000 tokens", () => {
    expect(composePrompt(TASK, [], "{}")).toContain("under 900 words");
    expect(composePrompt({ ...TASK, maxTokens: 2000 }, [], "{}")).toContain(
      "under 900 words",
    );
    expect(composePrompt({ ...TASK, maxTokens: 1000 }, [], "{}")).toContain(
      "under 700 words",
    );
  });
});

describe("COMPOSE_SYSTEM", () => {
  it("forbids a relationship the evidence does not state and evidence about unrelated repositories", () => {
    expect(COMPOSE_SYSTEM).toContain(
      "Never state a relationship the evidence does not state",
    );
    expect(COMPOSE_SYSTEM).toContain("mark it (inferred)");
    expect(COMPOSE_SYSTEM).toContain(
      "neither the task's nor one it depends on is left out",
    );
  });
});

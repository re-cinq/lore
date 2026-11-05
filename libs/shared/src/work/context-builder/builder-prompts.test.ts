import { describe, expect, it } from "vitest";
import {
  COMPOSE_SYSTEM,
  composePrompt,
  pickPrompt,
  writesSomething,
} from "./builder-prompts.js";

const TASK = {
  query: "Drop POST /api/embed",
  repo: "re-cinq/lore",
  maxTokens: 8000,
};

describe("composePrompt", () => {
  it("asks for key facts, where to look and previous work, with the primer last and no Unanswered line", () => {
    const prompt = composePrompt(TASK, [], "{}");
    const headings = [...prompt.matchAll(/^## ([A-Za-z ]+)/gm)].map((match) =>
      match[1].trim(),
    );

    expect(headings).toEqual([
      "Key facts",
      "Where to look",
      "Previous work",
      "Repo primer",
    ]);
    expect(prompt).not.toContain("Unanswered");
    expect(prompt).toContain("quote its sentence (at most 40 words)");
  });

  it("asks for paths with why they matter and no instructions on how to open them", () => {
    const prompt = composePrompt(TASK, [], "{}");

    expect(prompt).toContain("No instructions on how to open it");
    expect(prompt).not.toContain("lore_search_context");
  });

  it("asks for earlier outputs as examples for a task writing a digest, and not for one dropping a route", () => {
    expect(
      composePrompt({ ...TASK, query: "Write the weekly digest" }, [], "{}"),
    ).toContain("add one or two earlier outputs of that kind");
    expect(composePrompt(TASK, [], "{}")).not.toContain("earlier outputs");
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

describe("writesSomething", () => {
  it("is true for a changelog, release notes or runbook task and false for a route change", () => {
    expect(
      ["Update the CHANGELOG", "Draft release notes", "Write the runbook"].map(
        writesSomething,
      ),
    ).toEqual([true, true, true]);
    expect(writesSomething("Drop POST /api/embed")).toBe(false);
  });
});

describe("pickPrompt", () => {
  it("lists the task and the candidate paths and asks for up to 6", () => {
    const prompt = pickPrompt(TASK, ["a.ts", "b.md"]);

    expect(prompt).toContain("Task: Drop POST /api/embed");
    expect(prompt).toContain("a.ts\nb.md");
    expect(prompt).toContain("up to 6 paths");
  });
});

describe("COMPOSE_SYSTEM", () => {
  it("forbids a relationship the evidence does not state, evidence about unrelated repositories, and restating the task", () => {
    const rules = [
      "Never state a relationship the evidence does not state",
      "mark it (inferred)",
      "neither the task's nor one it depends on is left out",
      "never restate the task",
    ];

    expect(rules.filter((rule) => COMPOSE_SYSTEM.includes(rule))).toEqual(
      rules,
    );
  });
});

import { describe, it, expect } from "vitest";
import { composePlanningPrompt } from "./planning-prompt.js";
import type { GapResult } from "./gap-result.js";

const gap: GapResult = {
  sections: [
    { title: "Overview", content: "A planning Station." },
    {
      title: "Data model",
      content: "Persist features + iterations.",
      mockups: [{ title: "schema", format: "svg", markup: "<svg/>" }],
      questions: [{ id: "q1", question: "Which repos?", why: "scope", kind: "text" }],
    },
  ],
  draft_spec_markdown: "# Spec",
};

describe("composePlanningPrompt", () => {
  it("wraps title and user prompt and omits the draft spec on round one", () => {
    const out = composePlanningPrompt({
      title: "Dark mode",
      originalPrompt: "Add a toggle",
      priorGap: null,
      answers: null,
    });
    expect(out).toContain("<Title>\nDark mode\n</Title>");
    expect(out).toContain("<UserPrompt>\nAdd a toggle\n</UserPrompt>");
    expect(out).not.toContain("<CurrentDraftSpec>");
  });

  it("renders each prior section with its generated content and the author's comment", () => {
    const out = composePlanningPrompt({
      title: "T",
      originalPrompt: "P",
      priorGap: gap,
      answers: {
        sections: { "Data model": { direction: "refine", comment: "add a join table" } },
        questions: { q1: "all repos" },
        free_form: "ship it",
      },
    });
    expect(out).toContain("<CurrentDraftSpec>");
    expect(out).toContain('<Section title="Overview">');
    expect(out).toContain("A planning Station.");
    expect(out).toContain('<Section title="Data model">');
    expect(out).toContain("Diagrams: schema");
    expect(out).toContain('<UserComment direction="refine">\nadd a join table\n</UserComment>');
    expect(out).toContain("<OtherUserComments>\nship it\n</OtherUserComments>");
  });

  it("renders a section's question with its asked text and the author's answer", () => {
    const out = composePlanningPrompt({
      title: "T",
      originalPrompt: "P",
      priorGap: gap,
      answers: { sections: {}, questions: { q1: "all repos" }, free_form: "" },
    });
    expect(out).toContain("<Asked>Which repos?</Asked>");
    expect(out).toContain("<Answer>all repos</Answer>");
  });

  it("marks an unanswered question", () => {
    const out = composePlanningPrompt({
      title: "T",
      originalPrompt: "P",
      priorGap: gap,
      answers: { sections: {}, questions: {}, free_form: "" },
    });
    expect(out).toContain("<Answer>(unanswered)</Answer>");
  });
});

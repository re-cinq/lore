import { describe, it, expect } from "vitest";
import { composePlanningPrompt } from "./planning-prompt.js";
import type { GapResult } from "./gap-result.js";

const gap: GapResult = {
  architecture: {
    summary: "A planning Station.",
    components: [
      { name: "features port", responsibility: "persist lifecycle", touchpoints: ["lore.features"] },
    ],
  },
  user_flows: [{ name: "create draft", steps: ["open tab", "submit"] }],
  mockups: [{ title: "List view", format: "svg", markup: "<svg/>" }],
  questions: [{ id: "q1", question: "Which repos?", why: "scope", kind: "text" }],
  draft_spec_markdown: "# Spec",
};

describe("composePlanningPrompt", () => {
  it("wraps title and user prompt in tags and omits the draft spec on round one", () => {
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

  it("pairs each generated section with the author's comment and direction", () => {
    const out = composePlanningPrompt({
      title: "T",
      originalPrompt: "P",
      priorGap: gap,
      answers: {
        sections: { architecture: { direction: "refine", comment: "use CSS vars" } },
        questions: { q1: "all repos" },
        free_form: "ship it",
      },
    });
    expect(out).toContain("<CurrentDraftSpec>");
    expect(out).toContain("A planning Station.");
    expect(out).toContain("- features port: persist lifecycle (touchpoints: lore.features)");
    expect(out).toContain('<UserComment direction="refine">\nuse CSS vars\n</UserComment>');
  });

  it("resolves answered questions to their asked text", () => {
    const out = composePlanningPrompt({
      title: "T",
      originalPrompt: "P",
      priorGap: gap,
      answers: { sections: {}, questions: { q1: "all repos" }, free_form: "" },
    });
    expect(out).toContain("<Asked>Which repos?</Asked>");
    expect(out).toContain("<Answer>all repos</Answer>");
  });

  it("marks unanswered questions and surfaces free-form as OtherUserComments", () => {
    const out = composePlanningPrompt({
      title: "T",
      originalPrompt: "P",
      priorGap: gap,
      answers: { sections: {}, questions: {}, free_form: "extra note" },
    });
    expect(out).toContain("<Answer>(unanswered)</Answer>");
    expect(out).toContain("<OtherUserComments>\nextra note\n</OtherUserComments>");
  });
});

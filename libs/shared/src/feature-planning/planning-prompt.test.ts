import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { parse } from "yaml";
import { composePlanningPrompt } from "./planning-prompt.js";
import { parseGapResult, type GapResult } from "./gap-result.js";

/** The prompt the pod actually runs. Read from the file the catalog is generated
 *  from, not from a constant, because a constant is exactly what used to drift
 *  out of the delivered recipe without anything noticing. */
function planningPromptTemplate(): string {
  const yamlPath = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../../../scripts/task-types.yaml",
  );
  const doc = parse(readFileSync(yamlPath, "utf-8")) as {
    task_types: Record<string, { prompt_template: string }>;
  };

  return doc.task_types["feature-planning"].prompt_template;
}

/** The worked example the prompt embeds, as JSON. It is the last `{...}` block
 *  before the round content, so it is bounded by the heading that follows it. */
function embeddedExample(template: string): unknown {
  const after = template.split("Example of a valid result.json:")[1];
  const json = after.split("## This round")[0].trim();

  return JSON.parse(json);
}

const gap: GapResult = {
  sections: [
    { title: "Overview", content: "A planning Station." },
    {
      title: "Data model",
      content: "Persist features + iterations.",
      mockups: [{ title: "schema", format: "svg", markup: "<svg/>" }],
      questions: [
        { id: "q1", question: "Which repos?", why: "scope", kind: "text" },
      ],
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
        sections: {
          "Data model": { direction: "refine", comment: "add a join table" },
        },
        questions: { q1: "all repos" },
        free_form: "ship it",
      },
    });

    expect(out).toContain("<CurrentDraftSpec>");
    expect(out).toContain('<Section title="Overview">');
    expect(out).toContain("A planning Station.");
    expect(out).toContain('<Section title="Data model">');
    expect(out).toContain("Diagrams: schema");
    expect(out).toContain(
      '<UserComment direction="refine">\nadd a join table\n</UserComment>',
    );
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

describe("the feature-planning prompt template", () => {
  it("embeds an example that parses cleanly against the GapResult schema", () => {
    // The guard PLANNING_EXAMPLE used to give, moved to the text that ships: an
    // example demonstrating a shape the parser rejects teaches the agent to fail.
    const example = embeddedExample(planningPromptTemplate());

    expect(parseGapResult(example)).toEqual(example);
  });

  it("opens its example with an Overview section that asks nothing", () => {
    const example = parseGapResult(embeddedExample(planningPromptTemplate()));

    expect(example.sections[0]).toMatchObject({ title: "Overview" });
    expect(example.sections[0].questions).toBeUndefined();
  });

  it("demonstrates every mockup format it offers", () => {
    const example = parseGapResult(embeddedExample(planningPromptTemplate()));
    const formats = example.sections.flatMap((s) =>
      (s.mockups ?? []).map((m) => m.format),
    );

    expect(new Set(formats)).toEqual(new Set(["mermaid", "html"]));
  });

  it("carries the round content and context placeholders the runner fills", () => {
    const template = planningPromptTemplate();

    expect(template).toContain("{description}");
    expect(template).toContain("{context}");
  });

  it("states the contract the agent is measured on", () => {
    const template = planningPromptTemplate();

    for (const clause of [
      "GAP-CLOSING",
      "MUST be titled",
      "## Integration",
      "task sizing",
      "user-story",
      "jq empty result.json",
      "mockup_stylesheet",
      "NOT LIKE THE TOOL SHOWING THEM",
    ]) {
      expect(template).toContain(clause);
    }
  });
});

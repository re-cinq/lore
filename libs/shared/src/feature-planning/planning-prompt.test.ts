import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { parse } from "yaml";
import {
  composePlanningPrompt,
  composeRoundFeedback,
} from "./planning-prompt.js";
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

  it("embeds a self-contained example stylesheet, defining every token it uses", () => {
    // The mockup frame loads none of the repo's stylesheets, so a token that is only
    // REFERENCED is undefined there — the declaration is invalid and the mockup
    // renders as unstyled black text on a blank page. An example demonstrating that
    // pattern teaches the agent to produce it, which is exactly what happened.
    const example = parseGapResult(embeddedExample(planningPromptTemplate()));
    const css = example.mockup_stylesheet ?? "";
    const used = new Set(
      [...css.matchAll(/var\((--[\w-]+)\)/g)].map((m) => m[1]),
    );
    const defined = new Set(
      [...css.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]),
    );

    expect(used.size).toBeGreaterThan(0);
    expect([...used].filter((token) => !defined.has(token))).toEqual([]);
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

describe("composeRoundFeedback", () => {
  const answers = {
    sections: {
      "Data model": {
        comment: "drop the join table",
        direction: "refine" as const,
      },
      Overview: { direction: "keep" as const },
    },
    questions: { q1: "just this repo" },
    free_form: "ship the API first",
  };

  it("nests each answered question under the section that asked it", () => {
    // The agent holds the draft in its conversation, not in the prompt — so the
    // feedback has to say WHICH section each comment lands on by itself.
    const out = composeRoundFeedback({ round: 4, priorGap: gap, answers });

    expect(out).toContain('<Section title="Data model" direction="refine">');
    expect(
      out.split('<Section title="Data model"')[1].split("</Section>")[0],
    ).toContain('<Question id="q1">');
  });

  it("quotes the question text beside the answer", () => {
    // Not just the id: a compacted conversation may no longer hold what q1 asked.
    const out = composeRoundFeedback({ round: 4, priorGap: gap, answers });

    expect(out).toContain("<Asked>Which repos?</Asked>");
    expect(out).toContain("<Answer>just this repo</Answer>");
  });

  it("carries the round number and the free-form note", () => {
    const out = composeRoundFeedback({ round: 4, priorGap: gap, answers });

    expect(out).toContain('<RoundFeedback round="4">');
    expect(out).toContain(
      "<OtherUserComments>\nship the API first\n</OtherUserComments>",
    );
  });

  it("keeps a section the author only marked keep, with no comment", () => {
    const out = composeRoundFeedback({ round: 2, priorGap: gap, answers });

    expect(out).toContain('<Section title="Overview" direction="keep"/>');
  });

  it("restates none of the draft the agent already holds", () => {
    const out = composeRoundFeedback({ round: 4, priorGap: gap, answers });

    expect(out).not.toContain("Persist features + iterations.");
    expect(out).not.toContain("<Generated>");
  });

  it("omits a section the author left entirely alone", () => {
    const out = composeRoundFeedback({
      round: 2,
      priorGap: gap,
      answers: { sections: {}, questions: {}, free_form: "" },
    });

    expect(out).toBe('<RoundFeedback round="2">\n</RoundFeedback>');
  });

  it("marks a question the author skipped", () => {
    const out = composeRoundFeedback({
      round: 2,
      priorGap: gap,
      answers: {
        sections: { "Data model": { direction: "refine" as const } },
        questions: {},
        free_form: "",
      },
    });

    expect(out).toContain("<Answer>(unanswered)</Answer>");
  });
});

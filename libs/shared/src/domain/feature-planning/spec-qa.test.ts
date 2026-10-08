import { describe, expect, it } from "vitest";
import {
  SPEC_QA_ROUNDS,
  failureBrief,
  qaGate,
  specQaBagSchema,
  type SpecQaBag,
} from "./spec-qa.js";

const PASSING_BAG: SpecQaBag = {
  questions: [
    {
      id: "q1",
      section: "scope",
      kind: "plan",
      question: "Is billing out of scope?",
      answer: true,
      reason: "Out of scope lists billing.",
    },
    {
      id: "q2",
      section: "constraints",
      kind: "technical",
      question: "Which table stores the plan versions?",
      answer: true,
      reason: "FR-4 names lore.plan_versions.",
    },
  ],
  notes: [
    {
      id: "n1",
      kind: "comment",
      text: "Keep it behind a flag.",
      satisfied: true,
      reason: "FR-9 gates the feature.",
    },
  ],
};

function withQuestion(patch: Partial<SpecQaBag["questions"][number]>) {
  return {
    ...PASSING_BAG,
    questions: [{ ...PASSING_BAG.questions[0]!, ...patch }],
  };
}

describe("specQaBagSchema", () => {
  it("accepts a bag with answered questions and satisfied notes", () => {
    expect(specQaBagSchema.parse(PASSING_BAG)).toEqual(PASSING_BAG);
  });

  it("accepts a question that has no answer yet", () => {
    const unanswered = withQuestion({ answer: undefined, reason: undefined });

    expect(specQaBagSchema.parse(unanswered)).toEqual(unanswered);
  });

  it("rejects an answer that is not a boolean", () => {
    expect(() =>
      specQaBagSchema.parse(withQuestion({ answer: "yes" as never })),
    ).toThrow();
  });
});

describe("qaGate", () => {
  it("returns success with no failures when every answer and note is true", () => {
    expect(qaGate(PASSING_BAG, 0)).toEqual({
      outcome: "success",
      failures: [],
      exhausted: false,
    });
  });

  it("returns changes_requested listing the question answered false", () => {
    const bag = withQuestion({ answer: false, reason: "Spec is silent." });

    expect(qaGate(bag, 0)).toEqual({
      outcome: "changes_requested",
      failures: [
        {
          id: "q1",
          text: "Is billing out of scope?",
          reason: "Spec is silent.",
        },
      ],
      exhausted: false,
    });
  });

  it("returns changes_requested when a question has no answer", () => {
    const bag = withQuestion({ answer: undefined, reason: undefined });

    expect(qaGate(bag, 0).failures).toEqual([
      { id: "q1", text: "Is billing out of scope?", reason: "Not answered." },
    ]);
  });

  it("returns changes_requested when a plan note is not satisfied", () => {
    const bag = {
      ...PASSING_BAG,
      notes: [
        {
          ...PASSING_BAG.notes[0]!,
          satisfied: false,
          reason: "Not in the spec.",
        },
      ],
    };

    expect(qaGate(bag, 0)).toMatchObject({
      outcome: "changes_requested",
      failures: [
        {
          id: "n1",
          text: "Keep it behind a flag.",
          reason: "Not in the spec.",
        },
      ],
    });
  });

  it("returns success with the failures and exhausted once the rounds are spent", () => {
    const bag = withQuestion({ answer: false, reason: "Spec is silent." });

    expect(qaGate(bag, SPEC_QA_ROUNDS)).toMatchObject({
      outcome: "success",
      exhausted: true,
      failures: [{ id: "q1" }],
    });
  });

  it("spends five rounds before giving up", () => {
    expect(SPEC_QA_ROUNDS).toBe(5);
  });
});

describe("failureBrief", () => {
  it("returns an empty string when nothing failed", () => {
    expect(failureBrief([])).toBe("");
  });

  it("lists each failure with its reason for the integrating writer", () => {
    expect(
      failureBrief([
        {
          id: "q1",
          text: "Is billing out of scope?",
          reason: "Spec is silent.",
        },
      ]),
    ).toBe(
      "These checks failed against the spec. Fix the spec so each one holds:\n- q1: Is billing out of scope? (Spec is silent.)\n",
    );
  });
});

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
      severity: "blocking",
      source: "b3",
      question: "Billing is out of scope.",
      expected: true,
    },
    {
      id: "q2",
      section: "constraints",
      kind: "technical",
      severity: "blocking",
      source: "b5",
      question: "Plan versions are stored in lore.plan_versions.",
      expected: true,
    },
    {
      id: "q3",
      section: "scope",
      kind: "note",
      severity: "blocking",
      source: "c1",
      question: "The feature is behind a flag.",
      expected: true,
    },
  ],
  answers: [
    { id: "q1", answer: true, reason: "Out of scope lists billing." },
    { id: "q2", answer: true, reason: "FR-4 names lore.plan_versions." },
    { id: "q3", answer: true, reason: "FR-9 gates the feature." },
  ],
};

function withAnswer(id: string, patch: { answer?: boolean; reason?: string }) {
  return {
    ...PASSING_BAG,
    answers: PASSING_BAG.answers.map((answer) =>
      answer.id === id ? { ...answer, ...patch } : answer,
    ),
  };
}

describe("specQaBagSchema", () => {
  it("accepts frozen questions with an expected value and one answer each", () => {
    expect(specQaBagSchema.parse(PASSING_BAG)).toEqual(PASSING_BAG);
  });

  it("accepts questions that have no answer yet", () => {
    const unanswered = { ...PASSING_BAG, answers: [] };

    expect(specQaBagSchema.parse(unanswered)).toEqual(unanswered);
  });

  it("rejects an answer that is not a boolean", () => {
    expect(() =>
      specQaBagSchema.parse(withAnswer("q1", { answer: "yes" as never })),
    ).toThrow();
  });

  it("rejects a question without an expected boolean", () => {
    const [first, ...rest] = PASSING_BAG.questions;
    const { expected: _expected, ...withoutExpected } = first!;

    expect(() =>
      specQaBagSchema.parse({
        ...PASSING_BAG,
        questions: [withoutExpected, ...rest],
      }),
    ).toThrow();
  });
});

describe("qaGate", () => {
  it("returns success with no failures when every answer matches its expected value", () => {
    expect(qaGate(PASSING_BAG, 0)).toEqual({
      outcome: "success",
      failures: [],
      exhausted: false,
    });
  });

  it("returns changes_requested listing the question answered against its expected value", () => {
    const bag = withAnswer("q1", { answer: false, reason: "Spec is silent." });

    expect(qaGate(bag, 0)).toEqual({
      outcome: "changes_requested",
      failures: [
        {
          id: "q1",
          section: "scope",
          text: "Billing is out of scope.",
          reason: "Spec is silent.",
        },
      ],
      exhausted: false,
    });
  });

  it("returns success when a must-not question is answered false as expected", () => {
    const bag = {
      questions: [{ ...PASSING_BAG.questions[0]!, expected: false }],
      answers: [
        { id: "q1", answer: false, reason: "Billing is not mentioned." },
      ],
    };

    expect(qaGate(bag, 0).outcome).toBe("success");
  });

  it("returns changes_requested when a question has no answer", () => {
    const bag = {
      ...PASSING_BAG,
      answers: PASSING_BAG.answers.filter((answer) => answer.id !== "q1"),
    };

    expect(qaGate(bag, 0).failures).toEqual([
      {
        id: "q1",
        section: "scope",
        text: "Billing is out of scope.",
        reason: "Not answered.",
      },
    ]);
  });

  it("returns changes_requested when a plan note question is answered false", () => {
    const bag = withAnswer("q3", { answer: false, reason: "Not in the spec." });

    expect(qaGate(bag, 0)).toMatchObject({
      outcome: "changes_requested",
      failures: [
        {
          id: "q3",
          section: "scope",
          text: "The feature is behind a flag.",
          reason: "Not in the spec.",
        },
      ],
    });
  });

  it("returns success with the failures and exhausted once the rounds are spent", () => {
    const bag = withAnswer("q1", { answer: false, reason: "Spec is silent." });

    expect(qaGate(bag, SPEC_QA_ROUNDS)).toMatchObject({
      outcome: "success",
      exhausted: true,
      failures: [{ id: "q1" }],
    });
  });

  it("returns changes_requested with no listed failure when only the spec's own checks found gaps", () => {
    expect(qaGate(PASSING_BAG, 0, 2)).toEqual({
      outcome: "changes_requested",
      failures: [],
      exhausted: false,
    });
  });

  it("returns success and exhausted when the spec's own gaps outlast the rounds", () => {
    expect(qaGate(PASSING_BAG, SPEC_QA_ROUNDS, 2)).toEqual({
      outcome: "success",
      failures: [],
      exhausted: true,
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
          section: "scope",
          text: "Billing is out of scope.",
          reason: "Spec is silent.",
        },
      ]),
    ).toBe(
      "These checks failed against the spec. Fix the spec so each one holds:\n- q1: Billing is out of scope. (Spec is silent.)\n",
    );
  });
});

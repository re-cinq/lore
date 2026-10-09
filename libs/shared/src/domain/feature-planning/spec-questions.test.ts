import { describe, expect, it } from "vitest";
import type { CitablePlan } from "./plan-coverage.js";
import type { SpecQuestion } from "./spec-qa.js";
import { questionErrors, questionErrorsBrief } from "./spec-questions.js";

const PLAN: CitablePlan = {
  plan_url: "https://lore.example/plans/p1",
  blocks: [
    {
      id: "b1",
      slot: "scope",
      kind: "paragraph",
      text: "Billing is out.",
      link: "https://lore.example/plans/p1#b1",
    },
    {
      id: "b2",
      slot: "questions",
      kind: "question",
      text: "Which currencies first?",
      link: "https://lore.example/plans/p1#b2",
    },
  ],
};

const question = (patch: Partial<SpecQuestion>): SpecQuestion => ({
  id: "q1",
  section: "scope",
  kind: "plan",
  severity: "blocking",
  source: "b1",
  question: "Billing is out of scope.",
  expected: true,
  ...patch,
});

const NOTE_FOR_QUESTION = question({
  id: "q2",
  section: "questions",
  kind: "note",
  source: "b2",
  question: "Which currencies launch first is still open.",
});

describe("questionErrors", () => {
  it("returns no error when every source is a plan block and every open question has a note", () => {
    expect(questionErrors([question({}), NOTE_FOR_QUESTION], PLAN)).toEqual([]);
  });

  it("names a question whose source is not a block of the plan", () => {
    expect(
      questionErrors([question({ source: "b9" }), NOTE_FOR_QUESTION], PLAN),
    ).toEqual(["q1 cites plan block b9, which the plan does not have."]);
  });

  it("names an open plan question that has no note question", () => {
    expect(questionErrors([question({})], PLAN)).toEqual([
      "Plan block b2 (an open question) has no question of kind note.",
    ]);
  });

  it("names a question id used twice", () => {
    expect(
      questionErrors(
        [question({}), question({ source: "b1" }), NOTE_FOR_QUESTION],
        PLAN,
      ),
    ).toEqual(["q1 is used for more than one question."]);
  });

  it("checks only duplicates and emptiness when the run carries no plan blocks", () => {
    expect(
      questionErrors([question({ source: "b9" }), question({})], null),
    ).toEqual(["q1 is used for more than one question."]);
  });

  it("names a plan with questions for no block at all", () => {
    expect(questionErrors([], PLAN)).toEqual([
      "Plan block b2 (an open question) has no question of kind note.",
      "The set has no question.",
    ]);
  });
});

describe("questionErrorsBrief", () => {
  it("returns an empty string when nothing is wrong", () => {
    expect(questionErrorsBrief([])).toBe("");
  });

  it("lists each error for the agent that wrote the set", () => {
    expect(
      questionErrorsBrief(["q1 is used for more than one question."]),
    ).toBe(
      "The question set you wrote has these problems. Write the whole set again with each fixed:\n- q1 is used for more than one question.\n",
    );
  });
});

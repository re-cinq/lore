import { describe, expect, it } from "vitest";
import {
  SPEC_QA_ROUNDS,
  advisoryBrief,
  evidenceHolds,
  failureBrief,
  qaGate,
  redoRequest,
  withRecheck,
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
    expect(qaGate(PASSING_BAG, { roundsSpent: 0 })).toEqual({
      outcome: "success",
      failures: [],
      advisory: [],
      exhausted: false,
      stalled: false,
    });
  });

  it("returns changes_requested listing the question answered against its expected value", () => {
    const bag = withAnswer("q1", { answer: false, reason: "Spec is silent." });

    expect(qaGate(bag, { roundsSpent: 0 })).toEqual({
      outcome: "changes_requested",
      failures: [
        {
          id: "q1",
          section: "scope",
          text: "Billing is out of scope.",
          reason: "Spec is silent.",
        },
      ],
      advisory: [],
      exhausted: false,
      stalled: false,
    });
  });

  it("returns success when a must-not question is answered false as expected", () => {
    const bag = {
      questions: [{ ...PASSING_BAG.questions[0]!, expected: false }],
      answers: [
        { id: "q1", answer: false, reason: "Billing is not mentioned." },
      ],
    };

    expect(qaGate(bag, { roundsSpent: 0 }).outcome).toBe("success");
  });

  it("returns changes_requested when a question has no answer", () => {
    const bag = {
      ...PASSING_BAG,
      answers: PASSING_BAG.answers.filter((answer) => answer.id !== "q1"),
    };

    expect(qaGate(bag, { roundsSpent: 0 }).failures).toEqual([
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

    expect(qaGate(bag, { roundsSpent: 0 })).toMatchObject({
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

  it("returns stalled with the failures and exhausted once the rounds are spent", () => {
    const bag = withAnswer("q1", { answer: false, reason: "Spec is silent." });

    expect(qaGate(bag, { roundsSpent: SPEC_QA_ROUNDS })).toMatchObject({
      outcome: "stalled",
      exhausted: true,
      failures: [{ id: "q1" }],
    });
  });

  it("returns changes_requested with no listed failure when only the spec's own checks found gaps", () => {
    expect(qaGate(PASSING_BAG, { roundsSpent: 0, branchGaps: 2 })).toEqual({
      outcome: "changes_requested",
      failures: [],
      advisory: [],
      exhausted: false,
      stalled: false,
    });
  });

  it("returns stalled and exhausted when the spec's own gaps outlast the rounds", () => {
    expect(
      qaGate(PASSING_BAG, { roundsSpent: SPEC_QA_ROUNDS, branchGaps: 2 }),
    ).toEqual({
      outcome: "stalled",
      failures: [],
      advisory: [],
      exhausted: true,
      stalled: false,
    });
  });

  it("spends five rounds before giving up", () => {
    expect(SPEC_QA_ROUNDS).toBe(5);
  });
});

const SPEC = "## Scope\n\n- Billing is out of scope.\n- Refunds are in.\n";

describe("evidenceHolds", () => {
  it("returns true when the quote appears verbatim in a spec", () => {
    expect(evidenceHolds("Billing is out of scope.", [SPEC])).toBe(true);
  });

  it("returns true when the quote differs from the spec only in whitespace", () => {
    expect(evidenceHolds("Billing  is out\nof scope.", [SPEC])).toBe(true);
  });

  it("returns false when no spec holds the quote", () => {
    expect(evidenceHolds("Billing is in scope.", [SPEC])).toBe(false);
  });

  it("returns false for a missing or blank quote", () => {
    expect([
      evidenceHolds(undefined, [SPEC]),
      evidenceHolds("  ", [SPEC]),
    ]).toEqual([false, false]);
  });
});

describe("qaGate with the spec text", () => {
  const quoted = {
    ...PASSING_BAG,
    answers: PASSING_BAG.answers.map((answer) => ({
      ...answer,
      evidence: "Billing is out of scope.",
    })),
  };

  it("returns success when every upholding answer quotes the spec", () => {
    expect(qaGate(quoted, { roundsSpent: 0, specTexts: [SPEC] }).outcome).toBe(
      "success",
    );
  });

  it("fails an upholding answer whose quote is not in the spec, naming that", () => {
    const bag = withAnswer("q2", { answer: true, reason: "Stated." });

    expect(qaGate(bag, { roundsSpent: 0, specTexts: [SPEC] }).failures).toEqual(
      [
        {
          id: "q1",
          section: "scope",
          text: "Billing is out of scope.",
          reason: "No quote from the spec supports this answer.",
        },
        {
          id: "q2",
          section: "constraints",
          text: "Plan versions are stored in lore.plan_versions.",
          reason: "No quote from the spec supports this answer.",
        },
        {
          id: "q3",
          section: "scope",
          text: "The feature is behind a flag.",
          reason: "No quote from the spec supports this answer.",
        },
      ],
    );
  });

  it("asks for no quote from a must-not question answered false", () => {
    const bag = {
      questions: [{ ...PASSING_BAG.questions[0]!, expected: false }],
      answers: [
        { id: "q1", answer: false, reason: "Billing is not mentioned." },
      ],
    };

    expect(qaGate(bag, { roundsSpent: 0, specTexts: [SPEC] }).outcome).toBe(
      "success",
    );
  });
});

describe("qaGate severity, stalling and recheck", () => {
  const advisoryBag = {
    ...PASSING_BAG,
    questions: PASSING_BAG.questions.map((question) =>
      question.id === "q1"
        ? { ...question, severity: "advisory" as const }
        : question,
    ),
    answers: PASSING_BAG.answers.map((answer) =>
      answer.id === "q1"
        ? { ...answer, answer: false, reason: "Silent." }
        : answer,
    ),
  };

  it("passes with an advisory failure listed apart, because only blocking failures send the writer back", () => {
    expect(qaGate(advisoryBag, { roundsSpent: 0 })).toMatchObject({
      outcome: "success",
      failures: [],
      advisory: [{ id: "q1", reason: "Silent." }],
    });
  });

  it("returns stalled when the gaps did not fall since the last round, and lists them", () => {
    const bag = withAnswer("q1", { answer: false, reason: "Silent." });

    expect(qaGate(bag, { roundsSpent: 1, previousGaps: 1 })).toMatchObject({
      outcome: "stalled",
      stalled: true,
      failures: [{ id: "q1" }],
    });
  });

  it("keeps asking while the gaps fall", () => {
    const bag = withAnswer("q1", { answer: false, reason: "Silent." });

    expect(qaGate(bag, { roundsSpent: 1, previousGaps: 2 })).toMatchObject({
      outcome: "changes_requested",
      stalled: false,
    });
  });
});

describe("withRecheck", () => {
  const failing = withAnswer("q1", { answer: false, reason: "Silent." });

  it("lets a failure stand when the second pod answers it the same way", () => {
    const bag = withRecheck(failing, [
      { id: "q1", answer: false, reason: "Still silent." },
    ]);

    expect(qaGate(bag, { roundsSpent: 0 }).failures).toMatchObject([
      { id: "q1", reason: "Still silent." },
    ]);
  });

  it("drops a failure the second pod could confirm in the spec", () => {
    const bag = withRecheck(failing, [
      {
        id: "q1",
        answer: true,
        reason: "Stated.",
        evidence: "Billing is out of scope.",
      },
    ]);

    expect(qaGate(bag, { roundsSpent: 0 }).outcome).toBe("success");
  });

  it("keeps the first answers for questions the second pod was not asked", () => {
    const bag = withRecheck(failing, []);

    expect(bag.answers).toEqual(failing.answers);
  });
});

describe("advisoryBrief", () => {
  it("returns an empty string when nothing advisory failed", () => {
    expect(advisoryBrief([])).toBe("");
  });

  it("lists each advisory failure for the reviewer of the pull request", () => {
    expect(
      advisoryBrief([
        {
          id: "q4",
          section: "risk",
          text: "Rates may lag.",
          reason: "Silent.",
        },
      ]),
    ).toBe(
      "These checks failed against the spec but did not hold up the pull request:\n- q4 [risk]: Rates may lag. (Silent.)\n",
    );
  });
});

describe("redoRequest", () => {
  const failure = (id: string, section: string) => ({
    id,
    section,
    text: "x",
    reason: "y",
  });

  it("names each failing section once, in the order the failures came", () => {
    expect(
      redoRequest(
        [failure("q1", "risk"), failure("q2", "scope"), failure("q3", "risk")],
        0,
        2,
      ),
    ).toEqual({ round: 2, sections: ["risk", "scope"] });
  });

  it("adds the repair visit when the spec's own checks found gaps", () => {
    expect(redoRequest([failure("q1", "scope")], 3, 1)).toEqual({
      round: 1,
      sections: ["scope", "*"],
    });
  });

  it("sends a failure in a section the line does not integrate to the repair visit", () => {
    expect(redoRequest([failure("q1", "intent")], 0, 1)).toEqual({
      round: 1,
      sections: ["*"],
    });
  });

  it("asks for nothing when nothing failed", () => {
    expect(redoRequest([], 0, 1)).toEqual({ round: 1, sections: [] });
  });
});

describe("failureBrief", () => {
  it("returns an empty string when nothing failed", () => {
    expect(failureBrief([])).toBe("");
  });

  it("tags a failure in a section the line does not integrate with the repair visit's mark", () => {
    expect(
      failureBrief([
        {
          id: "q9",
          section: "intent",
          text: "Pay in euros.",
          reason: "Silent.",
        },
      ]),
    ).toContain("- q9 [*]: Pay in euros.");
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
      "These checks failed against the spec. Fix the spec so each one holds:\n- q1 [scope]: Billing is out of scope. (Spec is silent.)\n",
    );
  });
});

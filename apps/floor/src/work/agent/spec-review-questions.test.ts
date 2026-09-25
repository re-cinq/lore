import { describe, it, expect } from "vitest";
import { homeQuestions, questionsOwed } from "./spec-review-questions.js";

describe("homeQuestions", () => {
  it("keeps every slot as written when the plan's sections could not be read", () => {
    const questions = [
      { slot: "custom-tool", question: "Past five?", why: "" },
    ];

    expect(homeQuestions(questions, [])).toEqual([
      { question: questions[0], rehomed: false },
    ]);
  });

  it("lands a slot naming no section on the last section when the plan has no Open questions section", () => {
    const sections = [
      { slot: "intent", title: "Intent" },
      { slot: "custom-section_1", title: "Delivery card" },
    ];

    expect(
      homeQuestions(
        [
          { slot: "delivery-card", question: "Which label?", why: "" },
          { slot: "nowhere", question: "Where?", why: "" },
        ],
        sections,
      ).map(({ question, rehomed }) => [question.slot, rehomed]),
    ).toEqual([
      ["custom-section_1", true],
      ["custom-section_1", true],
    ]);
  });
});

describe("questionsOwed", () => {
  it("owes nothing for an addressed reply or a to_plan reply whose comment 7 already has a question", () => {
    expect(
      questionsOwed(
        {
          plan_questions: [
            { slot: "scope", question: "Q?", why: "", comment_id: 7 },
          ],
          replies: [
            { comment_id: 7, action: "to_plan", note: "" },
            { comment_id: 8, action: "addressed", note: "" },
          ],
        },
        [],
      ),
    ).toEqual([]);
  });

  it("makes a question naming comment 9 alone when the PR's comments do not carry it", () => {
    expect(
      questionsOwed(
        {
          plan_questions: [],
          replies: [{ comment_id: 9, action: "to_plan", note: "" }],
        },
        [],
      ),
    ).toEqual([
      {
        slot: "questions",
        question: "Review comment 9 asks for a decision the plan has not made",
        why: "",
        comment_id: 9,
      },
    ]);
  });
});

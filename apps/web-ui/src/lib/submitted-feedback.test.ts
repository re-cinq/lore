import { describe, it, expect } from "vitest";
import { submittedFeedback } from "./submitted-feedback";

describe("submittedFeedback", () => {
  it("recovers what the author typed for each section", () => {
    // The wizard clears the form on submit, so after a failed round this is the only
    // way back to the words — they are on the iteration row, but nothing rendered them.
    expect(
      submittedFeedback({
        sections: {
          "Data queries": {
            comment: "can we get the page over http with a query?",
            direction: "refine",
          },
        },
        questions: {},
        free_form: "",
      }),
    ).toEqual([
      {
        heading: "Data queries",
        direction: "refine",
        body: "can we get the page over http with a query?",
      },
    ]);
  });

  it("keeps a section the author only gave a direction to", () => {
    expect(
      submittedFeedback({
        sections: { Overview: { direction: "keep" } },
        questions: {},
        free_form: "",
      }),
    ).toEqual([{ heading: "Overview", direction: "keep", body: "" }]);
  });

  it("recovers the answered questions", () => {
    expect(
      submittedFeedback({
        sections: {},
        questions: { q1: "just this repo" },
        free_form: "",
      }),
    ).toEqual([{ heading: "q1", direction: null, body: "just this repo" }]);
  });

  it("recovers the free-form note last", () => {
    const lines = submittedFeedback({
      sections: { Overview: { direction: "keep" } },
      questions: {},
      free_form: "ship the API first",
    });

    expect(lines.at(-1)).toEqual({
      heading: "Other comments",
      direction: null,
      body: "ship the API first",
    });
  });

  it("returns nothing for a round the author submitted no input for", () => {
    // Round one has no feedback — there was nothing to react to yet.
    expect(submittedFeedback(null)).toEqual([]);
    expect(
      submittedFeedback({ sections: {}, questions: {}, free_form: "" }),
    ).toEqual([]);
  });

  it("drops a section whose comment is only whitespace", () => {
    expect(
      submittedFeedback({
        sections: { Overview: { comment: "   " } },
        questions: {},
        free_form: "  ",
      }),
    ).toEqual([]);
  });
});

import { describe, it, expect } from "vitest";
import { newPlanInput, paragraphsOf, storyIssueOf } from "./plan-input";

const form = (fields: Record<string, string>) => {
  const formData = new FormData();

  Object.entries(fields).forEach(([key, value]) => formData.set(key, value));

  return formData;
};

describe("newPlanInput", () => {
  it("reads a performance plan titled Faster checkout with its description and no user story", () => {
    expect(
      newPlanInput(
        form({
          title: " Faster checkout ",
          type: "performance",
          description: "p95 is 450 ms",
        }),
      ),
    ).toEqual({
      title: "Faster checkout",
      type: "performance",
      description: "p95 is 450 ms",
    });
  });

  it("reads user story 42 from the issue URL re-cinq/lore/issues/42", () => {
    expect(
      newPlanInput(
        form({
          title: "Faster checkout",
          type: "feature",
          story: " https://github.com/re-cinq/lore/issues/42 ",
        }),
      ),
    ).toMatchObject({ storyIssue: 42 });
  });

  it("asks for an issue URL or number when the user story is not-an-issue", () => {
    expect(
      newPlanInput(
        form({ title: "Faster checkout", type: "feature", story: "nope" }),
      ),
    ).toEqual({
      error: "The user story must be a GitHub issue URL or its number.",
    });
  });

  it("asks for a title when the title is blank", () => {
    expect(
      newPlanInput(form({ title: "  ", type: "feature", description: "" })),
    ).toEqual({
      error: "A plan needs a title.",
    });
  });

  it("refuses a plan type the templates do not have", () => {
    expect(
      newPlanInput(
        form({ title: "Faster checkout", type: "saga", description: "" }),
      ),
    ).toEqual({
      error: "Unknown plan type saga.",
    });
  });
});

describe("paragraphsOf", () => {
  it("splits a description into its blank-line separated paragraphs", () => {
    expect(
      paragraphsOf("Checkout is slow.\n\n  Mobile users drop off.\n"),
    ).toEqual(["Checkout is slow.", "Mobile users drop off."]);
  });
});

describe("storyIssueOf", () => {
  it("reads 42 from the bare number 42, #42 and the issue URL re-cinq/lore/issues/42/", () => {
    expect(
      ["42", "#42", "https://github.com/re-cinq/lore/issues/42/"].map(
        storyIssueOf,
      ),
    ).toEqual([42, 42, 42]);
  });

  it("reads nothing from a blank story, 0, a pull request URL or a word", () => {
    expect(
      ["", "0", "https://github.com/re-cinq/lore/pull/42", "story"].map(
        storyIssueOf,
      ),
    ).toEqual([null, null, null, null]);
  });
});

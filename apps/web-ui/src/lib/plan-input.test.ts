import { describe, it, expect } from "vitest";
import { newPlanInput, storyIssueOf } from "./plan-input";

const STORY_REFUSED =
  "The user story must be a GitHub issue URL or its number.";

const REPO = "re-cinq/lore";

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
        REPO,
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
        REPO,
      ),
    ).toMatchObject({ storyIssue: 42 });
  });

  it("asks for an issue URL or number when the user story is not-an-issue", () => {
    expect(
      newPlanInput(
        form({ title: "Faster checkout", type: "feature", story: "nope" }),
        REPO,
      ),
    ).toEqual({ error: STORY_REFUSED });
  });

  it("asks for a title when the title is blank", () => {
    expect(
      newPlanInput(
        form({ title: "  ", type: "feature", description: "" }),
        REPO,
      ),
    ).toEqual({
      error: "A plan needs a title.",
    });
  });

  it("refuses a plan type the templates do not have", () => {
    expect(
      newPlanInput(
        form({ title: "Faster checkout", type: "saga", description: "" }),
        REPO,
      ),
    ).toEqual({
      error: "Unknown plan type saga.",
    });
  });
});

describe("storyIssueOf", () => {
  it("reads 42 from the bare number 42, #42 and the issue URL re-cinq/lore/issues/42/", () => {
    expect(
      ["42", "#42", "https://github.com/re-cinq/lore/issues/42/"].map((story) =>
        storyIssueOf(story, REPO),
      ),
    ).toEqual([{ issue: 42 }, { issue: 42 }, { issue: 42 }]);
  });

  it("reads 42 from the issue URL Re-Cinq/Lore/issues/42, the repo named in another case", () => {
    expect(
      storyIssueOf("https://github.com/Re-Cinq/Lore/issues/42", REPO),
    ).toEqual({ issue: 42 });
  });

  it("refuses issue 42 of other/repo for a plan of re-cinq/lore", () => {
    expect(
      storyIssueOf("https://github.com/other/repo/issues/42", REPO),
    ).toEqual({ error: "The user story must be an issue of re-cinq/lore." });
  });

  it("reads nothing from 0, a pull request URL or a word", () => {
    expect(
      ["0", "https://github.com/re-cinq/lore/pull/42", "story"].map((story) =>
        storyIssueOf(story, REPO),
      ),
    ).toEqual([
      { error: STORY_REFUSED },
      { error: STORY_REFUSED },
      { error: STORY_REFUSED },
    ]);
  });
});

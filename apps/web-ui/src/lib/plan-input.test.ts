import { describe, it, expect } from "vitest";
import { newPlanInput, paragraphsOf } from "./plan-input";

const form = (fields: Record<string, string>) => {
  const formData = new FormData();

  Object.entries(fields).forEach(([key, value]) => formData.set(key, value));

  return formData;
};

describe("newPlanInput", () => {
  it("reads a performance plan titled Faster checkout with its description", () => {
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

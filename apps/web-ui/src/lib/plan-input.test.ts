import { describe, it, expect } from "vitest";
import { newPlanInput, paragraphsOf, planSocketUrl } from "./plan-input";

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

describe("planSocketUrl", () => {
  it("uses the public socket address the deployment names", () => {
    expect(
      planSocketUrl({
        LORE_PLANS_WS_URL: "wss://lore-api.example/api/plans/collab",
        LORE_API_URL: "http://lore-api:3000",
      }),
    ).toEqual("wss://lore-api.example/api/plans/collab");
  });

  it("derives ws://localhost:3002/api/plans/collab from a local lore-api", () => {
    expect(planSocketUrl({ LORE_API_URL: "http://localhost:3002" })).toEqual(
      "ws://localhost:3002/api/plans/collab",
    );
  });

  it("has no address when neither is configured", () => {
    expect(planSocketUrl({})).toBeUndefined();
  });
});

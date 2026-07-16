// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TriggerReviewButton } from "./TriggerReviewButton";

describe("TriggerReviewButton", () => {
  it("posts the repo and pr_number to the review-trigger proxy", () => {
    const { container } = render(
      <TriggerReviewButton repo="re-cinq/lore" prNumber={42} />,
    );

    expect(
      screen.getByRole("button", { name: "Trigger review" }),
    ).toBeInTheDocument();
    expect(container.querySelector("form")).toHaveAttribute(
      "action",
      "/api/review/trigger",
    );
    expect(container.querySelector('input[name="repo"]')).toHaveAttribute(
      "value",
      "re-cinq/lore",
    );
    expect(container.querySelector('input[name="pr_number"]')).toHaveAttribute(
      "value",
      "42",
    );
  });
});

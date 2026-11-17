// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import DraftingPlan from "./DraftingPlan";

describe("DraftingPlan", () => {
  it("says the agent is writing the plan instead of showing the draft it will replace", () => {
    render(<DraftingPlan />);

    expect(screen.getByRole("status")).toHaveTextContent(
      "The planning agent is writing this plan",
    );
  });
});

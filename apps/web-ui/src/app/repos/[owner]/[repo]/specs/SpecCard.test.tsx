// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import SpecCard from "./SpecCard";

describe("SpecCard", () => {
  it("renders the title and a Details link pointing to detailsHref", () => {
    render(
      <SpecCard
        title="Auth spec"
        description="login flow"
        detailsHref="/repos/re-cinq/lore/specs/auth"
      />,
    );
    expect(screen.getByText("Auth spec")).toBeTruthy();
    const detailsLink = screen.getByText("Details").closest("a");

    expect(detailsLink?.getAttribute("href")).toBe(
      "/repos/re-cinq/lore/specs/auth",
    );
  });

  it("shows 4 / 10 and 40% for coverage 4 of 10 testable", () => {
    render(
      <SpecCard
        title="Auth spec"
        description="login flow"
        detailsHref="/repos/re-cinq/lore/specs/auth"
        coverage={{ testable: 10, covered: 4, ratio: 0.4 }}
      />,
    );
    expect(screen.getByText(/4\s*\/\s*10/)).toBeTruthy();
    expect(screen.getByText(/40%/)).toBeTruthy();
  });
});

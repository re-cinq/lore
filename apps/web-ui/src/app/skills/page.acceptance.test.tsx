// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

// @ts-expect-error - SkillsPage is not implemented yet
import SkillsPage from "./page";

describe("Skills Management UI", () => {
  it("Skills page supports listing, creating, editing, and deleting skills", async () => {
    // This acceptance test will fail on CI due to missing module (direct strategy)
    const { container } = render(<SkillsPage />);

    // Validate page header
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Skills",
    );

    // Validate list presence
    expect(screen.getByRole("table")).toBeInTheDocument();

    // Validate create button
    expect(screen.getByRole("button", { name: /create/i })).toBeInTheDocument();
  });
});

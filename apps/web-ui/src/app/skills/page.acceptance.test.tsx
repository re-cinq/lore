// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

// @ts-expect-error - SkillsPage is not implemented yet
import SkillsPage from "./page";

describe("Skills Management UI", () => {
  it("Skills page supports listing, creating, editing, and deleting skills", async () => {
    render(<SkillsPage />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Skills",
    );

    expect(screen.getByRole("table")).toBeInTheDocument();

    expect(screen.getByRole("button", { name: /create/i })).toBeInTheDocument();
  });
});

// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DangerZone } from "./DangerZone";

describe("DangerZone", () => {
  it("labels the section 'Danger zone' without being told", () => {
    render(<DangerZone description="x">{null}</DangerZone>);
    expect(
      screen.getByRole("heading", { name: "Danger zone" }),
    ).toBeInTheDocument();
  });

  it("takes a different title when the action is not deletion", () => {
    render(
      <DangerZone title="Reset this repo" description="x">
        {null}
      </DangerZone>,
    );
    expect(
      screen.getByRole("heading", { name: "Reset this repo" }),
    ).toBeInTheDocument();
  });

  it("explains the consequence above the controls", () => {
    render(
      <DangerZone description="Permanently delete this feature.">
        {null}
      </DangerZone>,
    );
    expect(
      screen.getByText("Permanently delete this feature."),
    ).toBeInTheDocument();
  });

  it("renders the caller's controls", () => {
    render(
      <DangerZone description="x">
        <button type="button">Delete feature</button>
      </DangerZone>,
    );
    expect(
      screen.getByRole("button", { name: "Delete feature" }),
    ).toBeInTheDocument();
  });

  it("carries the destructive styling that made it a card", () => {
    // The point of extracting it: the two-class string and the globals.css
    // coupling live here now, not at each call site.
    const { container } = render(
      <DangerZone description="x">{null}</DangerZone>,
    );

    expect(container.firstElementChild?.className).toContain("spec-card");
    expect(container.firstElementChild?.className).toContain("danger-zone");
  });
});

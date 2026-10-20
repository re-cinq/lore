// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SettingsHeader } from "./SettingsHeader";

describe("SettingsHeader", () => {
  it("renders the caption, the title and the lede", () => {
    render(<SettingsHeader eyebrow="{org}" title="Settings" lede="Org-wide" />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Settings" }),
    ).toBeInTheDocument();
    expect(screen.getByText("{org}")).toBeInTheDocument();
    expect(screen.getByText("Org-wide")).toBeInTheDocument();
  });

  it("renders no lede paragraph when none is given", () => {
    const { container } = render(
      <SettingsHeader eyebrow="{org}" title="Settings" />,
    );

    expect(container.querySelector("p")).toBeNull();
  });
});

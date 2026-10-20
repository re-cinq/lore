// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SettingsCard } from "./SettingsCard";

describe("SettingsCard", () => {
  it("names the card by an h2 heading by default", () => {
    render(<SettingsCard id="set-github" title="GitHub" />);

    expect(
      screen.getByRole("region", { name: "GitHub" }).querySelector("h2"),
    ).not.toBeNull();
  });

  it("uses an h3 heading when headingLevel is 3", () => {
    render(<SettingsCard id="set-x" title="Regenerate" headingLevel={3} />);

    expect(
      screen.getByRole("region", { name: "Regenerate" }).querySelector("h3"),
    ).not.toBeNull();
  });

  it("renders the description, the action and the children when given", () => {
    render(
      <SettingsCard
        id="set-y"
        title="Accounts"
        description="Linked accounts"
        action={<button type="button">Copy</button>}
      >
        card body
      </SettingsCard>,
    );

    expect(screen.getByText("Linked accounts")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
    expect(screen.getByText("card body")).toBeInTheDocument();
  });

  it("renders no description paragraph when none is given", () => {
    const { container } = render(<SettingsCard id="set-z" title="Bare" />);

    expect(container.querySelector("p")).toBeNull();
  });

  it("adds the danger class only when danger is set", () => {
    render(
      <>
        <SettingsCard id="calm" title="Calm" />
        <SettingsCard id="risky" title="Risky" danger />
      </>,
    );

    expect(screen.getByRole("region", { name: "Calm" }).className).not.toMatch(
      /danger/,
    );
    expect(screen.getByRole("region", { name: "Risky" }).className).toMatch(
      /danger/,
    );
  });
});

// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import SettingsLayout, { SettingsCard, SettingsHeader } from "./SettingsLayout";

function renderPage() {
  return render(
    <SettingsLayout
      nav={[
        { id: "set-github", label: "GitHub" },
        { id: "set-danger", label: "Danger zone", danger: true },
      ]}
    >
      <SettingsCard id="set-github" title="GitHub" description="Accounts" />
      <SettingsCard
        id="set-danger"
        title="Regenerate"
        danger
        headingLevel={3}
      />
    </SettingsLayout>,
  );
}

describe("SettingsLayout", () => {
  it("links each sub-navigation entry to the card with its id", () => {
    renderPage();
    const nav = screen.getByRole("navigation", { name: "Settings sections" });
    const hrefs = Array.from(nav.querySelectorAll("a")).map((link) =>
      link.getAttribute("href"),
    );

    expect(hrefs).toEqual(["#set-github", "#set-danger"]);
  });

  it("names each card by its heading at the level the page asks for", () => {
    renderPage();

    expect(
      screen.getByRole("region", { name: "GitHub" }).querySelector("h2"),
    ).not.toBeNull();
    expect(
      screen.getByRole("region", { name: "Regenerate" }).querySelector("h3"),
    ).not.toBeNull();
  });

  it("renders the header's caption, title and lede", () => {
    render(<SettingsHeader eyebrow="{org}" title="Settings" lede="Org-wide" />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Settings" }),
    ).toBeInTheDocument();
    expect(screen.getByText("{org}")).toBeInTheDocument();
    expect(screen.getByText("Org-wide")).toBeInTheDocument();
  });
});

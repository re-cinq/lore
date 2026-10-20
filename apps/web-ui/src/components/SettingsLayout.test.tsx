// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import SettingsLayout from "./SettingsLayout";

describe("SettingsLayout", () => {
  it("links each sub-navigation entry to the card with its id", () => {
    render(
      <SettingsLayout
        nav={[
          { id: "set-github", label: "GitHub" },
          { id: "set-danger", label: "Danger zone", danger: true },
        ]}
      >
        body
      </SettingsLayout>,
    );
    const nav = screen.getByRole("navigation", { name: "Settings sections" });
    const hrefs = Array.from(nav.querySelectorAll("a")).map((link) =>
      link.getAttribute("href"),
    );

    expect(hrefs).toEqual(["#set-github", "#set-danger"]);
  });

  it("marks only the danger entry with the danger class", () => {
    render(
      <SettingsLayout
        nav={[
          { id: "a", label: "Plain" },
          { id: "b", label: "Risky", danger: true },
        ]}
      >
        body
      </SettingsLayout>,
    );

    expect(screen.getByText("Plain").className).not.toMatch(/navDanger/);
    expect(screen.getByText("Risky").className).toMatch(/navDanger/);
  });

  it("renders its children beside the navigation", () => {
    render(<SettingsLayout nav={[]}>page body</SettingsLayout>);

    expect(screen.getByText("page body")).toBeInTheDocument();
  });
});

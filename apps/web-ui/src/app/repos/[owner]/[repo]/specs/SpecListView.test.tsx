// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import SpecListView from "./SpecListView";

describe("SpecListView", () => {
  it("renders one card per spec folder titled from spec.md, listing each file as a link to its encoded detail page", () => {
    const specs = [
      {
        filePath: "specs/auth/plan.md",
        title: "Plan",
        description: "the plan",
        coverage: { testable: 2, covered: 1, ratio: 0.5 },
      },
      {
        filePath: "specs/auth/spec.md",
        title: "Auth spec",
        description: "login flow",
        coverage: { testable: 10, covered: 4, ratio: 0.4 },
      },
      {
        filePath: ".specify/spec.md",
        title: "Specify spec",
        description: "project setup",
        coverage: { testable: 6, covered: 6, ratio: 1 },
      },
    ];
    render(<SpecListView owner="re-cinq" repo="lore" specs={specs} />);

    // One card per folder (specs/auth collapses plan.md + spec.md), titled from spec.md, sorted by folder key.
    const titles = screen
      .queryAllByRole("heading")
      .map((node) => node.textContent);
    expect(titles).toEqual(["Specify spec", "Auth spec"]);

    // Every file in a folder links to its own encoded detail page (spec.md first).
    const hrefs = screen
      .queryAllByRole("link")
      .map((node) => node.getAttribute("href"));
    expect(hrefs).toEqual([
      `/repos/re-cinq/lore/specs/${encodeURIComponent(".specify/spec.md")}`,
      `/repos/re-cinq/lore/specs/${encodeURIComponent("specs/auth/spec.md")}`,
      `/repos/re-cinq/lore/specs/${encodeURIComponent("specs/auth/plan.md")}`,
    ]);
  });

  it("shows an empty-state hint when the graph holds no specs", () => {
    render(<SpecListView owner="re-cinq" repo="lore" specs={[]} />);
    expect(screen.getByText(/no specs in the graph/i)).toBeTruthy();
  });
});

// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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

    const titles = screen
      .queryAllByRole("heading")
      .map((node) => node.textContent);

    expect(titles).toEqual(["Specify spec", "Auth spec"]);

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

  it("counts folder statuses into chips and filters the cards when a chip is clicked", () => {
    const specs = [
      {
        filePath: "specs/auth/spec.md",
        title: "Auth spec",
        description: "login",
        coverage: { testable: 2, covered: 2, ratio: 1 },
      },
      {
        filePath: "specs/pay/spec.md",
        title: "Pay spec",
        description: "billing",
        coverage: { testable: 2, covered: 0, ratio: 0 },
      },
    ];

    render(
      <SpecListView
        owner="re-cinq"
        repo="lore"
        specs={specs}
        statuses={{
          "specs/auth/spec.md": { status: "shipped", label: "Shipped" },
          "specs/pay/spec.md": { status: "draft", label: "Draft" },
        }}
      />,
    );

    const shippedChip = screen.getByRole("button", { name: /Shipped \(1\)/ });

    expect(shippedChip).toBeInTheDocument();
    fireEvent.click(shippedChip);

    expect(
      screen.getByRole("heading", { name: /Auth spec/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /Pay spec/ }),
    ).not.toBeInTheDocument();
  });

  it("narrows the cards to the typed search text", () => {
    const specs = [
      {
        filePath: "specs/auth/spec.md",
        title: "Auth spec",
        description: "login",
        coverage: { testable: 2, covered: 2, ratio: 1 },
      },
      {
        filePath: "specs/pay/spec.md",
        title: "Pay spec",
        description: "billing",
        coverage: { testable: 2, covered: 0, ratio: 0 },
      },
    ];

    render(<SpecListView owner="re-cinq" repo="lore" specs={specs} />);
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "billing" },
    });

    expect(
      screen.getByRole("heading", { name: /Pay spec/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /Auth spec/ }),
    ).not.toBeInTheDocument();
  });

  it("reorders the cards by lifecycle status when the status sort is picked", () => {
    const specs = [
      {
        filePath: "specs/auth/spec.md",
        title: "Auth spec",
        description: "login",
        coverage: { testable: 2, covered: 2, ratio: 1 },
      },
      {
        filePath: "specs/pay/spec.md",
        title: "Pay spec",
        description: "billing",
        coverage: { testable: 2, covered: 0, ratio: 0 },
      },
    ];

    render(
      <SpecListView
        owner="re-cinq"
        repo="lore"
        specs={specs}
        statuses={{
          "specs/auth/spec.md": { status: "shipped", label: "Shipped" },
          "specs/pay/spec.md": { status: "draft", label: "Draft" },
        }}
      />,
    );
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "status" },
    });

    const titles = screen
      .queryAllByRole("heading")
      .map((node) => node.textContent?.trim());

    expect(titles).toEqual(["Pay specDraft", "Auth specShipped"]);
  });
});

// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import AdrListView from "./AdrListView";
import type { SpecStatusInfo } from "@/lib/spec-status";

const adrs = [
  {
    filePath: "adrs/ADR-016-dark-factory.md",
    title: "Dark Factory",
    description: "Autonomous PRs",
  },
  {
    filePath: "adrs/ADR-015-review-reactor.md",
    title: "Review Reactor",
    description: "Event-driven review",
  },
];

const statuses: Record<string, SpecStatusInfo> = {
  "adrs/ADR-016-dark-factory.md": { status: "shipped", label: "Accepted" },
  "adrs/ADR-015-review-reactor.md": { status: "draft", label: "Draft" },
};

describe("AdrListView", () => {
  it("renders a card per ADR summary with a Details link to the encoded detail path", () => {
    render(<AdrListView owner="re-cinq" repo="lore" adrs={adrs} />);

    expect(screen.getByText("Dark Factory")).toBeTruthy();
    expect(screen.getByText("Review Reactor")).toBeTruthy();

    const detailsHrefs = screen
      .queryAllByText("Details")
      .map((node) => node.closest("a")?.getAttribute("href"));

    expect(detailsHrefs).toEqual([
      `/repos/re-cinq/lore/adrs/${encodeURIComponent("adrs/ADR-016-dark-factory.md")}`,
      `/repos/re-cinq/lore/adrs/${encodeURIComponent("adrs/ADR-015-review-reactor.md")}`,
    ]);
  });

  it("shows an empty-state hint when the graph holds no ADRs", () => {
    render(<AdrListView owner="re-cinq" repo="lore" adrs={[]} />);
    expect(screen.getByText(/no adrs in the graph/i)).toBeTruthy();
  });

  it("renders a status pill per card from the statuses prop", () => {
    render(
      <AdrListView
        owner="re-cinq"
        repo="lore"
        adrs={adrs}
        statuses={statuses}
      />,
    );

    expect(screen.getByText("Accepted")).toBeTruthy();
    expect(screen.getByText("Draft (1)")).toBeTruthy();
  });

  it("shows filter chips with counts and narrows cards on click", () => {
    render(
      <AdrListView
        owner="re-cinq"
        repo="lore"
        adrs={adrs}
        statuses={statuses}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Shipped \(1\)/ }));

    expect(screen.getByText("Dark Factory")).toBeTruthy();
    expect(screen.queryByText("Review Reactor")).toBeNull();
  });

  it("hides an unstatused ADR under a status filter", () => {
    render(
      <AdrListView
        owner="re-cinq"
        repo="lore"
        adrs={[
          ...adrs,
          { filePath: "adrs/ADR-001-x.md", title: "X", description: "" },
        ]}
        statuses={statuses}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Draft \(1\)/ }));

    expect(screen.getByText("Review Reactor")).toBeTruthy();
    expect(screen.queryByText("X")).toBeNull();
    expect(screen.queryByText("Dark Factory")).toBeNull();
  });

  it("renders descriptions on the cards", () => {
    render(<AdrListView owner="re-cinq" repo="lore" adrs={adrs} />);

    expect(screen.getByText("Autonomous PRs")).toBeTruthy();
    expect(screen.getByText("Event-driven review")).toBeTruthy();
  });

  it("narrows the cards to the typed search text", () => {
    render(<AdrListView owner="re-cinq" repo="lore" adrs={adrs} />);
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "reactor" },
    });

    expect(screen.getByText("Review Reactor")).toBeTruthy();
    expect(screen.queryByText("Dark Factory")).toBeNull();
  });

  it("shows a no-match message when the search matches nothing", () => {
    render(<AdrListView owner="re-cinq" repo="lore" adrs={adrs} />);
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "zzz-nothing" },
    });

    expect(screen.getByText(/no adrs match/i)).toBeTruthy();
  });

  it("reorders the cards by lifecycle status when the status sort is picked", () => {
    render(
      <AdrListView
        owner="re-cinq"
        repo="lore"
        adrs={adrs}
        statuses={statuses}
      />,
    );
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "status" },
    });

    const titles = screen
      .queryAllByRole("heading")
      .map((node) => node.textContent?.trim());

    expect(titles).toEqual(["Review ReactorDraft", "Dark FactoryAccepted"]);
  });
});

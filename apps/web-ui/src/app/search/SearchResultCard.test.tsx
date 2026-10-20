// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import SearchResultCard from "./SearchResultCard";
import type { SearchResult } from "./SearchView";

const result = (over: Partial<SearchResult> = {}): SearchResult => ({
  key: "deployment-gotchas",
  value: "Set the env var first",
  agent_id: "abcdef0123456789",
  score: 0.5,
  source: "memory",
  repo: null,
  ...over,
});

const fillOf = (container: HTMLElement) =>
  (
    container.querySelector("[style*='--meter-fill']") as HTMLElement
  ).style.getPropertyValue("--meter-fill");

describe("SearchResultCard", () => {
  it("fills the score meter with the share of the best score", () => {
    const { container } = render(
      <SearchResultCard result={result({ score: 0.5 })} best={1} />,
    );

    expect(fillOf(container)).toEqual("50%");
  });

  it("leaves the score meter empty when the best score is zero", () => {
    const { container } = render(
      <SearchResultCard result={result({ score: 0 })} best={0} />,
    );

    expect(fillOf(container)).toEqual("0%");
  });

  it("prints the score to three decimals", () => {
    render(<SearchResultCard result={result({ score: 0.4287 })} best={1} />);

    expect(screen.getByText(/score 0\.429/)).toBeInTheDocument();
  });

  it("shows the repository when the hit has one", () => {
    render(
      <SearchResultCard result={result({ repo: "re-cinq/lore" })} best={1} />,
    );

    expect(screen.getByText("re-cinq/lore")).toBeInTheDocument();
  });

  it("shows no repository when the hit has none", () => {
    render(<SearchResultCard result={result({ repo: null })} best={1} />);

    expect(screen.queryByText("re-cinq/lore")).not.toBeInTheDocument();
  });
});

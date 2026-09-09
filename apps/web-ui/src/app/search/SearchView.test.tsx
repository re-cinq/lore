// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import SearchView, {
  type SearchResult,
  type SearchRepoOption,
} from "./SearchView";

const REPOS: SearchRepoOption[] = [
  { full_name: "re-cinq/lore" },
  { full_name: "re-cinq/atlas" },
];

const result = (over: Partial<SearchResult>): SearchResult => ({
  key: "deployment-gotchas-2026",
  value: "Always set the env var before deploy",
  agent_id: "abcdef0123456789",
  score: 0.4287,
  source: "memory",
  repo: null,
  ...over,
});

describe("SearchView", () => {
  it("renders the repo filter options with the active repo preselected", () => {
    render(<SearchView repo="re-cinq/atlas" repos={REPOS} results={[]} />);
    expect(
      screen.getByRole("option", { name: "All repos" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "re-cinq/lore" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "re-cinq/atlas" }),
    ).toBeInTheDocument();
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toEqual(
      "re-cinq/atlas",
    );
  });

  it("preserves the typed query in the search input", () => {
    render(<SearchView q="env var" repos={REPOS} results={[result({})]} />);
    expect(
      (screen.getByPlaceholderText(/Search memories/) as HTMLInputElement)
        .value,
    ).toEqual("env var");
  });

  it("shows no result-count line and no empty-state when no query has run", () => {
    render(<SearchView repos={REPOS} results={[]} />);
    expect(screen.queryByText(/result/)).not.toBeInTheDocument();
    expect(screen.queryByText(/No results found/)).not.toBeInTheDocument();
  });

  it("shows the singular result count for exactly one match", () => {
    render(<SearchView q="env" repos={REPOS} results={[result({})]} />);
    const meta = screen.getByText(/1 result for/).closest("p") as HTMLElement;

    expect(meta.textContent).toContain("1 result for");
    expect(meta.textContent).toContain('"env"');
  });

  it("shows the plural result count and zero-match empty state", () => {
    render(<SearchView q="missing" repos={REPOS} results={[]} />);
    const meta = screen.getByText(/0 results for/).closest("p") as HTMLElement;

    expect(meta.textContent).toContain("0 results for");
    expect(meta.textContent).toContain('"missing"');
    expect(
      screen.getByText("No results found. Try a different search term."),
    ).toBeInTheDocument();
  });

  it("appends the active repo to the result-count line", () => {
    render(
      <SearchView
        q="env"
        repo="re-cinq/lore"
        repos={REPOS}
        results={[result({})]}
      />,
    );
    const meta = screen.getByText(/result for/).closest("p") as HTMLElement;

    expect(within(meta).getByText("re-cinq/lore")).toBeInTheDocument();
    expect(meta.textContent).toContain("in");
  });

  it("renders a memory result with truncated agent id, fixed score and a read badge", () => {
    render(
      <SearchView
        q="env"
        repos={REPOS}
        results={[
          result({
            key: "deployment-gotchas-2026",
            agent_id: "abcdef0123456789",
            score: 0.4287,
            source: "memory",
            repo: null,
          }),
        ]}
      />,
    );
    expect(screen.getByText("deployment-gotchas-2026")).toBeInTheDocument();
    expect(
      screen.getByText(/agent: abcdef01… · score: 0\.429/),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Always set the env var before deploy"),
    ).toBeInTheDocument();
    expect(screen.getByText("Memory")).toHaveClass("op-badge", "op-read");
  });

  it("renders a fact result with the op-search badge", () => {
    render(
      <SearchView
        q="env"
        repos={REPOS}
        results={[result({ source: "fact" })]}
      />,
    );
    expect(screen.getByText("Fact")).toHaveClass("op-badge", "op-search");
  });

  it("renders an episode result with the op-read badge", () => {
    render(
      <SearchView
        q="env"
        repos={REPOS}
        results={[result({ source: "episode" })]}
      />,
    );
    expect(screen.getByText("Episode")).toHaveClass("op-badge", "op-read");
  });

  it("renders a chunk result with the op-write badge plus the repo meta and repo badge", () => {
    render(
      <SearchView
        q="env"
        repos={REPOS}
        results={[
          result({
            key: "src/index.ts",
            source: "chunk",
            repo: "re-cinq/lore",
            agent_id: "ingestion-svc",
          }),
        ]}
      />,
    );
    const card = screen
      .getByText("src/index.ts")
      .closest(".search-result") as HTMLElement;
    const scoped = within(card);

    expect(scoped.getByText("Chunk")).toHaveClass("op-badge", "op-write");
    expect(scoped.getAllByText("re-cinq/lore")).toHaveLength(2);
    expect(card.querySelector(".badge")?.textContent).toEqual("re-cinq/lore");
  });

  it("omits the repo meta and repo badge when the result has no repo", () => {
    render(
      <SearchView q="env" repos={REPOS} results={[result({ repo: null })]} />,
    );
    const card = screen
      .getByText("deployment-gotchas-2026")
      .closest(".search-result") as HTMLElement;

    expect(card.querySelector(".badge")).toBeNull();
    expect(within(card).queryByText(/· repo:/)).not.toBeInTheDocument();
  });

  it("renders multiple results in order", () => {
    render(
      <SearchView
        q="env"
        repos={REPOS}
        results={[
          result({ key: "mem-one", source: "memory" }),
          result({ key: "fact-two", source: "fact", value: "A derived fact" }),
          result({
            key: "chunk-three",
            source: "chunk",
            repo: "re-cinq/atlas",
          }),
        ]}
      />,
    );
    expect(screen.getByText("mem-one")).toBeInTheDocument();
    expect(screen.getByText("fact-two")).toBeInTheDocument();
    expect(screen.getByText("chunk-three")).toBeInTheDocument();
    expect(screen.getByText("A derived fact")).toBeInTheDocument();
    expect(screen.getByText(/3 results for/)).toBeInTheDocument();
  });
});

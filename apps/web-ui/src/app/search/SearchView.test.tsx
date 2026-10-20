// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import SearchView, {
  type SearchResult,
  type SearchRepoOption,
} from "./SearchView";

vi.mock("@/components/Icon", () => ({
  default: ({ name }: { name: string }) => <i data-testid={`icon-${name}`} />,
}));

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

const card = (key: string) => screen.getByRole("article", { name: key });

const countLine = (pattern: RegExp) =>
  (screen.getByText(pattern).closest("p") as HTMLElement).textContent;

describe("SearchView form", () => {
  it("renders the repo filter options with the active repo preselected", () => {
    render(<SearchView repo="re-cinq/atlas" repos={REPOS} results={[]} />);
    const options = screen.getAllByRole("option").map((o) => o.textContent);

    expect(options).toEqual(["All repos", "re-cinq/lore", "re-cinq/atlas"]);
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

  it("titles the screen Search under the knowledge group", () => {
    render(<SearchView repos={REPOS} results={[]} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toEqual(
      "Search",
    );
    expect(screen.getByText("{knowledge}")).toBeInTheDocument();
  });
});

describe("SearchView result count", () => {
  it("shows no result-count line, chips or empty-state when no query has run", () => {
    render(<SearchView repos={REPOS} results={[]} />);
    expect(screen.queryByText(/result/)).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(screen.queryByText(/No results found/)).not.toBeInTheDocument();
  });

  it("shows the singular result count for exactly one match", () => {
    render(<SearchView q="env" repos={REPOS} results={[result({})]} />);
    expect(countLine(/1 result for/)).toEqual('1 result for "env"');
  });

  it("shows the plural result count and zero-match empty state", () => {
    render(<SearchView q="missing" repos={REPOS} results={[]} />);
    expect(countLine(/0 results for/)).toEqual('0 results for "missing"');
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
    expect(countLine(/result for/)).toEqual(
      '1 result for "env" in re-cinq/lore',
    );
  });
});

describe("SearchView result cards", () => {
  it("renders a memory result with its key, value, truncated agent id and fixed score", () => {
    render(<SearchView q="env" repos={REPOS} results={[result({})]} />);
    const scoped = within(card("deployment-gotchas-2026"));

    expect(scoped.getByText("agent abcdef01…")).toBeInTheDocument();
    expect(scoped.getByText(/score 0\.429/)).toBeInTheDocument();
    expect(
      scoped.getByText("Always set the env var before deploy"),
    ).toBeInTheDocument();
  });

  it("labels each card with its source in that source's tone", () => {
    const sources = ["memory", "fact", "chunk", "episode"] as const;

    render(
      <SearchView
        q="env"
        repos={REPOS}
        results={sources.map((source) => result({ key: source, source }))}
      />,
    );
    const tones = sources.map(
      (source) =>
        within(card(source)).getByText(/^(Memory|Fact|Chunk|Episode)$/)
          .className,
    );

    expect(tones.map((t, i) => t.includes(`_${sources[i]}_`))).toEqual(
      sources.map(() => true),
    );
  });

  it("attributes a chunk result to its repo", () => {
    render(
      <SearchView
        q="env"
        repos={REPOS}
        results={[
          result({
            key: "src/index.ts",
            source: "chunk",
            repo: "re-cinq/lore",
          }),
        ]}
      />,
    );
    expect(
      within(card("src/index.ts")).getByText("re-cinq/lore"),
    ).toBeInTheDocument();
  });

  it("omits the repo when the result has no repo", () => {
    render(
      <SearchView q="env" repos={REPOS} results={[result({ repo: null })]} />,
    );
    expect(
      within(card("deployment-gotchas-2026")).queryByText(/re-cinq/),
    ).not.toBeInTheDocument();
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
    const keys = screen.getAllByRole("article").map((a) => a.ariaLabel);

    expect(keys).toEqual(["mem-one", "fact-two", "chunk-three"]);
    expect(screen.getByText(/3 results for/)).toBeInTheDocument();
  });
});

describe("SearchView source chips", () => {
  const mixed = [
    result({ key: "mem-one", source: "memory" }),
    result({ key: "mem-two", source: "memory" }),
    result({ key: "fact-one", source: "fact" }),
  ];

  it("offers All plus each source that has hits, with counts from the full set", () => {
    render(<SearchView q="env" repos={REPOS} results={mixed} source="fact" />);
    const chips = within(
      screen.getByRole("navigation", { name: "Result sources" }),
    ).getAllByRole("link");

    expect(chips.map((c) => c.textContent)).toEqual([
      "All3",
      "Memory2",
      "Fact1",
    ]);
  });

  it("links each chip to the same search narrowed to its source", () => {
    render(
      <SearchView
        q="env var"
        repo="re-cinq/lore"
        repos={REPOS}
        results={mixed}
      />,
    );
    const memory = screen.getByRole("link", { name: "Memory2" });

    expect(memory.getAttribute("href")).toEqual(
      "/search?q=env+var&repo=re-cinq%2Flore&source=memory",
    );
  });

  it("shows only the active source's cards and marks its chip current", () => {
    render(
      <SearchView q="env" repos={REPOS} results={mixed} source="memory" />,
    );
    const keys = screen.getAllByRole("article").map((a) => a.ariaLabel);

    expect(keys).toEqual(["mem-one", "mem-two"]);
    expect(screen.getByRole("link", { name: "Memory2" })).toHaveAttribute(
      "aria-current",
      "true",
    );
  });
});

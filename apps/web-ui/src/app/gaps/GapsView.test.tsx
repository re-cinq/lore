// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import GapsView, {
  type GapMemoryRow,
  type ZeroResultSearchRow,
} from "./GapsView";

vi.mock("@/components/Icon", () => ({
  default: () => <i aria-hidden="true" />,
}));

const memory = (over: Partial<GapMemoryRow> = {}): GapMemoryRow => ({
  key: "gap/2026-06-03",
  value: "Missing runbook for the lease reaper job.",
  created_at: "2026-06-03T10:00:00Z",
  ...over,
});

const search = (
  over: Partial<ZeroResultSearchRow> = {},
): ZeroResultSearchRow => ({
  memory_key: null,
  metadata: { query: "how to rotate db credentials", result_count: 0 },
  created_at: "2026-06-03T09:00:00Z",
  ...over,
});

const searches = () =>
  within(screen.getByRole("region", { name: "Zero-result searches" }));

describe("GapsView", () => {
  it("titles the page Gaps, links to Repositories and to the draft PRs on GitHub", () => {
    render(<GapsView gapMemories={[]} zeroResultSearches={[]} />);
    expect(
      screen.getByRole("heading", { level: 1, name: "Gaps" }),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "Repositories" })).toHaveAttribute(
      "href",
      "/",
    );
    expect(
      screen.getByRole("link", { name: "View on GitHub" }),
    ).toHaveAttribute(
      "href",
      "https://github.com/re-cinq/lore/pulls?q=label:context-gap-draft",
    );
  });

  it("renders a card per gap-detection finding with its key and raw value", () => {
    render(
      <GapsView
        gapMemories={[
          memory({ key: "gap/alpha", value: "Alpha finding text." }),
          memory({ key: "gap/beta", value: "Beta finding text." }),
        ]}
        zeroResultSearches={[]}
      />,
    );
    expect(screen.getAllByRole("article")).toHaveLength(2);
    expect(screen.getByRole("heading", { name: "gap/alpha" })).toBeVisible();
    expect(screen.getByText("Beta finding text.")).toBeInTheDocument();
  });

  it("shows the empty findings message when there are no gap memories", () => {
    render(<GapsView gapMemories={[]} zeroResultSearches={[search()]} />);
    expect(
      screen.getByText("No findings from the gap detection agent yet."),
    ).toBeInTheDocument();
  });

  it("groups zero-result searches by the query the search recorded, counting each ask", () => {
    render(
      <GapsView
        gapMemories={[]}
        zeroResultSearches={[
          search(),
          search(),
          search({ metadata: null, memory_key: "rotate db creds" }),
        ]}
      />,
    );
    const rows = searches().getAllByRole("listitem");

    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("“how to rotate db credentials”2× asked");
    expect(rows[1]).toHaveTextContent("“rotate db creds”1× asked");
  });

  it("shows the empty zero-result message when there are no recorded searches", () => {
    render(<GapsView gapMemories={[memory()]} zeroResultSearches={[]} />);
    expect(
      searches().getByText("No zero-result searches recorded."),
    ).toBeInTheDocument();
  });
});

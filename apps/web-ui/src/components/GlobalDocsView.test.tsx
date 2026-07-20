// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import GlobalDocsView from "./GlobalDocsView";

describe("GlobalDocsView", () => {
  it("groups docs by repo and links each path to the repo spec detail page", () => {
    render(
      <GlobalDocsView
        docs={[
          { repo: "re-cinq/lore", filePath: "specs/auth/spec.md" },
          { repo: "re-cinq/lore", filePath: ".specify/spec.md" },
          { repo: "acme/widgets", filePath: "specs/x.md" },
        ]}
        emptyHint="No specs in the graph yet."
        noMatchHint="No specs match this filter."
      />,
    );
    expect(screen.getByText("re-cinq/lore")).toBeTruthy();
    expect(screen.getByText("acme/widgets")).toBeTruthy();
    const link = screen.getByText("specs/auth/spec.md").closest("a");

    expect(link?.getAttribute("href")).toBe(
      `/repos/re-cinq/lore/specs/${encodeURIComponent("specs/auth/spec.md")}`,
    );
  });

  it("shows the empty hint when the graph holds no docs", () => {
    render(
      <GlobalDocsView
        docs={[]}
        emptyHint="No ADRs in the graph yet."
        noMatchHint="No ADRs match this filter."
      />,
    );
    expect(screen.getByText(/no adrs in the graph/i)).toBeTruthy();
  });

  it("counts statuses into chips and filters the list when a status chip is clicked", () => {
    const { container } = render(
      <GlobalDocsView
        docs={[
          { repo: "re-cinq/lore", filePath: "specs/auth/spec.md" },
          { repo: "re-cinq/lore", filePath: "specs/pay/spec.md" },
        ]}
        statuses={{
          "re-cinq/lore::specs/auth/spec.md": {
            status: "shipped",
            label: "Shipped",
          },
          "re-cinq/lore::specs/pay/spec.md": {
            status: "draft",
            label: "Draft",
          },
        }}
        emptyHint="No specs in the graph yet."
        noMatchHint="No specs match this filter."
      />,
    );

    expect(container.querySelectorAll(".status-pill")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: /Shipped \(1\)/ }));

    expect(screen.getByText("specs/auth/spec.md")).toBeInTheDocument();
    expect(screen.queryByText("specs/pay/spec.md")).not.toBeInTheDocument();
  });

  it("shows the no-match hint when the filter hides everything", () => {
    render(
      <GlobalDocsView
        docs={[{ repo: "re-cinq/lore", filePath: "adrs/ADR-001-x.md" }]}
        statuses={{
          "re-cinq/lore::adrs/ADR-001-x.md": {
            status: "draft",
            label: "Draft",
          },
        }}
        emptyHint="No ADRs in the graph yet."
        noMatchHint="No ADRs match this filter."
      />,
    );
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "zzz-nothing" },
    });

    expect(screen.getByText("No ADRs match this filter.")).toBeInTheDocument();
  });

  it("narrows the paths to the typed search text", () => {
    render(
      <GlobalDocsView
        docs={[
          { repo: "re-cinq/lore", filePath: "specs/auth/spec.md" },
          { repo: "acme/widgets", filePath: "specs/pay/spec.md" },
        ]}
        emptyHint="No specs in the graph yet."
        noMatchHint="No specs match this filter."
      />,
    );
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "PAY" },
    });

    expect(screen.getByText("specs/pay/spec.md")).toBeInTheDocument();
    expect(screen.queryByText("specs/auth/spec.md")).not.toBeInTheDocument();
    expect(screen.queryByText("re-cinq/lore")).not.toBeInTheDocument();
  });

  it("passes the adr chips kind through to the legend", () => {
    render(
      <GlobalDocsView
        docs={[{ repo: "re-cinq/lore", filePath: "adrs/ADR-001-x.md" }]}
        statuses={{
          "re-cinq/lore::adrs/ADR-001-x.md": {
            status: "draft",
            label: "Draft",
          },
        }}
        emptyHint="No ADRs in the graph yet."
        noMatchHint="No ADRs match this filter."
        kind="adr"
      />,
    );

    expect(screen.getByText(/from the ADR's frontmatter/)).toBeTruthy();
  });

  it("links to the repo adrs detail page when kind is adr", () => {
    render(
      <GlobalDocsView
        docs={[{ repo: "re-cinq/lore", filePath: "adrs/ADR-001-x.md" }]}
        emptyHint="No ADRs in the graph yet."
        noMatchHint="No ADRs match this filter."
        kind="adr"
      />,
    );
    const link = screen.getByText("adrs/ADR-001-x.md").closest("a");

    expect(link?.getAttribute("href")).toBe(
      `/repos/re-cinq/lore/adrs/${encodeURIComponent("adrs/ADR-001-x.md")}`,
    );
  });
});

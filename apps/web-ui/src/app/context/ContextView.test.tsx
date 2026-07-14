// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/link", () => ({
  __esModule: true,
  default: ({
    href,
    className,
    children,
  }: {
    href: string;
    className?: string;
    children: React.ReactNode;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
  useLinkStatus: () => ({ pending: false }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import ContextView, { type ContextChunk } from "./ContextView";

const chunk = (over: Partial<ContextChunk> = {}): ContextChunk => ({
  id: "1",
  file_path: "docs/readme.md",
  content_type: "doc",
  content: "Hello context",
  ingested_at: "2026-06-03T10:00:00Z",
  repo: "re-cinq/lore",
  metadata: null,
  ...over,
});

describe("ContextView", () => {
  it("renders a card per chunk with the repo label and a detail link", () => {
    render(
      <ContextView
        types={["doc", "adr"]}
        chunks={[
          chunk({
            id: "a",
            file_path: "docs/a.md",
            content_type: "doc",
            repo: "o/a",
          }),
          chunk({
            id: "b",
            file_path: "adrs/b.md",
            content_type: "adr",
            repo: "o/b",
          }),
        ]}
      />,
    );
    expect(screen.getByRole("link", { name: "docs/a.md" })).toHaveAttribute(
      "href",
      "/context/docs%2Fa.md",
    );
    expect(screen.getByText("o/a")).toBeInTheDocument();
    expect(screen.getByText("o/b")).toBeInTheDocument();
  });

  it("renders a chip per detected type only — no hardcoded runbook", () => {
    render(<ContextView types={["doc", "pull_request"]} chunks={[chunk()]} />);
    expect(screen.getByRole("link", { name: "doc" })).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "pull request" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "runbook" })).toBeNull();
  });

  it("marks the selected type chip active", () => {
    render(
      <ContextView type="adr" types={["doc", "adr"]} chunks={[chunk()]} />,
    );
    expect(screen.getByRole("link", { name: "All" })).not.toHaveClass("active");
    expect(screen.getByRole("link", { name: "adr" })).toHaveClass("active");
  });

  it("shows the first-run empty state with no clear-filters link when nothing is ingested", () => {
    render(<ContextView types={[]} chunks={[]} />);
    expect(screen.getByText("Nothing ingested yet")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Clear filters" })).toBeNull();
  });

  it("shows the filtered empty state with a clear-filters link when a type filter yields nothing", () => {
    render(<ContextView type="spec" types={["spec"]} chunks={[]} />);
    expect(screen.getByText("No matches for this filter")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Clear filters" })).toHaveAttribute(
      "href",
      "/context",
    );
  });

  it("shows the filtered empty state when a search query yields nothing", () => {
    render(
      <ContextView type="spec" q="widgets" types={["spec"]} chunks={[]} />,
    );
    expect(screen.getByText("No matches for this filter")).toBeInTheDocument();
  });
});

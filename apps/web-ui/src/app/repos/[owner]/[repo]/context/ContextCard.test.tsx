// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import ContextCard, { type ContextCardChunk } from "./ContextCard";

const chunk = (over: Partial<ContextCardChunk> = {}): ContextCardChunk => ({
  id: "1",
  file_path: "docs/readme.md",
  content_type: "doc",
  content: "Hello context body",
  ingested_at: "2026-06-03T10:00:00Z",
  metadata: null,
  ...over,
});

describe("ContextCard", () => {
  it("links the file path to the detail route", () => {
    render(
      <ContextCard
        chunk={chunk({ file_path: "specs/a/spec.md" })}
        detailHref="/repos/o/r/context/specs%2Fa%2Fspec.md"
        repo="o/r"
      />,
    );
    const link = screen.getByRole("link", { name: "specs/a/spec.md" });

    expect(link).toHaveAttribute(
      "href",
      "/repos/o/r/context/specs%2Fa%2Fspec.md",
    );
  });

  it("renders the type badge with its color class", () => {
    render(
      <ContextCard
        chunk={chunk({ content_type: "code" })}
        detailHref="/x"
        repo="o/r"
      />,
    );
    const badge = screen.getByText("code", { selector: "span.badge" });

    expect(badge.className).toContain("badge-gray");
  });

  it("shows the derived metadata header when metadata is present", () => {
    render(
      <ContextCard
        chunk={chunk({
          content_type: "code",
          metadata: {
            symbol_type: "function",
            symbol_name: "foo",
            start_line: 1,
            end_line: 9,
          },
        })}
        detailHref="/x"
        repo="o/r"
      />,
    );
    expect(screen.getByText("function foo · L1–9")).toBeInTheDocument();
  });

  it("shows the repo label only when one is passed", () => {
    const { rerender } = render(
      <ContextCard chunk={chunk()} detailHref="/x" repo="o/r" />,
    );

    expect(screen.queryByText("o/r")).toBeNull();
    rerender(
      <ContextCard
        chunk={chunk()}
        detailHref="/x"
        repo="o/r"
        repoLabel="o/r"
      />,
    );
    expect(screen.getByText("o/r")).toBeInTheDocument();
  });
});

// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import ContextFileView, { type ContextFileChunk } from "./ContextFileView";

const chunk = (over: Partial<ContextFileChunk> = {}): ContextFileChunk => ({
  id: "1",
  content_type: "doc",
  content: "chunk body",
  metadata: null,
  ...over,
});

describe("ContextFileView", () => {
  it("renders a Not Found state when no chunks exist", () => {
    render(
      <ContextFileView
        filePath="docs/missing.md"
        contextLink="/context"
        groups={[]}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "Not Found" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/No context found at/)).toBeInTheDocument();
  });

  it("renders breadcrumb, basename title and the chunk body for a single group", () => {
    render(
      <ContextFileView
        filePath="specs/a/spec.md"
        contextLink="/repos/o/r/context"
        groups={[
          { repo: "o/r", chunks: [chunk({ content: "the spec body" })] },
        ]}
      />,
    );
    expect(screen.getByRole("link", { name: "Context" })).toHaveAttribute(
      "href",
      "/repos/o/r/context",
    );
    expect(
      screen.getByRole("heading", { level: 1, name: "spec.md" }),
    ).toBeInTheDocument();
    expect(screen.getByText("the spec body")).toBeInTheDocument();
  });

  it("omits the repo header for a single per-repo group", () => {
    render(
      <ContextFileView
        filePath="a.md"
        contextLink="/repos/o/r/context"
        groups={[{ repo: "o/r", chunks: [chunk()] }]}
      />,
    );
    expect(screen.queryByText("repo: o/r")).toBeNull();
  });

  it("renders a repo header and view-in-repo link per group in the global view", () => {
    render(
      <ContextFileView
        filePath="CLAUDE.md"
        contextLink="/context"
        groups={[
          {
            repo: "o/a",
            repoHref: "/repos/o/a/context/CLAUDE.md",
            chunks: [chunk({ id: "a" })],
          },
          {
            repo: "o/b",
            repoHref: "/repos/o/b/context/CLAUDE.md",
            chunks: [chunk({ id: "b" })],
          },
        ]}
      />,
    );
    expect(screen.getByText("repo: o/a")).toBeInTheDocument();
    expect(screen.getByText("repo: o/b")).toBeInTheDocument();
    expect(
      screen.getAllByRole("link", { name: "view in repo →" }),
    ).toHaveLength(2);
  });

  it("renders a separator between multiple chunks in a group", () => {
    const { container } = render(
      <ContextFileView
        filePath="a.md"
        contextLink="/context"
        groups={[
          { repo: "o/r", chunks: [chunk({ id: "a" }), chunk({ id: "b" })] },
        ]}
      />,
    );

    expect(container.querySelectorAll("hr").length).toBeGreaterThanOrEqual(1);
  });
});

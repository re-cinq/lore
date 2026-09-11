// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import GraphEmptyState from "./GraphEmptyState";

describe("GraphEmptyState", () => {
  it("tells a never-projected repo which workflows build the graph", () => {
    render(<GraphEmptyState reason={{ kind: "never-projected" }} />);

    expect(screen.getByText(/No graph yet/).textContent).toMatch(
      /lore-ingest\.yml.*lore-tests\.yml/s,
    );
  });

  it("tells a tests-only repo its tests landed and that it has no specs to link them to", () => {
    render(
      <GraphEmptyState
        reason={{ kind: "tests-only", commit: "579d822ea5db" }}
      />,
    );

    expect(screen.getByText(/no specs or ADRs/).textContent).toMatch(
      /Tests were projected at 579d822.*no specs or ADRs/s,
    );
  });

  it("tells a docs-unlinked repo that no statement links to a test, code or ADR", () => {
    render(
      <GraphEmptyState
        reason={{ kind: "docs-unlinked", commit: "abc1234def" }}
      />,
    );

    expect(screen.getByText(/no statement/).textContent).toMatch(
      /projected at abc1234.*no statement links to a test, code or ADR/s,
    );
  });
});

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("./SpecGraphD3", () => ({
  default: ({
    repo,
    searchQuery,
    resetSignal,
  }: {
    repo: string;
    searchQuery: string;
    resetSignal: number;
  }) => (
    <div
      data-testid="spec-graph-d3"
      data-repo={repo}
      data-query={searchQuery}
      data-reset={resetSignal}
    />
  ),
}));

import GraphView from "./GraphView";

describe("GraphView", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("passes search queries and reset signals to SpecGraphD3 and clears the saved layout", () => {
    localStorage.setItem("lore.graph:o/r", "saved");

    render(<GraphView owner="o" repo="r" graph={{ nodes: [], links: [] }} />);

    const search = screen.getByLabelText("Search nodes");

    fireEvent.change(search, { target: { value: "auth" } });
    expect(screen.getByTestId("spec-graph-d3")).toHaveAttribute(
      "data-query",
      "auth",
    );

    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(screen.getByTestId("spec-graph-d3")).toHaveAttribute(
      "data-query",
      "",
    );
    expect(localStorage.getItem("lore.graph:o/r")).toBeNull();
  });
});

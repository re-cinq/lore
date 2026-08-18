// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import AssemblyRunListView from "./AssemblyRunListView";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ json: async () => ({}) })) as unknown as typeof fetch,
  );
});

describe("AssemblyRunListView", () => {
  it("renders the heading and the Create Task link", () => {
    render(<AssemblyRunListView runs={[]} />);

    expect(
      screen.getByRole("heading", { name: "Assembly Runs" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "+ Create Task" })).toHaveAttribute(
      "href",
      "/assembly-runs/create",
    );
  });

  it("marks All active and links the four run statuses when none is selected", () => {
    render(<AssemblyRunListView runs={[]} />);

    const all = screen.getByRole("link", { name: "All" });

    expect(all).toHaveClass("active");
    expect(screen.getByRole("link", { name: "Running" })).toHaveAttribute(
      "href",
      "/assembly-runs?status=running",
    );
    expect(screen.getByRole("link", { name: "Finished" })).toHaveAttribute(
      "href",
      "/assembly-runs?status=finished",
    );
  });

  it("marks the selected status filter active", () => {
    render(<AssemblyRunListView activeStatus="failed" runs={[]} />);

    expect(screen.getByRole("link", { name: "Failed" })).toHaveClass("active");
    expect(screen.getByRole("link", { name: "All" })).not.toHaveClass("active");
  });
});

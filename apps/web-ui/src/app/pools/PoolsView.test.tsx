// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import PoolsView, { PoolRow } from "./PoolsView";

const makePool = (overrides: Partial<PoolRow> = {}): PoolRow => ({
  id: "pool-1",
  name: "platform-knowledge",
  created_by: "agent-abcdef0123456789",
  created_at: "2026-06-01T12:00:00.000Z",
  entry_count: 42,
  agent_count: 5,
  ...overrides,
});

describe("PoolsView", () => {
  it("renders heading and column headers", () => {
    render(<PoolsView pools={[]} />);
    expect(
      screen.getByRole("heading", { name: "Shared Memory Pools" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Pool Name")).toBeInTheDocument();
    expect(screen.getByText("Entries")).toBeInTheDocument();
    expect(screen.getByText("Contributing Agents")).toBeInTheDocument();
    expect(screen.getByText("Created By")).toBeInTheDocument();
    expect(screen.getByText("Created")).toBeInTheDocument();
  });

  it("renders empty state row when no pools", () => {
    render(<PoolsView pools={[]} />);
    expect(screen.getByText("No shared pools yet")).toBeInTheDocument();
  });

  it("renders pool name as a link to the encoded pool page", () => {
    render(<PoolsView pools={[makePool({ name: "team alpha/beta" })]} />);
    const link = screen.getByRole("link", { name: "team alpha/beta" });
    expect(link).toHaveAttribute("href", "/pools/team%20alpha%2Fbeta");
  });

  it("renders entry and agent counts", () => {
    render(
      <PoolsView pools={[makePool({ entry_count: 42, agent_count: 5 })]} />,
    );
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("keeps a readable created_by whole with the full value in title", () => {
    render(
      <PoolsView
        pools={[makePool({ created_by: "agent-abcdef0123456789" })]}
      />,
    );
    const cell = screen.getByText("agent-abcdef0123456789");
    expect(cell).toHaveAttribute("title", "agent-abcdef0123456789");
  });

  it("truncates an opaque hex created_by with the full value in title", () => {
    render(
      <PoolsView pools={[makePool({ created_by: "abcdef0123456789" })]} />,
    );
    const cell = screen.getByText("abcdef01…");
    expect(cell).toHaveAttribute("title", "abcdef0123456789");
  });

  it("renders created_at as a localized date string", () => {
    const created_at = "2026-06-01T12:00:00.000Z";
    render(<PoolsView pools={[makePool({ created_at })]} />);
    expect(
      screen.getByText(new Date(created_at).toLocaleString()),
    ).toBeInTheDocument();
  });

  it("renders one row per pool and no empty state when populated", () => {
    render(
      <PoolsView
        pools={[
          makePool({ id: "pool-1", name: "alpha" }),
          makePool({ id: "pool-2", name: "beta" }),
        ]}
      />,
    );
    expect(screen.getByRole("link", { name: "alpha" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "beta" })).toBeInTheDocument();
    expect(screen.queryByText("No shared pools yet")).not.toBeInTheDocument();
  });
});

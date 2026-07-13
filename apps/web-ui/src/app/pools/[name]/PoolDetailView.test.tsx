// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import PoolDetailView, { PoolEntryRow } from "./PoolDetailView";

const shortEntry: PoolEntryRow = {
  id: "entry-1",
  key: "deployment-gotchas",
  value: "always set the env var",
  agent_id: "agent-abcdef-1234567890",
  version: 2,
  created_at: "2026-06-01T10:00:00.000Z",
};

const longValue = "x".repeat(250);
const longEntry: PoolEntryRow = {
  id: "entry-2",
  key: "big-blob",
  value: longValue,
  agent_id: "short",
  version: 1,
  created_at: "2026-06-02T12:00:00.000Z",
};

describe("PoolDetailView", () => {
  it("renders not found state with breadcrumb and message when not found", () => {
    render(
      <PoolDetailView
        poolName="ghost-pool"
        found={false}
        createdBy=""
        createdAt=""
        entries={[]}
      />,
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Pool Not Found",
    );
    expect(
      screen.getByText('No pool named "ghost-pool" exists.'),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Pools" })).toHaveAttribute(
      "href",
      "/pools",
    );
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("renders pool name heading, breadcrumb and truncated creator with plural entry count", () => {
    render(
      <PoolDetailView
        poolName="team-pool"
        found={true}
        createdBy="creator-id-very-long-value"
        createdAt="2026-06-01T08:00:00.000Z"
        entries={[shortEntry, longEntry]}
      />,
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "team-pool",
    );
    expect(screen.getByRole("link", { name: "Pools" })).toHaveAttribute(
      "href",
      "/pools",
    );
    expect(
      screen.getByText(/Created by creator-id-v\.\.\. on/),
    ).toBeInTheDocument();
    expect(screen.getByText(/· 2 entries$/)).toBeInTheDocument();
  });

  it("renders short value verbatim and truncates value over 200 chars with ellipsis", () => {
    render(
      <PoolDetailView
        poolName="team-pool"
        found={true}
        createdBy="creator"
        createdAt="2026-06-01T08:00:00.000Z"
        entries={[shortEntry, longEntry]}
      />,
    );
    const table = screen.getByRole("table");

    expect(
      within(table).getByText("always set the env var"),
    ).toBeInTheDocument();
    expect(
      within(table).getByText("x".repeat(200) + "..."),
    ).toBeInTheDocument();
    expect(within(table).queryByText(longValue)).not.toBeInTheDocument();
  });

  it("renders key, truncated agent id with title, version prefix and short untruncated agent id", () => {
    render(
      <PoolDetailView
        poolName="team-pool"
        found={true}
        createdBy="creator"
        createdAt="2026-06-01T08:00:00.000Z"
        entries={[shortEntry, longEntry]}
      />,
    );
    const table = screen.getByRole("table");

    expect(within(table).getByText("deployment-gotchas")).toBeInTheDocument();
    expect(within(table).getByText("big-blob")).toBeInTheDocument();
    expect(within(table).getByText("agent-ab...")).toBeInTheDocument();
    expect(within(table).getByText("agent-ab...")).toHaveAttribute(
      "title",
      "agent-abcdef-1234567890",
    );
    expect(within(table).getByText("short...")).toBeInTheDocument();
    expect(within(table).getByText("v2")).toBeInTheDocument();
    expect(within(table).getByText("v1")).toBeInTheDocument();
  });

  it("renders singular entry word when exactly one entry", () => {
    render(
      <PoolDetailView
        poolName="solo"
        found={true}
        createdBy="creator"
        createdAt="2026-06-01T08:00:00.000Z"
        entries={[shortEntry]}
      />,
    );
    expect(screen.getByText(/· 1 entry$/)).toBeInTheDocument();
  });

  it("renders empty entries row and plural word when found pool has zero entries", () => {
    render(
      <PoolDetailView
        poolName="empty-pool"
        found={true}
        createdBy="creator"
        createdAt="2026-06-01T08:00:00.000Z"
        entries={[]}
      />,
    );
    expect(screen.getByText("No entries in this pool")).toBeInTheDocument();
    expect(screen.getByText(/· 0 entries$/)).toBeInTheDocument();
  });
});

// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import AuditView, { type AuditEntryRow } from "./AuditView";
import { formatEnumLabel } from "@/lib/enum-label";

const OPERATIONS = [
  "write",
  "read",
  "search",
  "delete",
  "snapshot",
  "restore",
  "shared_write",
  "shared_read",
  "list",
];

const row = (over: Partial<AuditEntryRow>): AuditEntryRow => ({
  id: "row-1",
  agent_id: "abcdef0123456789",
  operation: "write",
  memory_key: "deploy-notes",
  pool_name: "team-pool",
  metadata: { ttl: 3600 },
  created_at: "2026-06-04T10:00:00.000Z",
  ...over,
});

describe("AuditView", () => {
  it("renders one table row per entry with truncated agent and operation badge", () => {
    const { container } = render(
      <AuditView
        entries={[
          row({ id: "a", agent_id: "abcdef0123456789", operation: "write" }),
          row({
            id: "b",
            agent_id: "99887766aabbccdd",
            operation: "read",
            memory_key: "k2",
          }),
        ]}
        totalCount={2}
        operations={OPERATIONS}
        offset={0}
        pageSize={50}
        hasPrev={false}
        hasNext={false}
      />,
    );
    expect(screen.getByText("abcdef01…")).toBeInTheDocument();
    expect(screen.getByText("99887766…")).toBeInTheDocument();
    expect(
      container.querySelector('td[title="abcdef0123456789"]'),
    ).toBeInTheDocument();
    const writeBadge = container.querySelector(".op-badge.op-write");
    expect(writeBadge).toBeInTheDocument();
    expect(writeBadge).toHaveTextContent("Write");
    expect(container.querySelector(".op-badge.op-read")).toBeInTheDocument();
    expect(container.querySelectorAll("tbody tr")).toHaveLength(2);
  });

  it("renders the key, pool and stringified metadata cells when present", () => {
    const { container } = render(
      <AuditView
        entries={[
          row({
            memory_key: "deploy-notes",
            pool_name: "team-pool",
            metadata: { ttl: 3600 },
          }),
        ]}
        totalCount={1}
        operations={OPERATIONS}
        offset={0}
        pageSize={50}
        hasPrev={false}
        hasNext={false}
      />,
    );
    expect(screen.getByText("deploy-notes")).toBeInTheDocument();
    expect(screen.getByText("team-pool")).toBeInTheDocument();
    expect(screen.getByText("view")).toBeInTheDocument();
    expect(container.querySelector("details pre")?.textContent).toContain(
      '"ttl": 3600',
    );
  });

  it("falls back to an em-dash for null key, null pool and null metadata", () => {
    render(
      <AuditView
        entries={[row({ memory_key: null, pool_name: null, metadata: null })]}
        totalCount={1}
        operations={OPERATIONS}
        offset={0}
        pageSize={50}
        hasPrev={false}
        hasNext={false}
      />,
    );
    expect(screen.getAllByText("—")).toHaveLength(3);
  });

  it("renders full metadata as collapsible pretty-printed JSON", () => {
    const big = { description: "x".repeat(200) };
    const { container } = render(
      <AuditView
        entries={[row({ metadata: big })]}
        totalCount={1}
        operations={OPERATIONS}
        offset={0}
        pageSize={50}
        hasPrev={false}
        hasNext={false}
      />,
    );
    expect(screen.getByText("view")).toBeInTheDocument();
    const pre = container.querySelector("details pre");
    expect(pre?.textContent).toContain('"description"');
    expect(pre?.textContent).toContain("x".repeat(200));
  });

  it("shows the empty state when there are no entries", () => {
    const { container } = render(
      <AuditView
        entries={[]}
        totalCount={0}
        operations={OPERATIONS}
        offset={0}
        pageSize={50}
        hasPrev={false}
        hasNext={false}
      />,
    );
    expect(screen.getByText("No activity recorded yet")).toBeInTheDocument();
    expect(container.querySelector('td[colspan="6"]')).toBeInTheDocument();
  });

  it("shows the no-matches state, not first-run, on an out-of-range page of a populated log", () => {
    render(
      <AuditView
        entries={[]}
        totalCount={60}
        operations={OPERATIONS}
        offset={100}
        pageSize={50}
        hasPrev={true}
        hasNext={false}
      />,
    );
    expect(screen.queryByText("No activity recorded yet")).toBeNull();
    expect(
      screen.getByText("No entries match these filters"),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Clear filters" })).toHaveAttribute(
      "href",
      "/audit",
    );
  });

  it("renders the operations filter dropdown with all options plus the all-operations default", () => {
    render(
      <AuditView
        entries={[]}
        totalCount={0}
        operations={OPERATIONS}
        offset={0}
        pageSize={50}
        hasPrev={false}
        hasNext={false}
      />,
    );
    expect(
      screen.getByRole("option", { name: "All operations" }),
    ).toBeInTheDocument();
    OPERATIONS.forEach((o) => {
      expect(
        screen.getByRole("option", { name: formatEnumLabel(o) }),
      ).toBeInTheDocument();
    });
  });

  it("seeds the filter inputs from the current agent and op values", () => {
    const { container } = render(
      <AuditView
        entries={[]}
        totalCount={0}
        operations={OPERATIONS}
        agent="abcdef0123456789"
        op="search"
        offset={0}
        pageSize={50}
        hasPrev={false}
        hasNext={false}
      />,
    );
    expect(container.querySelector('input[name="agent"]')).toHaveValue(
      "abcdef0123456789",
    );
    expect(container.querySelector('select[name="op"]')).toHaveValue("search");
  });

  it("disables both pagination links on a single full-of-results first page", () => {
    const { container } = render(
      <AuditView
        entries={[row({})]}
        totalCount={1}
        operations={OPERATIONS}
        offset={0}
        pageSize={50}
        hasPrev={false}
        hasNext={false}
      />,
    );
    const links = container.querySelectorAll(".pagination a");
    expect(links).toHaveLength(2);
    links.forEach((a) => expect(a).toHaveClass("disabled"));
    expect(screen.getByText("1 of 1", { exact: false })).toBeInTheDocument();
  });

  it("enables both pagination links and preserves filters in their hrefs on a middle page", () => {
    const { container } = render(
      <AuditView
        entries={[row({})]}
        totalCount={200}
        operations={OPERATIONS}
        agent="abcdef0123456789"
        op="search"
        offset={50}
        pageSize={50}
        hasPrev={true}
        hasNext={true}
      />,
    );
    const prev = screen.getByRole("link", { name: /Previous/ });
    const next = screen.getByRole("link", { name: /Next/ });
    expect(prev).not.toHaveClass("disabled");
    expect(next).not.toHaveClass("disabled");
    // offset 0 omits the offset param; filters preserved
    expect(prev).toHaveAttribute(
      "href",
      "/audit?agent=abcdef0123456789&op=search",
    );
    expect(next).toHaveAttribute(
      "href",
      "/audit?agent=abcdef0123456789&op=search&offset=100",
    );
    expect(container.querySelector(".page-info")).toHaveTextContent(
      "51–100 of 200",
    );
  });

  it("builds bare pagination hrefs with no filters applied", () => {
    render(
      <AuditView
        entries={[row({})]}
        totalCount={200}
        operations={OPERATIONS}
        offset={50}
        pageSize={50}
        hasPrev={true}
        hasNext={true}
      />,
    );
    expect(screen.getByRole("link", { name: /Previous/ })).toHaveAttribute(
      "href",
      "/audit",
    );
    expect(screen.getByRole("link", { name: /Next/ })).toHaveAttribute(
      "href",
      "/audit?offset=100",
    );
  });
});

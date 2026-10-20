// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import AuditView, { type AuditEntryRow } from "./AuditView";
import { formatEnumLabel } from "@/lib/enum-label";

vi.mock("@/components/Icon", () => ({
  default: () => <i aria-hidden="true" />,
}));

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
  it("renders one row per entry with truncated agent and operation badge", () => {
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
      container.querySelector('[title="abcdef0123456789"]'),
    ).toBeInTheDocument();
    const writeBadge = container.querySelector(".op-badge.op-write");

    expect(writeBadge).toBeInTheDocument();
    expect(writeBadge).toHaveTextContent("Write");
    expect(container.querySelector(".op-badge.op-read")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
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
    expect(container.querySelector("details pre")?.textContent).toContain(
      '"ttl": 3600',
    );
  });

  it("falls back to an em-dash for null key and pool, and nothing to open for null metadata", () => {
    const { container } = render(
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

    expect(screen.getAllByText("—")).toHaveLength(2);
    expect(container.querySelector("details")).toBeNull();
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

    expect(container.querySelector("details summary")).toBeInTheDocument();
    const pre = container.querySelector("details pre");

    expect(pre?.textContent).toContain('"description"');
    expect(pre?.textContent).toContain("x".repeat(200));
  });

  it("shows the empty state when there are no entries", () => {
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

    expect(screen.getByText("No activity recorded yet")).toBeInTheDocument();
    expect(screen.queryByRole("listitem")).toBeNull();
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

  it("renders an operation chip per operation plus All, which is current with no op filter", () => {
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
    const chips = within(screen.getByRole("navigation", { name: "Operation" }));

    expect(chips.getByRole("link", { name: "All" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(chips.getAllByRole("link").map((a) => a.textContent)).toEqual(
      ["All"].concat(OPERATIONS.map(formatEnumLabel)),
    );
    expect(chips.getByRole("link", { name: "Read" })).toHaveAttribute(
      "href",
      "/audit?op=read",
    );
  });

  it("seeds the agent search from the current agent, keeps the op, and marks its chip current", () => {
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
    expect(container.querySelector('input[name="op"]')).toHaveValue("search");
    expect(screen.getByRole("link", { name: "Search" })).toHaveAttribute(
      "href",
      "/audit?agent=abcdef0123456789&op=search",
    );
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

    expect(container.querySelector(".page-info")).toHaveTextContent(
      "51–100 of 200",
    );
    expect(prev).not.toHaveClass("disabled");
    expect(next).not.toHaveClass("disabled");
    expect(prev).toHaveAttribute(
      "href",
      "/audit?agent=abcdef0123456789&op=search",
    );
    expect(next).toHaveAttribute(
      "href",
      "/audit?agent=abcdef0123456789&op=search&offset=100",
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

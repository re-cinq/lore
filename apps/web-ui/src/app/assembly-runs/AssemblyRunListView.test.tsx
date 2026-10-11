// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { AssemblyRun } from "@/lib/assembly-run-rows";
import AssemblyRunListView from "./AssemblyRunListView";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ json: async () => ({}) })) as unknown as typeof fetch,
  );
});

describe("AssemblyRunListView", () => {
  it("renders the heading and offers no way to create a task", () => {
    render(<AssemblyRunListView runs={[]} />);

    expect(
      screen.getByRole("heading", { name: "Assembly Runs" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Create Task/ })).toBeNull();
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

const listedRun: AssemblyRun = {
  id: "run-1",
  blueprintName: "code-review",
  graph: null,
  taskId: null,
  repo: "re-cinq/lore",
  branch: null,
  status: "running",
  outcome: null,
  reason: null,
  createdAt: "2026-10-02T09:00:00Z",
  startedAt: null,
  durationSeconds: null,
  prUrl: null,
  prNumber: null,
  issueUrl: null,
  issueNumber: null,
  createdBy: null,
  costUsd: null,
};

describe("AssemblyRunListView paging and columns", () => {
  const pageLinkHrefs = () => ({
    newest: screen
      .queryByRole("link", { name: "Newest" })
      ?.getAttribute("href"),
    older: screen.queryByRole("link", { name: "Older" })?.getAttribute("href"),
  });

  it("links Older and Newest at the failed status when a cursor and a next cursor are given", () => {
    render(
      <AssemblyRunListView
        activeStatus="failed"
        cursor="page-2"
        nextCursor="page-3"
        runs={[]}
      />,
    );

    expect(pageLinkHrefs()).toEqual({
      newest: "/assembly-runs?status=failed",
      older: "/assembly-runs?status=failed&cursor=page-3",
    });
  });

  it("shows neither Older nor Newest without a cursor or a next cursor", () => {
    render(<AssemblyRunListView runs={[]} />);

    expect(pageLinkHrefs()).toEqual({ newest: undefined, older: undefined });
  });

  it("has a Stages column header", () => {
    render(<AssemblyRunListView runs={[listedRun]} />);

    expect(screen.getByRole("columnheader", { name: "Stages" })).toBeVisible();
  });
});

describe("AssemblyRunListView under another base path", () => {
  it("points the Running filter, Newest and Older links under the repository's tab", () => {
    render(
      <AssemblyRunListView
        basePath="/repos/re-cinq/lore/tasks"
        activeStatus="failed"
        cursor="page-2"
        nextCursor="page-3"
        runs={[]}
      />,
    );

    expect({
      running: screen
        .getByRole("link", { name: "Running" })
        .getAttribute("href"),
      newest: screen.getByRole("link", { name: "Newest" }).getAttribute("href"),
      older: screen.getByRole("link", { name: "Older" }).getAttribute("href"),
    }).toEqual({
      running: "/repos/re-cinq/lore/tasks?status=running",
      newest: "/repos/re-cinq/lore/tasks?status=failed",
      older: "/repos/re-cinq/lore/tasks?status=failed&cursor=page-3",
    });
  });
});

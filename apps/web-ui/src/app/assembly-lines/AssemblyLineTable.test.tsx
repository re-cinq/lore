// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import AssemblyLineTable from "./AssemblyLineTable";
import {
  groupTasksIntoAssemblyLines,
  type AssemblyLineTaskRow,
} from "@/lib/assembly-lines";

const taskRow = (over: Partial<AssemblyLineTaskRow>): AssemblyLineTaskRow => ({
  id: "task-abcd1234",
  description: "Implement the widget end to end",
  task_type: "implementation",
  status: "running",
  priority: "normal",
  target_repo: "re-cinq/lore",
  agent_id: "agent-abc",
  pr_url: null,
  pr_number: null,
  target_branch: null,
  parent_task_id: null,
  retry_of: null,
  created_by: "bogdan",
  created_at: "2026-06-01T12:00:00.000Z",
  updated_at: "2026-06-01T12:00:00.000Z",
  ...over,
});

const group = (...rows: AssemblyLineTaskRow[]) =>
  groupTasksIntoAssemblyLines(rows);

describe("AssemblyLineTable", () => {
  it("renders the empty-state row when there are no runs", () => {
    render(<AssemblyLineTable runs={[]} />);
    expect(screen.getByText("No assembly lines yet")).toBeInTheDocument();
  });

  it("links the empty-state CTA to the global create page by default", () => {
    render(<AssemblyLineTable runs={[]} />);
    expect(screen.getByRole("link", { name: "Create a task" })).toHaveAttribute(
      "href",
      "/assembly-lines/create",
    );
  });

  it("points the empty-state CTA at createHref when given", () => {
    render(
      <AssemblyLineTable
        runs={[]}
        createHref="/repos/re-cinq/lore/tasks/create"
      />,
    );
    expect(screen.getByRole("link", { name: "Create a task" })).toHaveAttribute(
      "href",
      "/repos/re-cinq/lore/tasks/create",
    );
  });

  it("shows the no-matches empty state with a clear link when filtered", () => {
    render(<AssemblyLineTable runs={[]} filtered />);
    expect(screen.getByText("No matches for this filter")).toBeInTheDocument();
    expect(screen.queryByText("No assembly lines yet")).toBeNull();
    expect(screen.getByRole("link", { name: "Clear filter" })).toHaveAttribute(
      "href",
      "/assembly-lines",
    );
  });

  it("renders a singleton run as one row with a single-stage mini-graph linking to the lead", () => {
    const runs = group(
      taskRow({
        id: "task-abcd1234",
        status: "running",
        target_branch: "lore/x",
        pr_url: "https://gh/pr/3",
        pr_number: 3,
      }),
    );

    render(<AssemblyLineTable runs={runs} />);

    expect(screen.getAllByTestId("al-stage")).toHaveLength(1);
    expect(screen.getByRole("link", { name: "#task-abc" })).toHaveAttribute(
      "href",
      "/assembly-lines/task-abcd1234",
    );
    expect(screen.getByRole("link", { name: "re-cinq/lore" })).toHaveAttribute(
      "href",
      "/repos/re-cinq/lore",
    );
    expect(screen.getByText("lore/x")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "#3" })).toHaveAttribute(
      "href",
      "https://gh/pr/3",
    );
  });

  it("rolls the status up — an in-flight member reads as Running", () => {
    const impl = taskRow({
      id: "impl",
      status: "merged",
      target_branch: "lore/y",
      created_at: "2026-06-01T10:00:00.000Z",
    });
    const review = taskRow({
      id: "review",
      task_type: "review",
      status: "running",
      parent_task_id: "impl",
      target_branch: "lore/y",
      created_at: "2026-06-01T11:00:00.000Z",
    });

    render(<AssemblyLineTable runs={group(review, impl)} />);
    // The member's stage badge also reads "Running" now — scope to the roll-up.
    expect(
      within(screen.getByRole("table")).getByText("Running", {
        selector: '[class*="ciIcon"]',
      }),
    ).toBeInTheDocument();
  });

  it("renders one stage dot per member with a dropdown link to each member", () => {
    const impl = taskRow({
      id: "impl-aaaa",
      status: "merged",
      target_branch: "lore/y",
      created_at: "2026-06-01T10:00:00.000Z",
    });
    const review = taskRow({
      id: "review-bbbb",
      task_type: "review",
      status: "running",
      parent_task_id: "impl-aaaa",
      target_branch: "lore/y",
      created_at: "2026-06-01T11:00:00.000Z",
    });
    const { container } = render(
      <AssemblyLineTable runs={group(review, impl)} />,
    );

    expect(screen.getAllByTestId("al-stage")).toHaveLength(2);
    expect(
      container.querySelector('a[href="/assembly-lines/impl-aaaa"]'),
    ).toBeTruthy();
    expect(
      container.querySelector('a[href="/assembly-lines/review-bbbb"]'),
    ).toBeTruthy();
  });

  it("renders a Run Now POST form when the lead task is pending", () => {
    render(
      <AssemblyLineTable
        runs={group(taskRow({ id: "p1", status: "pending" }))}
      />,
    );
    const form = screen
      .getByRole("button", { name: "Run Now" })
      .closest("form");

    expect(form).toHaveAttribute("action", "/api/assembly-lines/p1/run-now");
    expect(form).toHaveAttribute("method", "POST");
  });

  it("renders an Open PR link only when the run has a PR url", () => {
    render(
      <AssemblyLineTable
        runs={group(taskRow({ pr_url: "https://gh/pr/9", pr_number: 9 }))}
      />,
    );
    expect(screen.getByRole("link", { name: "Open PR" })).toHaveAttribute(
      "href",
      "https://gh/pr/9",
    );
  });

  it('renders the PR badge as plain "PR" and no status pill when pr_number is absent', () => {
    const { container } = render(
      <AssemblyLineTable
        runs={group(taskRow({ pr_url: "https://gh/pr/x", pr_number: null }))}
      />,
    );

    expect(screen.getByRole("link", { name: "PR" })).toHaveAttribute(
      "href",
      "https://gh/pr/x",
    );
    expect(container.querySelector(".status-pill")).toBeNull();
  });

  it("omits the repo link when the run has no target repo", () => {
    render(
      <AssemblyLineTable
        runs={group(taskRow({ target_repo: "", pr_url: null }))}
      />,
    );
    expect(
      screen.queryByRole("link", { name: "re-cinq/lore" }),
    ).not.toBeInTheDocument();
  });

  it("shows uppercase initials for the creator", () => {
    render(
      <AssemblyLineTable
        runs={group(taskRow({ created_by: "review-agent" }))}
      />,
    );
    expect(screen.getByText("RE")).toBeInTheDocument();
  });

  it("falls back to an em dash when the creator is blank", () => {
    render(<AssemblyLineTable runs={group(taskRow({ created_by: "" }))} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("renders a Cost column summing member costs when showCost is set", () => {
    const impl = taskRow({
      id: "impl",
      target_branch: "lore/z",
      cost_usd: 0.1,
      created_at: "2026-06-01T10:00:00.000Z",
    });
    const review = taskRow({
      id: "review",
      target_branch: "lore/z",
      parent_task_id: "impl",
      cost_usd: 0.2,
      created_at: "2026-06-01T11:00:00.000Z",
    });

    render(<AssemblyLineTable runs={group(review, impl)} showCost />);
    expect(screen.getByText("Cost")).toBeInTheDocument();
    expect(screen.getByText("$0.3000")).toBeInTheDocument();
  });

  it("omits the Cost column by default", () => {
    render(<AssemblyLineTable runs={group(taskRow({ cost_usd: 0.5 }))} />);
    expect(screen.queryByText("Cost")).not.toBeInTheDocument();
  });
});

// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import AnalyticsView, {
  type AnalyticsViewProps,
  type TaskSummary,
  type LatencyStats,
  type UsageByTaskType,
  type UsageByRepo,
  type DailyUsage,
  type JobRun,
} from "./AnalyticsView";

const taskSummary: TaskSummary = {
  total: 1234,
  succeeded: 1000,
  failed: 34,
  active: 200,
};

const latencyStats: LatencyStats[] = [
  {
    tool: "search_memory",
    call_count: 5000,
    p50_ms: 12.4,
    p95_ms: 350.9,
    p99_ms: 800.2,
  },
  {
    tool: "assemble_context",
    call_count: 99,
    p50_ms: 8.1,
    p95_ms: 150.5,
    p99_ms: 190.0,
  },
];

const usageByTaskType: UsageByTaskType[] = [
  {
    task_type: "implementation",
    task_count: 42,
    total_input_tokens: 1500000,
    total_output_tokens: 250000,
  },
  {
    task_type: "review",
    task_count: 7,
    total_input_tokens: 300,
    total_output_tokens: 90,
  },
];

const usageByRepo: UsageByRepo[] = [
  { target_repo: "re-cinq/lore", task_count: 88 },
  { target_repo: "re-cinq/other", task_count: 3 },
];

const dailyUsage: DailyUsage[] = [
  {
    day: "2026-06-03",
    calls: 4200,
    input_tokens: 9000000,
    output_tokens: 1200000,
  },
  { day: "2026-06-02", calls: 12, input_tokens: 40, output_tokens: 9 },
];

const jobRuns: JobRun[] = [
  {
    id: "job-secs",
    job_name: "auto-merge",
    started_at: "2026-06-03T10:00:00.000Z",
    completed_at: "2026-06-03T10:00:42.000Z",
    status: "completed",
    result_summary: "merged 3 PRs",
    error: null,
    log_path: "gs://logs/job-secs",
  },
  {
    id: "job-mins",
    job_name: "lease-reaper",
    started_at: "2026-06-03T11:00:00.000Z",
    completed_at: "2026-06-03T11:05:00.000Z",
    status: "failed",
    result_summary: "ignored",
    error: "boom",
    log_path: null,
  },
  {
    id: "job-running",
    job_name: "baseline",
    started_at: "2026-06-03T12:00:00.000Z",
    completed_at: null,
    status: "running",
    result_summary: null,
    error: null,
    log_path: null,
  },
];

const fullProps: AnalyticsViewProps = {
  taskSummary,
  latencyStats,
  usageByTaskType,
  usageByRepo,
  dailyUsage,
  jobRuns,
};

describe("AnalyticsView", () => {
  it("renders all six section headings", () => {
    render(<AnalyticsView {...fullProps} />);
    expect(
      screen.getByRole("heading", { level: 1, name: "Analytics" }),
    ).toBeInTheDocument();
    [
      "Task Summary",
      "Retrieval Performance (Last 7 Days)",
      "Usage by Task Type",
      "Tasks by Repo",
      "Daily Usage (Last 14 Days)",
      "Recent Job Runs",
    ].forEach((name) => {
      expect(
        screen.getByRole("heading", { level: 2, name }),
      ).toBeInTheDocument();
    });
  });

  it("renders the four task-summary stat cards with locale-formatted numbers", () => {
    const { container } = render(<AnalyticsView {...fullProps} />);

    expect(screen.getByText("Total Tasks")).toBeInTheDocument();
    expect(screen.getByText("1,234")).toBeInTheDocument();
    expect(screen.getByText("Succeeded")).toBeInTheDocument();
    expect(screen.getByText("1,000")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("34")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("200")).toBeInTheDocument();
    expect(container.querySelectorAll(".spec-card")).toHaveLength(4);
  });

  it("falls back to zero on every stat card when task summary is null", () => {
    render(<AnalyticsView {...fullProps} taskSummary={null} />);
    expect(screen.getAllByText("0")).toHaveLength(4);
  });

  it("renders the latency table with mono p-values and a >200ms delete badge when p95 exceeds 200", () => {
    render(<AnalyticsView {...fullProps} />);
    const table = screen.getAllByRole("table")[0];
    const slow = within(table).getByText("search_memory").closest("tr")!;

    expect(within(slow).getByText("5,000")).toBeInTheDocument();
    expect(within(slow).getByText("12ms")).toBeInTheDocument();
    expect(within(slow).getByText("351ms")).toBeInTheDocument();
    expect(within(slow).getByText("800ms")).toBeInTheDocument();
    const badge = within(slow).getByText(">200ms");

    expect(badge).toHaveClass("op-badge", "op-delete");
  });

  it("renders an OK write badge when p95 is at or under 200ms", () => {
    render(<AnalyticsView {...fullProps} />);
    const table = screen.getAllByRole("table")[0];
    const fast = within(table).getByText("assemble_context").closest("tr")!;
    const badge = within(fast).getByText("OK");

    expect(badge).toHaveClass("op-badge", "op-write");
  });

  it("renders the empty-latency message when there are no latency stats", () => {
    const { container } = render(
      <AnalyticsView {...fullProps} latencyStats={[]} />,
    );

    expect(screen.getByText(/No latency data yet/)).toBeInTheDocument();
    expect(container.querySelector('td[colspan="6"]')).toBeInTheDocument();
  });

  it("renders usage-by-task-type rows with locale-formatted token counts", () => {
    render(<AnalyticsView {...fullProps} />);
    const table = screen.getAllByRole("table")[1];
    const impl = within(table).getByText("implementation").closest("tr")!;

    expect(within(impl).getByText("42")).toBeInTheDocument();
    expect(within(impl).getByText("1,500,000")).toBeInTheDocument();
    expect(within(impl).getByText("250,000")).toBeInTheDocument();
  });

  it("renders the empty-usage message when there are no task-type rows", () => {
    render(<AnalyticsView {...fullProps} usageByTaskType={[]} />);
    const table = screen.getAllByRole("table")[1];

    expect(within(table).getByText("No data")).toBeInTheDocument();
  });

  it("renders tasks-by-repo rows with repo path and count", () => {
    render(<AnalyticsView {...fullProps} />);
    const table = screen.getAllByRole("table")[2];
    const repo = within(table).getByText("re-cinq/lore").closest("tr")!;

    expect(within(repo).getByText("88")).toBeInTheDocument();
  });

  it("renders the empty-repo message when there are no repo rows", () => {
    const { container } = render(
      <AnalyticsView {...fullProps} usageByRepo={[]} />,
    );

    expect(container.querySelector('td[colspan="2"]')).toBeInTheDocument();
  });

  it("renders daily-usage rows with formatted dates and token counts", () => {
    render(<AnalyticsView {...fullProps} />);
    const table = screen.getAllByRole("table")[3];
    const day = within(table)
      .getByText(new Date("2026-06-03").toLocaleDateString())
      .closest("tr")!;

    expect(within(day).getByText("4,200")).toBeInTheDocument();
    expect(within(day).getByText("9,000,000")).toBeInTheDocument();
    expect(within(day).getByText("1,200,000")).toBeInTheDocument();
  });

  it("renders the empty-daily message when there is no daily usage", () => {
    render(<AnalyticsView {...fullProps} dailyUsage={[]} />);
    const table = screen.getAllByRole("table")[3];

    expect(within(table).getByText("No data")).toBeInTheDocument();
  });

  it("renders job runs with seconds duration, result summary and a logs view link", () => {
    render(<AnalyticsView {...fullProps} />);
    const table = screen.getAllByRole("table")[4];
    const row = within(table).getByText("auto-merge").closest("tr")!;

    expect(within(row).getByText("42s")).toBeInTheDocument();
    expect(within(row).getByText("merged 3 PRs")).toBeInTheDocument();
    const statusBadge = within(row).getByText("completed");

    expect(statusBadge).toHaveClass("op-badge", "op-completed");
    const link = within(row).getByRole("link", { name: "view" });

    expect(link).toHaveAttribute("href", "/job-runs/job-secs");
  });

  it("renders a minutes duration and shows the error in place of the result when a job failed", () => {
    render(<AnalyticsView {...fullProps} />);
    const table = screen.getAllByRole("table")[4];
    const row = within(table).getByText("lease-reaper").closest("tr")!;

    expect(within(row).getByText("5m")).toBeInTheDocument();
    expect(within(row).getByText("boom")).toBeInTheDocument();
    expect(within(row).queryByText("ignored")).not.toBeInTheDocument();
    expect(within(row).getByText("failed")).toHaveClass(
      "op-badge",
      "op-failed",
    );
  });

  it("renders an em-dash duration, em-dash result and em-dash logs for a running job with no completion", () => {
    render(<AnalyticsView {...fullProps} />);
    const table = screen.getAllByRole("table")[4];
    const row = within(table).getByText("baseline").closest("tr")!;

    expect(within(row).queryByRole("link")).not.toBeInTheDocument();
    expect(within(row).getAllByText("—")).toHaveLength(3);
  });

  it("renders the empty job-runs message when there are no job runs", () => {
    render(<AnalyticsView {...fullProps} jobRuns={[]} />);
    const table = screen.getAllByRole("table")[4];

    expect(within(table).getByText("No job runs")).toBeInTheDocument();
  });

  it("renders every section in its empty state with a null summary and no rows", () => {
    render(
      <AnalyticsView
        taskSummary={null}
        latencyStats={[]}
        usageByTaskType={[]}
        usageByRepo={[]}
        dailyUsage={[]}
        jobRuns={[]}
      />,
    );
    expect(screen.getAllByText("0")).toHaveLength(4);
    expect(screen.getByText(/No latency data yet/)).toBeInTheDocument();
    expect(screen.getByText("No job runs")).toBeInTheDocument();
    expect(screen.getAllByText("No data")).toHaveLength(3);
  });
});

// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import PRStatusCard, { type PRDetails } from "./PRStatusCard";

vi.mock("@/components/Icon", () => ({
  default: ({ name }: { name: string }) => <i data-testid={`icon-${name}`} />,
}));

type Check = PRDetails["checks"][number];
type Review = PRDetails["reviews"][number];

const details = (over: Partial<PRDetails> = {}): PRDetails => ({
  number: 42,
  title: "Add the widget",
  state: "open",
  draft: false,
  merged: false,
  mergeable: true,
  html_url: "https://github.com/acme/repo/pull/42",
  checks: [],
  reviews: [],
  computed_status: "open",
  ...over,
});

const check = (over: Partial<Check> = {}): Check => ({
  name: "build",
  status: "completed",
  conclusion: "success",
  ...over,
});

const review = (over: Partial<Review> = {}): Review => ({
  user: "alice",
  state: "APPROVED",
  submitted_at: "2026-06-01T10:00:00Z",
  ...over,
});

describe("PRStatusCard", () => {
  it("renders the Loading placeholder when there are no details yet", () => {
    render(
      <PRStatusCard details={null} error={null} prUrl="https://gh/pr/1" />,
    );

    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(screen.getByText("PR Status:")).toBeInTheDocument();
  });

  it("shows the unavailable fallback when there is an error and no details", () => {
    render(
      <PRStatusCard
        details={null}
        error="Status unavailable"
        prUrl="https://example.com/pr/9"
      />,
    );

    expect(screen.getByText(/Status unavailable/)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "View on GitHub" });

    expect(link).toHaveAttribute("href", "https://example.com/pr/9");
    expect(link).toHaveAttribute("target", "_blank");
    expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
  });

  it("keeps rendering the loaded details even when a later error is present", () => {
    render(
      <PRStatusCard
        details={details({ number: 42, title: "Add the widget" })}
        error="rate limited"
        prUrl="https://gh/pr/1"
      />,
    );

    expect(screen.getByText("#42 Add the widget")).toBeInTheDocument();
    expect(screen.queryByText(/Status unavailable/)).not.toBeInTheDocument();
  });

  it("renders the computed status pill and a PR link", () => {
    render(
      <PRStatusCard
        details={details({
          computed_status: "open",
          number: 7,
          title: "My PR",
        })}
        error={null}
        prUrl="https://gh/pr/1"
      />,
    );

    expect(screen.getByText("open")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /#7 My PR/ });

    expect(link).toHaveAttribute(
      "href",
      "https://github.com/acme/repo/pull/42",
    );
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("applies the mapped pill color for a known computed status", () => {
    render(
      <PRStatusCard
        details={details({ computed_status: "merged" })}
        error={null}
        prUrl="https://gh/pr/1"
      />,
    );

    expect(screen.getByText("merged")).toHaveStyle({
      "--pill-color": "var(--accent)",
    });
  });

  it("falls back to the muted pill color for an unknown computed status", () => {
    render(
      <PRStatusCard
        details={details({
          computed_status: "mystery-state" as PRDetails["computed_status"],
        })}
        error={null}
        prUrl="https://gh/pr/1"
      />,
    );

    expect(screen.getByText("mystery-state")).toHaveStyle({
      "--pill-color": "var(--text-muted)",
    });
  });

  it("omits the checks row when there are no checks", () => {
    render(
      <PRStatusCard
        details={details({ checks: [] })}
        error={null}
        prUrl="https://gh/pr/1"
      />,
    );

    expect(screen.queryByText("Checks:")).not.toBeInTheDocument();
  });

  it("counts passing checks from success and skipped conclusions", () => {
    render(
      <PRStatusCard
        details={details({
          checks: [
            check({ name: "a", conclusion: "success" }),
            check({ name: "b", conclusion: "skipped" }),
          ],
        })}
        error={null}
        prUrl="https://gh/pr/1"
      />,
    );

    expect(screen.getByText("Checks:")).toBeInTheDocument();
    expect(screen.getByText(/2 passing/)).toBeInTheDocument();
    expect(screen.getByTestId("icon-check")).toBeInTheDocument();
    expect(screen.queryByText(/failing/)).not.toBeInTheDocument();
    expect(screen.queryByText(/pending/)).not.toBeInTheDocument();
  });

  it("counts failing checks from failure and timed_out conclusions", () => {
    render(
      <PRStatusCard
        details={details({
          checks: [
            check({ name: "a", conclusion: "failure" }),
            check({ name: "b", conclusion: "timed_out" }),
          ],
        })}
        error={null}
        prUrl="https://gh/pr/1"
      />,
    );

    expect(screen.getByText(/2 failing/)).toBeInTheDocument();
    expect(screen.getByTestId("icon-error")).toBeInTheDocument();
    expect(screen.queryByText(/passing/)).not.toBeInTheDocument();
  });

  it("counts pending checks from any non-completed status", () => {
    render(
      <PRStatusCard
        details={details({
          checks: [
            check({ name: "a", status: "in_progress", conclusion: null }),
          ],
        })}
        error={null}
        prUrl="https://gh/pr/1"
      />,
    );

    expect(screen.getByText(/1 pending/)).toBeInTheDocument();
    expect(screen.getByTestId("icon-pending")).toBeInTheDocument();
  });

  it("renders passing, failing and pending counts together", () => {
    render(
      <PRStatusCard
        details={details({
          checks: [
            check({ name: "ok", status: "completed", conclusion: "success" }),
            check({ name: "bad", status: "completed", conclusion: "failure" }),
            check({ name: "wip", status: "queued", conclusion: null }),
          ],
        })}
        error={null}
        prUrl="https://gh/pr/1"
      />,
    );

    expect(screen.getByText(/1 passing/)).toBeInTheDocument();
    expect(screen.getByText(/1 failing/)).toBeInTheDocument();
    expect(screen.getByText(/1 pending/)).toBeInTheDocument();
  });

  it("shows the checks row but no counts when every check is zero-bucketed", () => {
    render(
      <PRStatusCard
        details={details({
          checks: [check({ status: "completed", conclusion: "neutral" })],
        })}
        error={null}
        prUrl="https://gh/pr/1"
      />,
    );

    expect(screen.getByText("Checks:")).toBeInTheDocument();
    expect(screen.queryByText(/passing/)).not.toBeInTheDocument();
    expect(screen.queryByText(/failing/)).not.toBeInTheDocument();
    expect(screen.queryByText(/pending/)).not.toBeInTheDocument();
  });

  it("omits the reviews row when there are no approvals or change requests", () => {
    render(
      <PRStatusCard
        details={details({ reviews: [review({ state: "COMMENTED" })] })}
        error={null}
        prUrl="https://gh/pr/1"
      />,
    );

    expect(screen.queryByText("Reviews:")).not.toBeInTheDocument();
  });

  it("lists approvers when reviews are approved", () => {
    render(
      <PRStatusCard
        details={details({
          reviews: [
            review({ user: "alice", state: "APPROVED" }),
            review({ user: "bob", state: "APPROVED" }),
          ],
        })}
        error={null}
        prUrl="https://gh/pr/1"
      />,
    );

    expect(screen.getByText("Reviews:")).toBeInTheDocument();
    expect(screen.getByText(/Approved by alice, bob/)).toBeInTheDocument();
    expect(screen.queryByText(/Changes requested/)).not.toBeInTheDocument();
  });

  it("lists reviewers who requested changes", () => {
    render(
      <PRStatusCard
        details={details({
          reviews: [review({ user: "carol", state: "CHANGES_REQUESTED" })],
        })}
        error={null}
        prUrl="https://gh/pr/1"
      />,
    );

    expect(screen.getByText(/Changes requested by carol/)).toBeInTheDocument();
    expect(screen.queryByText(/Approved by/)).not.toBeInTheDocument();
  });

  it("renders both approvals and change requests when present", () => {
    render(
      <PRStatusCard
        details={details({
          reviews: [
            review({ user: "alice", state: "APPROVED" }),
            review({ user: "carol", state: "CHANGES_REQUESTED" }),
          ],
        })}
        error={null}
        prUrl="https://gh/pr/1"
      />,
    );

    expect(screen.getByText(/Approved by alice/)).toBeInTheDocument();
    expect(screen.getByText(/Changes requested by carol/)).toBeInTheDocument();
  });
});

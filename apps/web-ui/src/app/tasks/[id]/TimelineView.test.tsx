// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import TimelineView, { type TimelineResponse } from "./TimelineView";

// Isolate the view from the real Icon, which pulls in ThemeProvider/iconify.
// Render the icon name as data-* so we can assert which icon each stage maps to.
vi.mock("@/components/Icon", () => ({
  __esModule: true,
  default: ({ name, size }: { name: string; size?: number }) => (
    <span data-testid="icon" data-icon={name} data-size={size} />
  ),
}));

function baseData(overrides: Partial<TimelineResponse> = {}): TimelineResponse {
  return {
    task_id: "t1",
    branch_name: "lore/feature",
    repo: "re-cinq/lore",
    pr_number: null,
    pr_url: null,
    pr_state: null,
    commits: [],
    current_stage: null,
    ...overrides,
  };
}

function commit(
  overrides: Partial<TimelineResponse["commits"][number]> = {},
): TimelineResponse["commits"][number] {
  return {
    sha: "abcdef1234567890",
    stage: "implement",
    iteration: 0,
    outcome: "success",
    committed_at: "2026-06-04T10:00:00Z",
    duration_ms: 1500,
    summary: "did the thing",
    ...overrides,
  };
}

describe("TimelineView", () => {
  it("renders the loading state", () => {
    render(<TimelineView data={null} loading={true} error={null} />);

    expect(screen.getByText("Loading timeline…")).toBeInTheDocument();
  });

  it("renders the error state", () => {
    render(<TimelineView data={null} loading={false} error="HTTP 503" />);

    expect(
      screen.getByText("Timeline unavailable: HTTP 503"),
    ).toBeInTheDocument();
  });

  it("renders nothing when there is no data, no loading and no error", () => {
    const { container } = render(
      <TimelineView data={null} loading={false} error={null} />,
    );

    expect(container.firstChild).toBeNull();
  });

  it("renders the empty commits message when no commits and branch not deleted", () => {
    render(<TimelineView data={baseData()} loading={false} error={null} />);

    expect(screen.getByText("Stage Timeline")).toBeInTheDocument();
    expect(screen.getByText("No stage commits yet.")).toBeInTheDocument();
  });

  it("renders the no_branch pending notice", () => {
    render(
      <TimelineView
        data={baseData({ pending: "no_branch" })}
        loading={false}
        error={null}
      />,
    );

    expect(
      screen.getByText(/waiting for the supervisor to acquire its lease/),
    ).toBeInTheDocument();
  });

  it("renders the branch-deleted banner and suppresses the empty-commits message", () => {
    render(
      <TimelineView
        data={baseData({ branch_deleted: true, branch_name: "gone/branch" })}
        loading={false}
        error={null}
      />,
    );

    expect(screen.getByText(/has been deleted on the/)).toBeInTheDocument();
    expect(screen.getByText("gone/branch")).toBeInTheDocument();
    expect(screen.queryByText("No stage commits yet.")).not.toBeInTheDocument();
  });

  it("maps a known stage to its node icon and shows the success outcome pill", () => {
    render(
      <TimelineView
        data={baseData({
          commits: [commit({ stage: "review", outcome: "success" })],
        })}
        loading={false}
        error={null}
      />,
    );

    expect(screen.getByText("review")).toBeInTheDocument();
    expect(screen.getByText("iter 0")).toBeInTheDocument();
    expect(screen.getByText("success")).toBeInTheDocument();
    const stageIcon = screen
      .getAllByTestId("icon")
      .find((el) => el.getAttribute("data-size") === "18");

    expect(stageIcon).toHaveAttribute("data-icon", "review");
  });

  it("falls back to the bullet icon for an unknown stage", () => {
    render(
      <TimelineView
        data={baseData({ commits: [commit({ stage: "mystery" })] })}
        loading={false}
        error={null}
      />,
    );

    const stageIcon = screen
      .getAllByTestId("icon")
      .find((el) => el.getAttribute("data-size") === "18");

    expect(stageIcon).toHaveAttribute("data-icon", "bullet");
  });

  it("colours each outcome pill: success, changes_requested, failed, and unknown fallback", () => {
    const { container } = render(
      <TimelineView
        data={baseData({
          commits: [
            commit({ sha: "a000000000", outcome: "success" }),
            commit({ sha: "b000000000", outcome: "changes_requested" }),
            commit({ sha: "c000000000", outcome: "failed" }),
            commit({ sha: "d000000000", outcome: "weird" }),
          ],
        })}
        loading={false}
        error={null}
      />,
    );

    const pills = Array.from(
      container.querySelectorAll<HTMLElement>(".status-pill"),
    );
    const colorOf = (text: string) =>
      pills
        .find((p) => p.textContent === text)
        ?.style.getPropertyValue("--pill-color");

    expect(colorOf("success")).toBe("var(--success)");
    expect(colorOf("changes_requested")).toBe("var(--warning)");
    expect(colorOf("failed")).toBe("var(--danger)");
    expect(colorOf("weird")).toBe("var(--text-muted)");
  });

  it("formats every duration bucket: null, sub-second, seconds, minutes", () => {
    render(
      <TimelineView
        data={baseData({
          commits: [
            commit({ sha: "a000000000", duration_ms: null }),
            commit({ sha: "b000000000", duration_ms: 250 }),
            commit({ sha: "c000000000", duration_ms: 4200 }),
            commit({ sha: "d000000000", duration_ms: 65_000 }),
          ],
        })}
        loading={false}
        error={null}
      />,
    );

    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByText("250ms")).toBeInTheDocument();
    expect(screen.getByText("4.2s")).toBeInTheDocument();
    expect(screen.getByText("1m 5s")).toBeInTheDocument();
  });

  it("renders a commit link to GitHub when repo is present", () => {
    render(
      <TimelineView
        data={baseData({
          repo: "owner/name",
          commits: [commit({ sha: "abc1234deadbeef" })],
        })}
        loading={false}
        error={null}
      />,
    );

    const link = screen.getByRole("link");

    expect(link).toHaveAttribute(
      "href",
      "https://github.com/owner/name/commit/abc1234deadbeef",
    );
    expect(link).toHaveTextContent("abc1234");
  });

  it("omits the commit link when repo is null", () => {
    render(
      <TimelineView
        data={baseData({ repo: null, commits: [commit()] })}
        loading={false}
        error={null}
      />,
    );

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("renders the held-lease indicator with holder and expiry", () => {
    render(
      <TimelineView
        data={baseData({
          lease: {
            held: true,
            holder: "pod-7",
            expires_at: "2026-06-04T10:05:00Z",
          },
        })}
        loading={false}
        error={null}
      />,
    );

    expect(screen.getByText("pod-7")).toBeInTheDocument();
    expect(screen.getByText(/Lease held by/)).toBeInTheDocument();
    expect(screen.getByText(/expires/)).toBeInTheDocument();
  });

  it("renders the held-lease indicator without an expiry when expires_at is absent", () => {
    render(
      <TimelineView
        data={baseData({ lease: { held: true, holder: "pod-9" } })}
        loading={false}
        error={null}
      />,
    );

    expect(screen.getByText("pod-9")).toBeInTheDocument();
    expect(screen.queryByText(/expires/)).not.toBeInTheDocument();
  });

  it("hides the lease indicator when the lease is not held", () => {
    render(
      <TimelineView
        data={baseData({ lease: { held: false, holder: "pod-x" } })}
        loading={false}
        error={null}
      />,
    );

    expect(screen.queryByText(/Lease held by/)).not.toBeInTheDocument();
  });
});

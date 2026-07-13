// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import PRStatusCard from "./PRStatusCard";

// Icon pulls in ThemeProvider via useTheme(); render its name so we can assert
// which status icons appear without standing up the theme context.
vi.mock("@/components/Icon", () => ({
  default: ({ name }: { name: string }) => <i data-testid={`icon-${name}`} />,
}));

type Check = { name: string; status: string; conclusion: string | null };
type Review = { user: string; state: string; submitted_at: string };

interface PRDetailsPayload {
  number: number;
  title: string;
  state: string;
  draft: boolean;
  merged: boolean;
  mergeable: boolean | null;
  html_url: string;
  checks: Check[];
  reviews: Review[];
  computed_status: string;
}

const details = (over: Partial<PRDetailsPayload> = {}): PRDetailsPayload => ({
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

function stubFetchJson(payload: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

// Render and flush the mount-effect fetch + its .then microtasks so state has
// settled before assertions.
async function renderSettled(props: { taskId: string; prUrl: string }) {
  let view: ReturnType<typeof render>;
  await act(async () => {
    view = render(<PRStatusCard {...props} />);
  });
  await act(async () => {
    await Promise.resolve();
  });
  return view!;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("PRStatusCard", () => {
  beforeEach(() => {
    stubFetchJson(details());
  });

  it("renders the Loading placeholder before the fetch resolves", () => {
    // No await: the fetch promise has not yet settled on first paint.
    render(<PRStatusCard taskId="task-1" prUrl="https://gh/pr/1" />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(screen.getByText("PR Status:")).toBeInTheDocument();
  });

  it("requests pr-status for the given task id", async () => {
    const fetchMock = stubFetchJson(details());
    await renderSettled({ taskId: "abc-123", prUrl: "https://gh/pr/1" });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/assembly-lines/abc-123/pr-status",
    );
  });

  it("renders the computed status pill and a PR link after a resolved fetch", async () => {
    stubFetchJson(
      details({ computed_status: "open", number: 7, title: "My PR" }),
    );
    await renderSettled({ taskId: "task-1", prUrl: "https://gh/pr/1" });

    expect(screen.getByText("open")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /#7 My PR/ });
    expect(link).toHaveAttribute(
      "href",
      "https://github.com/acme/repo/pull/42",
    );
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("applies the mapped pill color for a known computed status", async () => {
    stubFetchJson(details({ computed_status: "merged" }));
    await renderSettled({ taskId: "task-1", prUrl: "https://gh/pr/1" });

    const pill = screen.getByText("merged");
    expect(pill).toHaveStyle({ "--pill-color": "var(--accent)" });
  });

  it("falls back to the muted pill color for an unknown computed status", async () => {
    // computed_status not present in STATUS_COLORS exercises the `|| fallback`.
    stubFetchJson(details({ computed_status: "mystery-state" }));
    await renderSettled({ taskId: "task-1", prUrl: "https://gh/pr/1" });

    const pill = screen.getByText("mystery-state");
    expect(pill).toHaveStyle({ "--pill-color": "var(--text-muted)" });
  });

  it("omits the checks row when there are no checks", async () => {
    stubFetchJson(details({ checks: [] }));
    await renderSettled({ taskId: "task-1", prUrl: "https://gh/pr/1" });

    expect(screen.queryByText("Checks:")).not.toBeInTheDocument();
  });

  it("counts passing checks from success and skipped conclusions", async () => {
    stubFetchJson(
      details({
        checks: [
          check({ name: "a", conclusion: "success" }),
          check({ name: "b", conclusion: "skipped" }),
        ],
      }),
    );
    await renderSettled({ taskId: "task-1", prUrl: "https://gh/pr/1" });

    expect(screen.getByText("Checks:")).toBeInTheDocument();
    expect(screen.getByText(/2 passing/)).toBeInTheDocument();
    expect(screen.getByTestId("icon-check")).toBeInTheDocument();
    expect(screen.queryByText(/failing/)).not.toBeInTheDocument();
    expect(screen.queryByText(/pending/)).not.toBeInTheDocument();
  });

  it("counts failing checks from failure and timed_out conclusions", async () => {
    stubFetchJson(
      details({
        checks: [
          check({ name: "a", conclusion: "failure" }),
          check({ name: "b", conclusion: "timed_out" }),
        ],
      }),
    );
    await renderSettled({ taskId: "task-1", prUrl: "https://gh/pr/1" });

    expect(screen.getByText(/2 failing/)).toBeInTheDocument();
    expect(screen.getByTestId("icon-error")).toBeInTheDocument();
    expect(screen.queryByText(/passing/)).not.toBeInTheDocument();
  });

  it("counts pending checks from any non-completed status", async () => {
    stubFetchJson(
      details({
        checks: [check({ name: "a", status: "in_progress", conclusion: null })],
      }),
    );
    await renderSettled({ taskId: "task-1", prUrl: "https://gh/pr/1" });

    expect(screen.getByText(/1 pending/)).toBeInTheDocument();
    expect(screen.getByTestId("icon-pending")).toBeInTheDocument();
  });

  it("renders passing, failing and pending counts together", async () => {
    stubFetchJson(
      details({
        checks: [
          check({ name: "ok", status: "completed", conclusion: "success" }),
          check({ name: "bad", status: "completed", conclusion: "failure" }),
          check({ name: "wip", status: "queued", conclusion: null }),
        ],
      }),
    );
    await renderSettled({ taskId: "task-1", prUrl: "https://gh/pr/1" });

    expect(screen.getByText(/1 passing/)).toBeInTheDocument();
    expect(screen.getByText(/1 failing/)).toBeInTheDocument();
    expect(screen.getByText(/1 pending/)).toBeInTheDocument();
  });

  it("shows the checks row but no counts when every check is zero-bucketed", async () => {
    // A completed check whose conclusion is none of the tracked values:
    // checks.length > 0 renders the row, but every count is 0.
    stubFetchJson(
      details({
        checks: [check({ status: "completed", conclusion: "neutral" })],
      }),
    );
    await renderSettled({ taskId: "task-1", prUrl: "https://gh/pr/1" });

    expect(screen.getByText("Checks:")).toBeInTheDocument();
    expect(screen.queryByText(/passing/)).not.toBeInTheDocument();
    expect(screen.queryByText(/failing/)).not.toBeInTheDocument();
    expect(screen.queryByText(/pending/)).not.toBeInTheDocument();
  });

  it("omits the reviews row when there are no approvals or change requests", async () => {
    stubFetchJson(details({ reviews: [review({ state: "COMMENTED" })] }));
    await renderSettled({ taskId: "task-1", prUrl: "https://gh/pr/1" });

    expect(screen.queryByText("Reviews:")).not.toBeInTheDocument();
  });

  it("lists approvers when reviews are approved", async () => {
    stubFetchJson(
      details({
        reviews: [
          review({ user: "alice", state: "APPROVED" }),
          review({ user: "bob", state: "APPROVED" }),
        ],
      }),
    );
    await renderSettled({ taskId: "task-1", prUrl: "https://gh/pr/1" });

    expect(screen.getByText("Reviews:")).toBeInTheDocument();
    expect(screen.getByText(/Approved by alice, bob/)).toBeInTheDocument();
    expect(screen.queryByText(/Changes requested/)).not.toBeInTheDocument();
  });

  it("lists reviewers who requested changes", async () => {
    stubFetchJson(
      details({
        reviews: [review({ user: "carol", state: "CHANGES_REQUESTED" })],
      }),
    );
    await renderSettled({ taskId: "task-1", prUrl: "https://gh/pr/1" });

    expect(screen.getByText(/Changes requested by carol/)).toBeInTheDocument();
    expect(screen.queryByText(/Approved by/)).not.toBeInTheDocument();
  });

  it("renders both approvals and change requests when present", async () => {
    stubFetchJson(
      details({
        reviews: [
          review({ user: "alice", state: "APPROVED" }),
          review({ user: "carol", state: "CHANGES_REQUESTED" }),
        ],
      }),
    );
    await renderSettled({ taskId: "task-1", prUrl: "https://gh/pr/1" });

    expect(screen.getByText(/Approved by alice/)).toBeInTheDocument();
    expect(screen.getByText(/Changes requested by carol/)).toBeInTheDocument();
  });

  it("shows the unavailable fallback when the payload carries an error field", async () => {
    stubFetchJson({ error: "PR not found" });
    await renderSettled({
      taskId: "task-1",
      prUrl: "https://example.com/pr/9",
    });

    expect(screen.getByText(/Status unavailable/)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "View on GitHub" });
    expect(link).toHaveAttribute("href", "https://example.com/pr/9");
    expect(link).toHaveAttribute("target", "_blank");
    expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
  });

  it("shows the unavailable fallback when the fetch rejects", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", fetchMock);

    await renderSettled({
      taskId: "task-1",
      prUrl: "https://example.com/pr/9",
    });

    await waitFor(() =>
      expect(screen.getByText(/Status unavailable/)).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("link", { name: "View on GitHub" }),
    ).toHaveAttribute("href", "https://example.com/pr/9");
  });

  it("does not fetch again after unmount", async () => {
    const fetchMock = stubFetchJson(details());
    const { unmount } = await renderSettled({
      taskId: "task-1",
      prUrl: "https://gh/pr/1",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    unmount();
    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refetches when the task id prop changes", async () => {
    const fetchMock = stubFetchJson(details());
    const { rerender } = await renderSettled({
      taskId: "first",
      prUrl: "https://gh/pr/1",
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/assembly-lines/first/pr-status",
    );

    await act(async () => {
      rerender(<PRStatusCard taskId="second" prUrl="https://gh/pr/1" />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/assembly-lines/second/pr-status",
    );
  });
});

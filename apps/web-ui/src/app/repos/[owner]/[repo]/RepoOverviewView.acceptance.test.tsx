// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import RepoOverviewView, { type RecentTask } from "./RepoOverviewView";
import { type Check } from "@/lib/enrollment";

const ensureWebhook = vi.fn();
const revalidatePath = vi.fn();

vi.mock("@/components/Icon", () => ({ default: () => null }));
vi.mock("@/lib/webhook-api", () => ({
  ensureWebhook: (...a: unknown[]) => ensureWebhook(...a),
}));
vi.mock("next/cache", () => ({
  revalidatePath: (...a: unknown[]) => revalidatePath(...a),
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

import { setupWebhook } from "./actions";

beforeEach(() => {
  ensureWebhook.mockReset();
  revalidatePath.mockReset();
});

const task = (over: Partial<RecentTask>): RecentTask => ({
  id: "1",
  description: "Implement the widget",
  status: "completed",
  pr_url: "https://github.com/re-cinq/lore/pull/7",
  created_at: "2026-06-01T10:00:00.000Z",
  ...over,
});

const baseProps = {
  owner: "re-cinq",
  repo: "lore",
  readme: { markdown: "README", rawBaseUrl: "/", htmlUrl: "/" },
  enrollmentChecks: [],
  recentTasks: [],
  latestEvents: [],
  trustLevel: "full" as const,
  tasksWeek: 1,
  conventionFiles: [],
  chunkCount: 1,
  reonboardAction: async () => {},
  setupWebhookAction: async () => {},
};

describe("T010: Create overview tab", () => {
  it("renders PR state pills when a status is known and omits them when unknown", async () => {
    const byTask: Record<string, unknown> = {
      "/api/tasks/t1/pr-status": { computed_status: "merged" },
      "/api/tasks/t2/pr-status": {},
    };

    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(byTask[url] ?? {}),
        }),
      ),
    );

    render(
      <RepoOverviewView
        {...baseProps}
        recentTasks={[
          task({
            id: "t1",
            pr_url: "https://github.com/re-cinq/lore/pull/1",
          }),
          task({
            id: "t2",
            pr_url: "https://github.com/re-cinq/lore/pull/2",
          }),
        ]}
      />,
    );

    expect(await screen.findByText("merged")).toBeInTheDocument();
    expect(document.querySelectorAll(".status-pill")).toHaveLength(1);
    vi.unstubAllGlobals();
  });

  it("retains existing activity behavior by rendering all PR links", () => {
    render(
      <RepoOverviewView
        {...baseProps}
        recentTasks={[
          task({
            id: "t1",
            pr_url: "https://github.com/re-cinq/lore/pull/1",
          }),
          task({
            id: "t2",
            pr_url: "https://github.com/re-cinq/lore/pull/2",
          }),
        ]}
      />,
    );

    const prLinks = screen.getAllByRole("link", { name: "PR" });

    expect(prLinks).toHaveLength(2);
    expect(prLinks[0]).toHaveAttribute(
      "href",
      "https://github.com/re-cinq/lore/pull/1",
    );
    expect(prLinks[1]).toHaveAttribute(
      "href",
      "https://github.com/re-cinq/lore/pull/2",
    );
  });

  it("surfaces setup refusals", async () => {
    const checks: Check[] = [
      {
        id: "webhook",
        label: "GitHub webhook → Lore",
        status: "warn",
        action: { kind: "setup-webhook", text: "set up" },
      },
    ];

    ensureWebhook.mockResolvedValue({
      error: "Refused by server due to secret mismatch",
    });

    render(
      <RepoOverviewView
        {...baseProps}
        enrollmentChecks={checks}
        setupWebhookAction={setupWebhook.bind(null, "re-cinq/lore")}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "set up" }));

    await waitFor(() => {
      expect(
        screen.getByText("Refused by server due to secret mismatch"),
      ).toBeInTheDocument();
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

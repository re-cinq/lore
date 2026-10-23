// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

vi.mock("@/lib/api/backlog", () => ({ getImplementationLoop: vi.fn() }));
vi.mock("../actions", () => ({ retryOnboardingAction: vi.fn() }));
const followed: Array<{ runIds: readonly string[] }> = [];

vi.mock("./LoopRunsFollower", () => ({
  default: (props: { runIds: readonly string[] }) => {
    followed.push(props);

    return null;
  },
}));

import { getImplementationLoop } from "@/lib/api/backlog";
import ImplementationLoopBody from "./ImplementationLoopBody";

const fullName = "re-cinq/lore";
const ticket = (issueNumber: number, runId: string | null) => ({
  issue_number: issueNumber,
  issue_url: `https://gh/i/${issueNumber}`,
  title: `Ticket ${issueNumber}`,
  priority: null,
  created_at: null,
  pr_url: null,
  state: "running",
  hold: null,
  run_id: runId,
  pipeline: null,
});

describe("ImplementationLoopBody", () => {
  beforeEach(() => {
    followed.length = 0;
  });

  it("follows the deduplicated run ids of every ticket shown, across every section", async () => {
    vi.mocked(getImplementationLoop).mockResolvedValue({
      status: "ok",
      data: {
        enabled: true,
        onboarding: { merged: true, pr_url: null, last_task: null },
        current: [ticket(7, "run-1"), ticket(158, "run-4")],
        current_run_id: "run-1",
        next: [ticket(8, null)],
        parked: [ticket(9, "run-2")],
        recent: [ticket(5, "run-1")],
        awaiting_merge: [ticket(302, "run-3")],
      },
    } as never);

    render(await ImplementationLoopBody({ fullName }));

    expect(followed[0]?.runIds).toEqual(["run-1", "run-4", "run-2", "run-3"]);
  });

  it("renders the view from an ok read", async () => {
    vi.mocked(getImplementationLoop).mockResolvedValue({
      status: "ok",
      data: {
        enabled: true,
        onboarding: { merged: true, pr_url: null, last_task: null },
        current: [],
        current_run_id: null,
        next: [],
        parked: [],
        recent: [],
        awaiting_merge: [],
      },
    } as never);

    const { getByText } = render(await ImplementationLoopBody({ fullName }));

    expect(getByText("Next up")).toBeTruthy();
  });

  it("says what happened on an API failure instead of a disabled-empty page", async () => {
    vi.mocked(getImplementationLoop).mockResolvedValue({
      status: "error",
      message: "boom",
    } as never);

    const { getByText } = render(await ImplementationLoopBody({ fullName }));

    expect(getByText(/Could not load the backlog state/)).toBeTruthy();
    expect(getByText(/boom/)).toBeTruthy();
  });
});

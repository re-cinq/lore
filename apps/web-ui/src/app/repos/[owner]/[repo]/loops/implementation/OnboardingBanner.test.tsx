// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import type { ImplementationLoop } from "@/lib/api/backlog";
import OnboardingBanner from "./OnboardingBanner";

function renderView(over: Partial<ImplementationLoop>) {
  const retryOnboarding = vi.fn(async () => {});
  const loop: ImplementationLoop = {
    enabled: false,
    onboarding: { merged: true, pr_url: null, last_task: null },
    current: [],
    current_run_id: null,
    next: [],
    parked: [],
    recent: [],
    awaiting_merge: [],
    ...over,
  };
  const rendered = render(
    <OnboardingBanner loop={loop} retry={retryOnboarding} />,
  );

  return { ...rendered, retryOnboarding };
}

describe("OnboardingBanner when the repo is not onboarded", () => {
  it("says the loop picks nothing, shows why onboarding failed, and offers to retry it", () => {
    const { getByText, getByRole, retryOnboarding } = renderView({
      enabled: true,
      onboarding: {
        merged: false,
        pr_url: null,
        last_task: {
          id: "d5602eb8",
          status: "failed",
          failure_reason: "Git Repository is empty.",
          in_flight: false,
        },
      },
    });

    expect(getByText(/won't pick tickets/)).toBeTruthy();
    expect(getByText(/Git Repository is empty\./)).toBeTruthy();
    fireEvent.click(getByRole("button", { name: "Retry onboarding" }));
    expect(retryOnboarding).toHaveBeenCalledTimes(1);
  });

  it("links to the open onboarding PR instead of offering a retry while one waits to merge", () => {
    const { getByRole, queryByRole } = renderView({
      enabled: true,
      onboarding: {
        merged: false,
        pr_url: "https://github.com/re-cinq/Otto/pull/216",
        last_task: {
          id: "t2",
          status: "pr-created",
          failure_reason: null,
          in_flight: true,
        },
      },
    });

    expect(
      getByRole("link", { name: "Merge the onboarding PR" }).getAttribute(
        "href",
      ),
    ).toBe("https://github.com/re-cinq/Otto/pull/216");
    expect(queryByRole("button", { name: "Retry onboarding" })).toBeNull();
  });

  it("links to the running onboarding task instead of offering a retry", () => {
    const { getByRole, queryByRole } = renderView({
      enabled: true,
      onboarding: {
        merged: false,
        pr_url: null,
        last_task: {
          id: "t3",
          status: "running",
          failure_reason: null,
          in_flight: true,
        },
      },
    });

    expect(
      getByRole("link", { name: "Onboarding is running" }).getAttribute("href"),
    ).toBe("/assembly-runs/t3");
    expect(queryByRole("button", { name: "Retry onboarding" })).toBeNull();
  });

  it("offers to onboard a repo that was never onboarded, without calling it a failure", () => {
    const { getByRole, queryByText, retryOnboarding } = renderView({
      enabled: true,
      onboarding: { merged: false, pr_url: null, last_task: null },
    });

    expect(queryByText(/Onboarding failed/)).toBeNull();
    fireEvent.click(getByRole("button", { name: "Onboard this repo" }));
    expect(retryOnboarding).toHaveBeenCalledTimes(1);
  });
});

// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import type { PlanPageState } from "@/lib/plan-page-state";
import PlanOutlineActions from "./PlanOutlineActions";

const refresh = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const actions = {
  approve: vi.fn(async () => ({})),
  reopen: vi.fn(async () => ({})),
  retrySpecWork: vi.fn(async () => ({})),
  reworkSpecs: vi.fn(async () => ({})),
};

const outline = (
  state: PlanPageState,
  pr: number | null = null,
  prTitle: string | null = null,
  prUnresolvedThreads: number | null = null,
) =>
  render(
    <PlanOutlineActions
      state={state}
      canApprove
      prUrl={pr ? `https://github.com/re-cinq/lore/pull/${pr}` : null}
      prNumber={pr}
      prTitle={prTitle}
      prUnresolvedThreads={prUnresolvedThreads}
      {...actions}
    />,
  );

const buttons = () =>
  screen.getAllByRole("button").map((button) => button.textContent);

describe("PlanOutlineActions", () => {
  it("offers Approve plan while the plan is being written", () => {
    outline("writing");

    expect(buttons()).toEqual(["Approve plan"]);
  });

  it("holds Approve plan while the planning agent is refining a section", () => {
    outline("refining");

    expect(
      screen.getByRole("button", { name: "Approve plan" }),
    ).toHaveAttribute(
      "title",
      "The planning agent is still refining a section",
    );
  });

  it("says approving a reopened plan updates spec PR #7", () => {
    outline("reopened", 7);
    fireEvent.click(screen.getByRole("button", { name: "Approve plan" }));

    expect(screen.getByRole("dialog")).toHaveTextContent("updates spec PR #7");
  });

  it("offers Approve plan while the plan's people answer the spec analysis's question", () => {
    outline("answering");

    expect(buttons()).toEqual(["Approve plan"]);
  });

  it("offers only the spec PR link while the specs are being written", () => {
    outline("spec-work");

    expect(screen.queryAllByRole("button")).toEqual([]);
  });

  it("links spec PR #7 by its title under 'Spec waiting for review', in a new tab, and offers Reopen plan while the PR is open", () => {
    outline("spec-pr-open", 7, "spec: Faster checkout");
    const section = screen.getByRole("region", {
      name: "Spec waiting for review",
    });
    const link = within(section).getByRole("link", {
      name: "spec: Faster checkout",
    });

    expect({
      href: link.getAttribute("href"),
      target: link.getAttribute("target"),
      buttons: buttons(),
    }).toEqual({
      href: "https://github.com/re-cinq/lore/pull/7",
      target: "_blank",
      buttons: ["Rework the specs from the review", "Reopen plan"],
    });
  });

  it("offers to rework the specs from the review only while spec PR #7 waits for review, and reworks only after the confirmation popup", async () => {
    outline("delivered", 7);
    const whileDelivered = screen.queryByRole("button", {
      name: "Rework the specs from the review",
    });

    cleanup();
    outline("spec-pr-open", 7);
    fireEvent.click(
      screen.getByRole("button", { name: "Rework the specs from the review" }),
    );
    const asked = actions.reworkSpecs.mock.calls.length;

    await act(async () => {
      fireEvent.click(
        within(screen.getByRole("dialog")).getByRole("button", {
          name: "Rework",
        }),
      );
    });

    expect({
      whileDelivered,
      asked,
      reworked: actions.reworkSpecs.mock.calls.length,
    }).toEqual({ whileDelivered: null, asked: 0, reworked: 1 });
  });

  it("counts 3 unresolved comments under spec PR #7 while it waits for review", () => {
    outline("spec-pr-open", 7, "spec: Faster checkout", 3);

    expect(
      screen.getByRole("region", { name: "Spec waiting for review" }),
    ).toHaveTextContent("spec: Faster checkout3 unresolved comments");
  });

  it("says spec PR #7 has no unresolved comments while it waits for review, and nothing once it merged", () => {
    const { unmount } = outline("spec-pr-open", 7, null, 0);
    const waiting = screen.getByRole("region", {
      name: "Spec waiting for review",
    }).textContent;

    unmount();
    outline("delivered", 7, null, 0);

    expect({
      waiting,
      merged: screen.getByRole("region", { name: "Spec merged" }).textContent,
    }).toEqual({
      waiting:
        "Spec waiting for reviewSpec PR #7No unresolved commentsRework the specs from the review",
      merged: "Spec mergedSpec PR #7",
    });
  });

  it("names spec PR #7 by its number when GitHub gave no title, under 'Spec merged' once delivered", () => {
    outline("delivered", 7);

    expect(
      within(screen.getByRole("region", { name: "Spec merged" })).getByRole(
        "link",
        { name: "Spec PR #7" },
      ),
    ).toBeInTheDocument();
  });

  it("offers Retry the spec work and Reopen plan after the spec work failed", () => {
    outline("spec-work-failed");

    expect(buttons()).toEqual(["Retry the spec work", "Reopen plan"]);
  });

  it("warns that reopening a delivered plan opens a new spec PR on the next approval", () => {
    outline("delivered", 7);
    fireEvent.click(screen.getByRole("button", { name: "Reopen plan" }));

    expect(screen.getByRole("dialog")).toHaveTextContent(
      "opens a NEW spec PR that revises the merged specs",
    );
  });

  it("retries the spec work only after the confirmation popup", async () => {
    outline("spec-work-failed");
    fireEvent.click(
      screen.getByRole("button", { name: "Retry the spec work" }),
    );
    const asked = actions.retrySpecWork.mock.calls.length;

    await act(async () => {
      fireEvent.click(
        within(screen.getByRole("dialog")).getByRole("button", {
          name: "Retry",
        }),
      );
    });

    expect({ asked, retried: actions.retrySpecWork.mock.calls.length }).toEqual(
      {
        asked: 0,
        retried: 1,
      },
    );
  });
});

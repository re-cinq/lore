// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { PlanPageState } from "@/lib/plan-page-state";
import PlanOutlineActions from "./PlanOutlineActions";

const refresh = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const actions = {
  approve: vi.fn(async () => ({})),
  reopen: vi.fn(async () => ({})),
  retrySpecWork: vi.fn(async () => ({})),
};

const outline = (state: PlanPageState, pr: number | null = null) =>
  render(
    <PlanOutlineActions
      state={state}
      canApprove
      prUrl={pr ? `https://github.com/re-cinq/lore/pull/${pr}` : null}
      prNumber={pr}
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

  it("links spec PR #7 and offers Reopen plan while the PR is open", () => {
    outline("spec-pr-open", 7);

    expect({
      link: screen
        .getByRole("link", { name: "Spec PR #7" })
        .getAttribute("href"),
      buttons: buttons(),
    }).toEqual({
      link: "https://github.com/re-cinq/lore/pull/7",
      buttons: ["Reopen plan"],
    });
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

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
import type { PlanStory } from "@/lib/api/plans";
import PlanOutlineActions from "./PlanOutlineActions";

const refresh = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/components/Icon", () => ({
  default: ({ name }: { name: string }) => <i data-testid={`icon-${name}`} />,
}));

const actions = {
  approve: vi.fn(async () => ({})),
  reopen: vi.fn(async () => ({})),
  retrySpecWork: vi.fn(async () => ({})),
  reworkSpecs: vi.fn(async () => ({})),
  validate: vi.fn(async () => ({})),
};

interface OutlineOptions {
  prUnresolvedThreads?: number | null;
  story?: PlanStory | null;
}

const NO_OUTLINE_OPTIONS = { prUnresolvedThreads: null, story: null };

const outline = (
  state: PlanPageState,
  pr: number | null = null,
  prTitle: string | null = null,
  options: OutlineOptions = {},
) =>
  render(
    <PlanOutlineActions
      state={state}
      canApprove
      prUrl={pr ? `https://github.com/re-cinq/lore/pull/${pr}` : null}
      prNumber={pr}
      prTitle={prTitle}
      {...{ ...NO_OUTLINE_OPTIONS, ...options }}
      {...actions}
    />,
  );

const buttons = () =>
  screen.getAllByRole("button").map((button) => button.textContent);

describe("PlanOutlineActions", () => {
  it("offers Validate the plan above Approve plan while the plan is being written", () => {
    outline("writing");

    expect(buttons()).toEqual(["Validate the plan", "Approve plan"]);
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

  it("disables both draft actions while the validator reads the plan", () => {
    outline("validating");

    const buttonElements = screen.getAllByRole("button");

    expect({
      buttons: buttons(),
      disabled: buttonElements.map((button) => button.hasAttribute("disabled")),
      titles: buttonElements.map((button) => button.getAttribute("title")),
    }).toEqual({
      buttons: ["Validate the plan", "Approve plan"],
      disabled: [true, true],
      titles: [
        "The validator is reading the plan",
        "The validator is reading the plan",
      ],
    });
  });

  it("says approving a reopened plan updates spec PR #7", () => {
    outline("reopened", 7);
    fireEvent.click(screen.getByRole("button", { name: "Approve plan" }));

    expect(screen.getByRole("dialog")).toHaveTextContent("updates spec PR #7");
  });

  it("offers Validate the plan above Approve plan while the plan's people answer the spec analysis's question", () => {
    outline("answering");

    expect(buttons()).toEqual(["Validate the plan", "Approve plan"]);
  });

  it("offers Reopen plan while the specs are being written", () => {
    outline("spec-work");

    expect(buttons()).toEqual(["Reopen plan"]);
  });

  it("warns that reopening stops the spec writing", () => {
    outline("spec-work");
    fireEvent.click(screen.getByRole("button", { name: "Reopen plan" }));

    expect(
      screen.getByText(/The spec writing stops and the plan opens for writing/),
    ).toBeTruthy();
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
    outline("spec-pr-open", 7, "spec: Faster checkout", {
      prUnresolvedThreads: 3,
    });

    expect(
      screen.getByRole("region", { name: "Spec waiting for review" }),
    ).toHaveTextContent("spec: Faster checkout3 unresolved comments");
  });

  it("says spec PR #7 has no unresolved comments while it waits for review, and nothing once it merged", () => {
    const { unmount } = outline("spec-pr-open", 7, null, {
      prUnresolvedThreads: 0,
    });
    const waiting = screen.getByRole("region", {
      name: "Spec waiting for review",
    }).textContent;

    unmount();
    outline("delivered", 7, null, { prUnresolvedThreads: 0 });

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

  it("shows why lore-api refused a Refine as an alert right under the story link", () => {
    const refusal =
      "The plan is approved, so its sections are settled; reopen the plan to write again.";
    const { container } = render(
      <PlanOutlineActions
        state="writing"
        canApprove
        prUrl={null}
        prNumber={null}
        prTitle={null}
        prUnresolvedThreads={null}
        story={null}
        refusal={refusal}
        {...actions}
      />,
    );
    const first = container.firstElementChild?.children[1];

    expect({
      role: first?.getAttribute("role"),
      text: first?.textContent,
    }).toEqual({ role: "alert", text: refusal });
  });
});

const LINKED_STORY: PlanStory = {
  issueNumber: 123,
  issueUrl: "https://github.com/re-cinq/lore/issues/123",
};

describe("PlanOutlineActions user story", () => {
  it("links Linked to #123 to the issue, in a new tab", () => {
    outline("writing", null, null, { story: LINKED_STORY });
    const link = screen.getByRole("link", { name: "Linked to #123" });

    expect({
      href: link.getAttribute("href"),
      target: link.getAttribute("target"),
      leavesThePage: within(link).queryByTestId("icon-external") !== null,
    }).toEqual({
      href: "https://github.com/re-cinq/lore/issues/123",
      target: "_blank",
      leavesThePage: true,
    });
  });

  it("says No user story linked for a plan whose story is removed", () => {
    outline("writing", null, null, {
      story: { issueNumber: null, issueUrl: null },
    });

    expect({
      text: screen.getByText("No user story linked").textContent,
      links: screen.queryAllByRole("link"),
    }).toEqual({ text: "No user story linked", links: [] });
  });

  it("says No user story linked while the story could not be read", () => {
    outline("writing");

    expect(screen.getByText("No user story linked")).toBeInTheDocument();
  });

  it("draws the story link before the spec PR and the draft actions", () => {
    outline("writing", 7, "Spec for checkout", {
      prUnresolvedThreads: 0,
      story: LINKED_STORY,
    });
    const story = screen.getByRole("link", { name: "Linked to #123" });
    const specPr = screen.getByRole("link", { name: /Spec for checkout/ });
    const validate = screen.getByRole("button", { name: "Validate the plan" });

    expect({
      beforeSpecPr: story.compareDocumentPosition(specPr),
      beforeValidate: story.compareDocumentPosition(validate),
    }).toEqual({
      beforeSpecPr: Node.DOCUMENT_POSITION_FOLLOWING,
      beforeValidate: Node.DOCUMENT_POSITION_FOLLOWING,
    });
  });
});

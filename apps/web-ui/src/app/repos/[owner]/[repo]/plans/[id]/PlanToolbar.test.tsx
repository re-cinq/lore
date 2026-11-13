// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { createRef, type ComponentProps } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { PlanMeta } from "@re-cinq/planning-document";
import PlanToolbar from "./PlanToolbar";
import type { PlanRun } from "./PlanRunCard";

const refresh = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/components/Icon", () => ({
  default: ({ name }: { name: string }) => <i data-testid={`icon-${name}`} />,
}));

const META: PlanMeta = {
  schemaVersion: 1,
  id: "p1",
  repo: "re-cinq/lore",
  type: "feature",
  templateVersion: 1,
  title: "Faster checkout",
  status: "draft",
  approval: null,
  version: 2,
  createdBy: "gedaiu",
  updatedAt: "2026-09-21T10:00:00.000Z",
};

const RUN: PlanRun = {
  id: "r1",
  status: "running",
  outcome: null,
  reason: null,
  issueUrl: null,
  issueNumber: null,
  prUrl: null,
  prNumber: null,
  prTitle: null,
  prUnresolvedThreads: null,
  specPlanSummary: null,
  nodes: [
    {
      nodeId: "analyze",
      iteration: 1,
      outcome: "success",
      agentCrName: null,
      commitSha: null,
      durationSeconds: 60,
    },
    {
      nodeId: "author",
      iteration: 1,
      outcome: null,
      agentCrName: null,
      commitSha: null,
      durationSeconds: null,
    },
  ],
};

const FAILED_RUN: PlanRun = {
  ...RUN,
  status: "failed",
  reason: "no cluster-agent claimed this run",
};

const DEFAULT_PROPS: ComponentProps<typeof PlanToolbar> = {
  meta: META,
  run: RUN,
  state: "writing",
  story: null,
  draftAgain: async () => ({}),
  deletePlan: async () => ({}),
  saveStory: async () => ({}),
  removeStory: async () => ({}),
};

function renderToolbar(
  overrides: Partial<ComponentProps<typeof PlanToolbar>> = {},
) {
  render(<PlanToolbar {...DEFAULT_PROPS} {...overrides} />);
}

function openActionsMenu() {
  fireEvent.click(screen.getByRole("button", { name: "More plan actions" }));
}

describe("PlanToolbar", () => {
  it("says feature plan, version 2, by gedaiu", () => {
    renderToolbar();

    expect(screen.getByText(/feature plan · version 2/).textContent).toBe(
      "feature plan · version 2 · by gedaiu",
    );
  });

  it("says gedaiu approved the plan on 2026-09-23", () => {
    renderToolbar({
      meta: {
        ...META,
        status: "approved",
        approval: {
          mode: "manual",
          approvedBy: "gedaiu",
          approvedAt: "2026-09-23T10:00:00.000Z",
          version: 2,
        },
      },
      state: "spec-pr-open",
    });

    expect(screen.getByText(/approved by gedaiu on/).textContent).toContain(
      new Date("2026-09-23T10:00:00.000Z").toLocaleDateString(),
    );
  });

  it("says the plan waits for its people", () => {
    renderToolbar();

    expect(screen.getByText(/Waiting for you/).textContent).toBe(
      "Waiting for you: refine sections or approve the plan.",
    );
  });

  it("says no run has started for a plan without one", () => {
    renderToolbar({ run: null });

    expect(screen.getByText("No planning run yet.")).toBeInTheDocument();
  });

  it("links Open the run to /assembly-runs/r1", () => {
    renderToolbar();

    expect(
      screen.getByRole("link", { name: "Open the run →" }),
    ).toHaveAttribute("href", "/assembly-runs/r1");
  });

  it("offers no Open the run link for a plan without a run", () => {
    renderToolbar({ run: null });

    expect(screen.queryByRole("link", { name: "Open the run →" })).toBeNull();
  });

  it("links only the run once spec PR #7 is open; the outline carries the PR", () => {
    renderToolbar({
      meta: { ...META, status: "approved" },
      run: {
        ...RUN,
        prUrl: "https://github.com/re-cinq/lore/pull/7",
        prNumber: 7,
      },
      state: "spec-pr-open",
    });

    expect(
      screen.getAllByRole("link").map((link) => link.getAttribute("href")),
    ).toEqual(["/assembly-runs/r1"]);
  });

  it("leaves the failed spec work to the warning and offers no Regenerate plan", () => {
    renderToolbar({ run: FAILED_RUN, state: "spec-work-failed" });

    expect({
      text: screen.queryByText(/did not deliver/),
      regenerate: screen.queryByRole("button", { name: "Regenerate plan" }),
    }).toEqual({ text: null, regenerate: null });
  });

  it("says a reopened plan updates its spec PR on the next approval", () => {
    renderToolbar({ state: "reopened" });

    expect(screen.getByText(/Reopened:/).textContent).toContain(
      "approve it again to update the spec PR",
    );
  });
});

describe("PlanToolbar regenerate", () => {
  it("offers Regenerate plan while the plan is being written", () => {
    renderToolbar();

    expect(
      screen.getByRole("button", { name: "Regenerate plan" }),
    ).toBeInTheDocument();
  });

  it("offers Regenerate plan for a plan no run was ever started for", () => {
    renderToolbar({ run: null });

    expect(
      screen.getByRole("button", { name: "Regenerate plan" }),
    ).toBeInTheDocument();
  });

  it("offers no Regenerate plan on an approved plan", () => {
    renderToolbar({
      meta: { ...META, status: "approved" },
      state: "spec-pr-open",
    });

    expect(
      screen.queryByRole("button", { name: "Regenerate plan" }),
    ).toBeNull();
  });

  it("draws Regenerate plan as a secondary button while its popup stays red", () => {
    renderToolbar({ run: FAILED_RUN });
    const trigger = screen.getByRole("button", { name: "Regenerate plan" });

    fireEvent.click(trigger);

    expect({
      trigger: trigger.className,
      confirm: screen.getByRole("button", { name: "Regenerate" }).className,
    }).toEqual({ trigger: "btn-secondary", confirm: "danger" });
  });

  it("regenerates the failed plan only after the confirmation popup, then refreshes", async () => {
    const draftAgain = vi.fn(async () => ({}));

    renderToolbar({ run: FAILED_RUN, draftAgain });
    fireEvent.click(screen.getByRole("button", { name: "Regenerate plan" }));
    const asked = draftAgain.mock.calls.length;

    await act(async () => {
      fireEvent.click(
        within(screen.getByRole("dialog")).getByRole("button", {
          name: "Regenerate",
        }),
      );
    });

    expect({
      asked,
      regenerated: draftAgain.mock.calls.length,
      refreshed: refresh.mock.calls.length,
    }).toEqual({ asked: 0, regenerated: 1, refreshed: 1 });
  });

  it("closes the popup without regenerating when cancelled", () => {
    const draftAgain = vi.fn(async () => ({}));

    renderToolbar({ run: FAILED_RUN, draftAgain });
    fireEvent.click(screen.getByRole("button", { name: "Regenerate plan" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect({
      dialog: screen.queryByRole("dialog"),
      calls: draftAgain.mock.calls.length,
    }).toEqual({ dialog: null, calls: 0 });
  });

  it("warns in the popup that the agent's draft can replace what the plan's sections say", () => {
    renderToolbar({ run: FAILED_RUN });
    fireEvent.click(screen.getByRole("button", { name: "Regenerate plan" }));

    expect(screen.getByRole("dialog")).toHaveTextContent(
      "can replace what its sections say",
    );
  });
});

describe("PlanToolbar actions menu", () => {
  it("lists Delete plan in the actions menu", () => {
    renderToolbar();
    const before = screen.queryByRole("button", { name: "Delete plan" });

    openActionsMenu();

    expect({
      before,
      after: screen.queryByRole("button", { name: "Delete plan" }) !== null,
    }).toEqual({ before: null, after: true });
  });

  it("asks before deleting the plan, saying it cannot be undone", () => {
    renderToolbar();
    openActionsMenu();
    fireEvent.click(screen.getByRole("button", { name: "Delete plan" }));

    expect(screen.getByRole("dialog")).toHaveTextContent(
      "Faster checkout is removed for good",
    );
  });

  it("keeps Delete off until the plan's name Faster checkout is typed in full", () => {
    renderToolbar();
    openActionsMenu();
    fireEvent.click(screen.getByRole("button", { name: "Delete plan" }));
    const nameField = screen.getByRole("textbox", {
      name: "Type Faster checkout to confirm",
    });
    const deleteButton = screen.getByRole("button", { name: "Delete" });
    const offBeforeTyping = deleteButton.hasAttribute("disabled");

    fireEvent.change(nameField, { target: { value: "Faster" } });
    const offOnPartialName = deleteButton.hasAttribute("disabled");

    fireEvent.change(nameField, { target: { value: "Faster checkout" } });

    expect({
      offBeforeTyping,
      offOnPartialName,
      offOnFullName: deleteButton.hasAttribute("disabled"),
    }).toEqual({
      offBeforeTyping: true,
      offOnPartialName: true,
      offOnFullName: false,
    });
  });

  it("deletes the plan once its name is typed and the delete is confirmed", async () => {
    const deletePlan = vi.fn(async () => ({}));

    renderToolbar({ deletePlan });
    openActionsMenu();
    fireEvent.click(screen.getByRole("button", { name: "Delete plan" }));
    fireEvent.change(
      screen.getByRole("textbox", { name: "Type Faster checkout to confirm" }),
      { target: { value: "Faster checkout" } },
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    });

    expect(deletePlan).toHaveBeenCalledTimes(1);
  });
});

describe("PlanToolbar bar", () => {
  it("names the plan in the bar", () => {
    renderToolbar();

    expect(screen.getByText("Faster checkout").tagName).toBe("STRONG");
  });

  it("leaves a failed pass to the warning", () => {
    renderToolbar({
      run: {
        ...RUN,
        nodes: [{ ...RUN.nodes[0], outcome: "failed" }, RUN.nodes[1]],
      },
    });

    expect(screen.queryByText(/last pass failed/)).toBeNull();
  });

  it("hands the bar element to the page to measure", () => {
    const barRef = createRef<HTMLDivElement>();

    renderToolbar({ barRef });

    expect(barRef.current?.contains(screen.getByText("Faster checkout"))).toBe(
      true,
    );
  });
});

const LINKED_STORY = {
  issueNumber: 123,
  issueUrl: "https://github.com/re-cinq/lore/issues/123",
};

describe("PlanToolbar user story", () => {
  it("lists User story in the actions menu", () => {
    renderToolbar();
    const before = screen.queryByRole("button", { name: /User story/ });

    openActionsMenu();

    expect({
      before,
      after: screen.queryByRole("button", { name: "User story…" }) !== null,
    }).toEqual({ before: null, after: true });
  });

  it("lists User story before Delete plan in the actions menu", () => {
    renderToolbar();
    openActionsMenu();
    const menu = screen.getByRole("button", { name: "User story…" })
      .parentElement as HTMLElement;

    expect(
      within(menu)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["User story…", "Delete plan"]);
  });

  it("draws User story as a secondary menu item, not a filled button", () => {
    renderToolbar();
    openActionsMenu();

    expect(screen.getByRole("button", { name: "User story…" }).className).toBe(
      "btn-secondary",
    );
  });

  it("opens the user story popup prefilled with 123 for a plan linked to #123", () => {
    renderToolbar({ story: LINKED_STORY });
    openActionsMenu();
    fireEvent.click(screen.getByRole("button", { name: "User story…" }));

    expect(
      within(screen.getByRole("dialog")).getByRole("textbox", {
        name: "Issue URL or number",
      }),
    ).toHaveValue("123");
  });

  it("keeps the popup open when a press lands inside it", () => {
    renderToolbar({ story: LINKED_STORY });
    openActionsMenu();
    fireEvent.click(screen.getByRole("button", { name: "User story…" }));
    fireEvent.mouseDown(
      within(screen.getByRole("dialog")).getByRole("textbox", {
        name: "Issue URL or number",
      }),
    );

    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("saves story 456 from the popup through the page's action", async () => {
    const saveStory = vi.fn(async (_text: string) => ({}));

    renderToolbar({ story: LINKED_STORY, saveStory });
    openActionsMenu();
    fireEvent.click(screen.getByRole("button", { name: "User story…" }));
    fireEvent.change(
      screen.getByRole("textbox", { name: "Issue URL or number" }),
      {
        target: { value: "456" },
      },
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });

    expect(saveStory.mock.calls).toEqual([["456"]]);
  });

  it("closes the popup once the story is saved", async () => {
    renderToolbar({ story: LINKED_STORY });
    openActionsMenu();
    fireEvent.click(screen.getByRole("button", { name: "User story…" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Remove link" }));
    });

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("leaves the story to the right panel and links none in the bar", () => {
    renderToolbar({ story: LINKED_STORY });

    expect(
      screen.getAllByRole("link").map((link) => link.getAttribute("href")),
    ).toEqual(["/assembly-runs/r1"]);
  });
});

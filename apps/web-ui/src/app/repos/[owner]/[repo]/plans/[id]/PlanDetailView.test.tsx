// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { PlanMeta } from "@re-cinq/planning-document";
import PlanDetailView from "./PlanDetailView";
import type { PlanRun } from "./PlanRunCard";

vi.mock("@/components/Icon", () => ({ default: () => <i /> }));
const preloadPlanEditor = vi.hoisted(() => vi.fn());

vi.mock("./PlanWorkspace", () => ({
  preloadPlanEditor,
  default: ({
    user,
    story,
    onRefineFailures,
  }: {
    user: { name: string };
    story: { issueNumber: number | null } | null;
    onRefineFailures: (failures: unknown[]) => void;
  }) => (
    <button
      data-story={story?.issueNumber}
      onClick={() =>
        onRefineFailures([
          { slot: "scope", title: "Scope", reason: "no proposal came back" },
        ])
      }
    >
      editor for {user.name}
    </button>
  ),
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

const actions = {
  refine: async () => ({}),
  draftAgain: async () => ({}),
  openSocket: async () => ({ error: "unused" }),
  approve: async () => ({}),
  reopen: async () => ({}),
  retrySpecWork: async () => ({}),
  reworkSpecs: async () => ({}),
  validate: async () => ({}),
  generatePrototype: async () => ({}),
  deletePlan: vi.fn(async () => ({})),
  story: null,
  saveStory: async () => ({}),
  removeStory: async () => ({}),
  runState: "known" as const,
  retryRun: () => {},
};

const QUEUED_RUN: PlanRun = {
  id: "r1",
  status: "queued",
  outcome: null,
  reason: null,
  issueUrl: null,
  issueNumber: null,
  prUrl: null,
  prNumber: null,
  prTitle: null,
  prUnresolvedThreads: null,
  specPlanSummary: null,
  nodes: [],
};

describe("PlanDetailView", () => {
  it("opens the editor for the signed-in Bogdan", () => {
    render(
      <PlanDetailView
        meta={META}
        run={null}
        user={{ id: "gedaiu", name: "Bogdan" }}
        {...actions}
      />,
    );

    expect(screen.getByText("editor for Bogdan")).toBeInTheDocument();
  });

  it("holds the editor back while the planning agent is drafting the plan", () => {
    render(
      <PlanDetailView
        meta={META}
        run={QUEUED_RUN}
        user={{ id: "gedaiu", name: "Bogdan" }}
        {...actions}
      />,
    );

    expect({
      editor: screen.queryByText("editor for Bogdan"),
      drafting: screen.queryByText(/writing this plan/) !== null,
    }).toEqual({ editor: null, drafting: true });
  });

  it("asks a visitor without a session to sign in instead of opening the editor", () => {
    render(<PlanDetailView meta={META} run={null} user={null} {...actions} />);

    expect(screen.getByText("Sign in to open this plan.")).toBeInTheDocument();
  });
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {} }),
}));

describe("PlanDetailView toolbar height", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("hands the editor the toolbar's height", () => {
    let resize: () => void = () => {};

    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          resize = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      height: 64,
    } as DOMRect);
    const { container } = render(
      <PlanDetailView
        meta={META}
        run={null}
        user={{ id: "gedaiu", name: "Bogdan" }}
        {...actions}
      />,
    );

    act(() => resize());

    expect(
      (container.firstElementChild as HTMLElement).style.getPropertyValue(
        "--plan-toolbar-height",
      ),
    ).toBe("64px");
  });
});

describe("PlanDetailView refine warning", () => {
  it("warns above the editor once the editor reports Scope's refine failed", () => {
    render(
      <PlanDetailView
        meta={META}
        run={null}
        user={{ id: "gedaiu", name: "Bogdan" }}
        {...actions}
      />,
    );

    fireEvent.click(screen.getByText("editor for Bogdan"));

    expect(screen.getByRole("alert").textContent).toContain(
      'could not refine "Scope": no proposal came back.',
    );
  });
});

describe("PlanDetailView user story", () => {
  it("hands the editor panel story #123 and keeps it out of the toolbar's bar", () => {
    render(
      <PlanDetailView
        meta={META}
        run={null}
        user={{ id: "gedaiu", name: "Bogdan" }}
        {...actions}
        story={{
          issueNumber: 123,
          issueUrl: "https://github.com/re-cinq/lore/issues/123",
        }}
      />,
    );

    expect({
      story: screen.getByText("editor for Bogdan").getAttribute("data-story"),
      links: screen.queryAllByRole("link", { name: /123/ }),
    }).toEqual({ story: "123", links: [] });
  });
});

describe("the plan page before its run is known", () => {
  const BOGDAN = { id: "gedaiu", name: "Bogdan" };

  function page(runState: "unknown" | "failed", retryRun = () => {}) {
    render(
      <PlanDetailView
        meta={META}
        {...actions}
        run={null}
        runState={runState}
        retryRun={retryRun}
        user={BOGDAN}
      />,
    );
  }

  it("draws Faster checkout's toolbar and its actions menu at once, and a loading body instead of the editor", () => {
    page("unknown");

    expect({
      title: screen.getByText("Faster checkout") !== null,
      menu:
        screen.queryByRole("button", { name: "More plan actions" }) !== null,
      loading:
        screen.queryByRole("status", { name: "Loading the planning run" }) !==
        null,
      editor: screen.queryByText("editor for Bogdan"),
      noRunYet: screen.queryByText(/No planning run yet/),
      regenerate: screen.queryByRole("button", { name: "Regenerate plan" }),
    }).toEqual({
      title: true,
      menu: true,
      loading: true,
      editor: null,
      noRunYet: null,
      regenerate: null,
    });
  });

  it("says the planning run could not be loaded and opens no editor when the channel failed", () => {
    page("failed");

    expect({
      error: screen.getByRole("alert").textContent,
      editor: screen.queryByText("editor for Bogdan"),
      noRunYet: screen.queryByText(/No planning run yet/),
    }).toEqual({
      error: "Couldn't load the planning run.",
      editor: null,
      noRunYet: null,
    });
  });

  it("opens the run's channel again on Retry", () => {
    const retryRun = vi.fn();

    page("failed", retryRun);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(retryRun).toHaveBeenCalledTimes(1);
  });

  it("starts loading the editor's code on mount while the run is still unknown", () => {
    preloadPlanEditor.mockClear();
    page("unknown");

    expect(preloadPlanEditor).toHaveBeenCalledTimes(1);
  });
});

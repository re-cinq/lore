// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { PlanMeta } from "@re-cinq/planning-document";
import PlanDetailView from "./PlanDetailView";
import type { PlanRun } from "./PlanRunCard";

vi.mock("@/components/Icon", () => ({ default: () => <i /> }));
vi.mock("./PlanWorkspace", () => ({
  default: ({
    user,
    onRefineFailures,
  }: {
    user: { name: string };
    onRefineFailures: (failures: unknown[]) => void;
  }) => (
    <button
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
  deletePlan: vi.fn(async () => ({})),
  refreshRunFacts: async () => ({ run: null }),
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

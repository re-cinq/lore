// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { PlanMeta } from "@re-cinq/planning-document";
import PlanDetailView from "./PlanDetailView";

vi.mock("./PlanWorkspace", () => ({
  default: ({ user }: { user: { name: string } }) => (
    <p>editor for {user.name}</p>
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
};

describe("PlanDetailView", () => {
  it("opens the editor for the signed-in Bogdan", () => {
    render(
      <PlanDetailView
        meta={META}
        run={null}
        user={{ id: "gedaiu", name: "Bogdan", color: "red" }}
        {...actions}
      />,
    );

    expect(screen.getByText("editor for Bogdan")).toBeInTheDocument();
  });

  it("holds the editor back while the planning agent is drafting the plan", () => {
    render(
      <PlanDetailView
        meta={META}
        run={{
          id: "r1",
          status: "queued",
          outcome: null,
          reason: null,
          prUrl: null,
          prNumber: null,
          nodes: [],
        }}
        user={{ id: "gedaiu", name: "Bogdan", color: "red" }}
        {...actions}
      />,
    );

    expect({
      editor: screen.queryByText("editor for Bogdan"),
      drafting: screen.queryByText(/writing this plan/) !== null,
    }).toEqual({ editor: null, drafting: true });
  });

  it("says gedaiu approved the plan on 2026-09-23 in the header", () => {
    render(
      <PlanDetailView
        meta={{
          ...META,
          status: "approved",
          approval: {
            mode: "manual",
            approvedBy: "gedaiu",
            approvedAt: "2026-09-23T10:00:00.000Z",
            version: 2,
          },
        }}
        run={null}
        user={{ id: "gedaiu", name: "Bogdan", color: "red" }}
        {...actions}
      />,
    );

    expect(screen.getByText(/approved by gedaiu on/).textContent).toContain(
      new Date("2026-09-23T10:00:00.000Z").toLocaleDateString(),
    );
  });

  it("asks a visitor without a session to sign in instead of opening the editor", () => {
    render(<PlanDetailView meta={META} run={null} user={null} {...actions} />);

    expect(screen.getByText("Sign in to open this plan.")).toBeInTheDocument();
  });
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {} }),
}));

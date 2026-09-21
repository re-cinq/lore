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
  openSocket: async () => ({ error: "unused" }),
  approve: async () => ({}),
};

describe("PlanDetailView", () => {
  it("opens the editor for the signed-in Bogdan", () => {
    render(
      <PlanDetailView
        meta={META}
        user={{ id: "gedaiu", name: "Bogdan", color: "red" }}
        {...actions}
      />,
    );

    expect(screen.getByText("editor for Bogdan")).toBeInTheDocument();
  });

  it("asks a visitor without a session to sign in instead of opening the editor", () => {
    render(<PlanDetailView meta={META} user={null} {...actions} />);

    expect(screen.getByText("Sign in to open this plan.")).toBeInTheDocument();
  });
});

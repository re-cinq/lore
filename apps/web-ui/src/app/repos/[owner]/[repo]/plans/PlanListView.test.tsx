// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import PlanListView from "./PlanListView";

const linkStatus = vi.hoisted(() => ({ pending: false }));

vi.mock("next/link", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/link")>();

  return { ...actual, useLinkStatus: () => linkStatus };
});

const BASE = "/repos/re-cinq/lore/plans";
const PLAN = {
  id: "p1",
  title: "Faster checkout",
  type: "performance",
  status: "approved",
  version: 4,
  createdBy: "gedaiu",
  updatedAt: "2026-09-21T10:00:00.000Z",
};

describe("PlanListView", () => {
  it("invites a first plan with + Plan when the repo has none", () => {
    render(<PlanListView base={BASE} plans={[]} />);

    expect(screen.getByText(/No plans yet/)).toHaveTextContent(
      "No plans yet. Click + Plan to write one with the planning agent.",
    );
  });

  it("links Faster checkout to its plan page with its Approved status", () => {
    render(<PlanListView base={BASE} plans={[PLAN]} />);

    expect(screen.getByRole("link", { name: /Faster checkout/ })).toMatchObject(
      {
        href: expect.stringContaining(`${BASE}/p1`),
        textContent: expect.stringContaining("Approved"),
      },
    );
  });

  it("marks Faster checkout as Opening plan while its page loads", () => {
    linkStatus.pending = true;
    render(<PlanListView base={BASE} plans={[PLAN]} />);
    linkStatus.pending = false;

    expect(
      screen.getByRole("link", { name: /Faster checkout/ }),
    ).toContainElement(screen.getByRole("status", { name: "Opening plan" }));
  });

  it("shows no Opening plan mark on a card nobody clicked", () => {
    render(<PlanListView base={BASE} plans={[PLAN]} />);

    expect(screen.queryByRole("status", { name: "Opening plan" })).toBeNull();
  });
});

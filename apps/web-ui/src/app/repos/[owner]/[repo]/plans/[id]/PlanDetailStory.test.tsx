// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { PlanMeta } from "@re-cinq/planning-document";
import PlanDetailStory from "./PlanDetailStory";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {} }),
}));
vi.mock("./PlanWorkspace", () => ({ default: () => null }));

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

const FAILED_RUN = {
  id: "r1",
  status: "failed",
  outcome: null,
  reason: "no cluster-agent claimed this run",
  issueUrl: null,
  issueNumber: null,
  prUrl: null,
  prNumber: null,
  prTitle: null,
  prUnresolvedThreads: null,
  specPlanSummary: null,
  nodes: [],
};

describe("PlanDetailStory", () => {
  it("regenerates the plan with story #42 once #42 is typed into the User story field", async () => {
    const draftAgain = vi.fn(async (_story: string) => ({}));

    render(
      <PlanDetailStory
        meta={META}
        run={FAILED_RUN}
        user={null}
        draftAgain={draftAgain}
        refine={async () => ({})}
        retrySpecWork={async () => ({})}
        openSocket={async () => ({ error: "unused" })}
        approve={async () => ({})}
        reopen={async () => ({})}
        reworkSpecs={async () => ({})}
        validate={async () => ({})}
        deletePlan={async () => ({})}
      />,
    );
    fireEvent.change(screen.getByRole("textbox", { name: "User story" }), {
      target: { value: "#42" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Regenerate plan" }));
    await act(async () => {
      fireEvent.click(
        within(screen.getByRole("dialog")).getByRole("button", {
          name: "Regenerate",
        }),
      );
    });

    expect(draftAgain.mock.calls).toEqual([["#42"]]);
  });
});

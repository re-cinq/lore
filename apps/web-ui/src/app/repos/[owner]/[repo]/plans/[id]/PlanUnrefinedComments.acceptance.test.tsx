// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { PlanMeta } from "@re-cinq/planning-document";
import { planWith, textBlock } from "@re-cinq/planning-document/testing";
import { createMemoryHub } from "@re-cinq/planning-editor";
import PlanEditorPanel from "./PlanEditorPanel";
import type { PlanUser } from "@/lib/plan-user";

const META: PlanMeta = {
  schemaVersion: 1,
  id: "p1",
  repo: "re-cinq/lore",
  type: "feature",
  templateVersion: 1,
  title: "Test Plan",
  status: "draft",
  approval: null,
  version: 2,
  createdBy: "gedaiu",
  updatedAt: "2026-09-21T10:00:00.000Z",
};

const blocks = planWith("feature", {
  intent: [
    textBlock(
      "comment",
      { commentId: "c1", resolved: true, used: false },
      "comment 1",
    ),
  ],
  scope: [
    textBlock(
      "comment",
      { commentId: "c2", resolved: true, used: false },
      "comment 2",
    ),
  ],
  kpis: [
    textBlock(
      "comment",
      { commentId: "c3", resolved: true, used: false },
      "comment 3",
    ),
  ],
});
const hub = createMemoryHub({ meta: META, blocks });

vi.mock("@/lib/live-socket/plan-provider", () => ({
  planProvider: () => ({
    provider: {
      document: hub.doc,
      awareness: null,
      synced: true,
      on: () => {},
      destroy: () => {},
    },
    destroy: () => {},
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {} }),
}));

vi.mock("@/lib/live-socket/LiveSocketProvider", () => ({
  useLiveSocket: () => ({}),
}));

const USER: PlanUser = { id: "u1", name: "Test User" };

describe("PlanEditorPanel", () => {
  it("marks each of the 3 sections holding a resolved comment no refine used as waiting for a refine", async () => {
    render(
      <PlanEditorPanel
        meta={META}
        user={USER}
        state="writing"
        prUrl={null}
        prNumber={null}
        prTitle={null}
        prUnresolvedThreads={null}
        refine={async () => ({})}
        openSocket={async () => ({ documentName: "test", token: "tok" })}
        approve={async () => ({})}
        reopen={async () => ({})}
        retrySpecWork={async () => ({})}
        reworkSpecs={async () => ({})}
        validate={async () => ({})}
        refreshRunFacts={async () => ({ run: null })}
      />,
    );

    expect(
      await screen.findAllByText("1 settled input waiting for a refine"),
    ).toHaveLength(3);
  });
});

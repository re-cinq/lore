// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ComponentProps } from "react";
import { render, waitFor } from "@testing-library/react";
import type { PlanMeta } from "@re-cinq/planning-document";
import PlanEditorPanel from "./PlanEditorPanel";

const destroy = vi.fn();
const client = {};

vi.mock("@/lib/live-socket/LiveSocketProvider", () => ({
  useLiveSocket: () => client,
}));
vi.mock("@/lib/live-socket/plan-provider", () => ({
  planProvider: () => ({ provider: {}, destroy: vi.fn() }),
}));
vi.mock("@re-cinq/planning-editor", () => ({
  PlanEditor: () => <p>editor</p>,
  transportFor: () => ({ destroy }),
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

const props = (
  openSocket: () => Promise<{ documentName: string }>,
): ComponentProps<typeof PlanEditorPanel> =>
  ({
    meta: { ...META },
    user: { name: "Bogdan" },
    state: { kind: "editing" },
    prUrl: null,
    prNumber: null,
    prTitle: null,
    prUnresolvedThreads: null,
    openSocket,
  }) as unknown as ComponentProps<typeof PlanEditorPanel>;

beforeEach(() => destroy.mockClear());

describe("PlanEditorPanel", () => {
  it("keeps plan p1's collab session when a refresh hands it an equal meta and a new openSocket", async () => {
    const first = vi.fn(async () => ({ documentName: "plan:p1" }));
    const second = vi.fn(async () => ({ documentName: "plan:p1" }));
    const view = render(<PlanEditorPanel {...props(first)} />);

    await waitFor(() => expect(view.getByText("editor")).toBeTruthy());
    view.rerender(<PlanEditorPanel {...props(second)} />);
    await Promise.resolve();

    expect({
      opened: first.mock.calls.length + second.mock.calls.length,
      destroyed: destroy.mock.calls.length,
    }).toEqual({ opened: 1, destroyed: 0 });
  });
});

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ComponentProps } from "react";
import { render, waitFor } from "@testing-library/react";
import type { PlanEditorAdapters } from "@re-cinq/planning-editor";
import type { PlanMeta } from "@re-cinq/planning-document";
import PlanEditorPanel from "./PlanEditorPanel";

const destroy = vi.fn();
const client = {};
const editorProps = vi.hoisted(
  () =>
    ({}) as {
      onRefineFailures?: (failures: unknown[]) => void;
      adapters?: PlanEditorAdapters;
      onGeneratePrototype?: () => Promise<void>;
    },
);

vi.mock("@/lib/live-socket/LiveSocketProvider", () => ({
  useLiveSocket: () => client,
}));
vi.mock("@/lib/live-socket/plan-provider", () => ({
  planProvider: () => ({ provider: {}, destroy: vi.fn() }),
}));
vi.mock("@re-cinq/planning-editor", () => ({
  PlanEditor: (received: typeof editorProps) => {
    Object.assign(editorProps, received);

    return <p>editor</p>;
  },
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

  it("wraps the editor in an element of its own, which sets the plan page's narrower padding", async () => {
    const view = render(
      <PlanEditorPanel {...props(async () => ({ documentName: "plan:p1" }))} />,
    );

    await waitFor(() => expect(view.getByText("editor")).toBeTruthy());

    expect(view.getByText("editor").parentElement?.className).toMatch(/editor/);
  });

  it("passes the editor's failed refines on to the page", async () => {
    const onRefineFailures = vi.fn();
    const view = render(
      <PlanEditorPanel
        {...props(async () => ({ documentName: "plan:p1" }))}
        onRefineFailures={onRefineFailures}
      />,
    );

    await waitFor(() => expect(view.getByText("editor")).toBeTruthy());
    editorProps.onRefineFailures?.([{ slot: "scope" }]);

    expect(onRefineFailures).toHaveBeenCalledWith([{ slot: "scope" }]);
  });

  it("hands the editor a sketch renderer", async () => {
    const view = render(
      <PlanEditorPanel {...props(async () => ({ documentName: "plan:p1" }))} />,
    );

    await waitFor(() => expect(view.getByText("editor")).toBeTruthy());
    const sketch = render(
      <>
        {editorProps.adapters?.renderMockup?.({
          kind: "states",
          caption: "Run states",
          format: "text",
          markup: "draft -> approved",
          height: 120,
        })}
      </>,
    );

    expect(sketch.container.querySelector("pre")?.textContent).toBe(
      "draft -> approved",
    );
  });

  it("rejects Generate prototype with lore-api's refusal", async () => {
    const generatePrototype = async () => ({
      error: "The plan is approved.",
    });
    const view = render(
      <PlanEditorPanel
        {...props(async () => ({ documentName: "plan:p1" }))}
        generatePrototype={generatePrototype}
      />,
    );

    await waitFor(() => expect(view.getByText("editor")).toBeTruthy());

    await expect(editorProps.onGeneratePrototype?.()).rejects.toThrow(
      new Error("The plan is approved."),
    );
  });

  it("resolves Generate prototype when the sketch agent was started", async () => {
    const generatePrototype = vi.fn(async () => ({}));
    const view = render(
      <PlanEditorPanel
        {...props(async () => ({ documentName: "plan:p1" }))}
        generatePrototype={generatePrototype}
      />,
    );

    await waitFor(() => expect(view.getByText("editor")).toBeTruthy());

    await expect(editorProps.onGeneratePrototype?.()).resolves.toBeUndefined();
    expect(generatePrototype).toHaveBeenCalledOnce();
  });
});

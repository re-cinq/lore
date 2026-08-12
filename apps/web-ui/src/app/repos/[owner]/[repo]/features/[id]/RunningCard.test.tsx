// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import RunningCard from "./RunningCard";
import { featurePlanningDefinition } from "@/lib/builtin-definitions";
import type { FeatureRunPayload } from "@/lib/feature-run";

/** The panel opens an SSE stream for a live run; jsdom has no EventSource. */
class SilentEventSource {
  onerror: ((e: Event) => void) | null = null;
  constructor(readonly url: string) {}
  addEventListener() {}
  removeEventListener() {}
  close() {}
}

function stubStream() {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ events: [] }),
    }),
  );
  vi.stubGlobal("EventSource", SilentEventSource);
}

const run: FeatureRunPayload = {
  id: "ae7918b1-4baa-41fc-8b34-deb1be4cddf9",
  status: "running",
  startedAt: "2026-08-10T13:13:31.702Z",
  repo: "re-cinq/lore",
  reason: null,
  definition: featurePlanningDefinition,
  synthetic: false,
  nodes: [],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("RunningCard", () => {
  it("announces the round number and the elapsed / budget timer", () => {
    render(
      <RunningCard
        iteration={3}
        since={new Date().toISOString()}
        timeoutMinutes={15}
      />,
    );

    expect(
      screen.getByText(
        /Analyzing your feature against the project… \(round 3\)/,
      ),
    ).toBeTruthy();
    expect(screen.getByRole("timer")).toHaveTextContent("/ 15:00");
  });

  it("draws the planning graph before the run has recorded a single node", async () => {
    stubStream();

    await act(async () => {
      render(
        <RunningCard
          iteration={3}
          since="2026-08-10T13:13:31.702Z"
          timeoutMinutes={15}
          run={run}
        />,
      );
    });

    // Node labels are split across SVG <text>/<tspan>, so assert on the graph's
    // own data attributes rather than on rendered text.
    expect(document.querySelector('[data-node="analyze"]')).toBeTruthy();
    expect(document.querySelector('[data-edge="analyze->done"]')).toBeTruthy();
  });

  it("renders no run visualization while the round has no assembly line", () => {
    render(
      <RunningCard
        iteration={1}
        since="2026-08-10T13:13:31.702Z"
        timeoutMinutes={15}
        run={null}
      />,
    );

    expect(document.querySelector('[data-node="analyze"]')).toBeNull();
  });

  it("shows the local station log tail when one is available", () => {
    render(
      <RunningCard
        iteration={1}
        since="2026-08-10T13:13:31.702Z"
        timeoutMinutes={15}
        liveOutput="→ Bash: jq empty result.json"
      />,
    );

    expect(screen.getByText("→ Bash: jq empty result.json")).toBeTruthy();
  });
});

describe("the card during the spec phase", () => {
  // Accepting a plan used to leave a row of DEAD BUTTONS — "Refine again" disabled
  // beside a primary relabelled "Creating the spec PR…" — and the run graph vanished,
  // because the graph only ever rendered while a planning ROUND was running. The
  // spec work runs on the same line and deserves the same card.
  it("announces the spec phase instead of a planning round", () => {
    render(
      <RunningCard
        iteration={3}
        since={undefined}
        timeoutMinutes={15}
        phase="spec"
      />,
    );

    expect(
      screen.getByText(/writing the spec/i, { exact: false }),
    ).toBeTruthy();
    expect(screen.queryByText(/round 3/i)).toBeNull();
  });

  it("still says which round it is analysing during a planning round", () => {
    render(<RunningCard iteration={3} since={undefined} timeoutMinutes={15} />);

    expect(screen.getByText(/round 3/i)).toBeTruthy();
  });
});

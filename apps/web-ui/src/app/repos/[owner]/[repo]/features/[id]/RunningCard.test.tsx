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
  tokens: null,
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
    // analyze -> author, the real first edge. This asserted "analyze->done" while
    // the hand-transcribed mirror claimed the line was two nodes long.
    expect(
      document.querySelector('[data-edge="analyze->author"]'),
    ).toBeTruthy();
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

// What the card says about TIME and SPEND while a node runs.
//
// The budget it showed was the feature-planning AGENT DEFINITION's timeout — a
// number nothing enforces, and one number for a line whose nodes have separate
// budgets, so the spec phase counted against the planning round's clock. The real
// bar is the reaper's: the node's own `timeout_minutes` plus its grace.
describe("the time budget", () => {
  const at = (nodeId: string) => ({
    ...run,
    definition: featurePlanningDefinition,
    nodeId,
  });

  it("counts against the WORKING NODE's kill budget, not the round's", () => {
    render(
      <RunningCard
        iteration={1}
        since={new Date().toISOString()}
        timeoutMinutes={15}
        nodeId="analyze"
        run={at("analyze")}
      />,
    );

    // feature-planning declares no per-node timeout, so the reaper's own default
    // (60) plus its 2-minute grace is what actually kills the pod.
    expect(screen.getByRole("timer")).toHaveTextContent("/ 62:00");
  });

  it("falls back to the round's budget for a feature that resolves no line", () => {
    render(
      <RunningCard
        iteration={1}
        since={new Date().toISOString()}
        timeoutMinutes={15}
        run={null}
      />,
    );

    expect(screen.getByRole("timer")).toHaveTextContent("/ 15:00");
  });

  it("names the budget as the kill deadline it is", () => {
    render(
      <RunningCard
        iteration={1}
        since={new Date().toISOString()}
        timeoutMinutes={15}
        nodeId="analyze"
        run={at("analyze")}
      />,
    );

    expect(screen.getByRole("timer").getAttribute("aria-label")).toMatch(
      /before it is stopped/i,
    );
  });
});

describe("the token counter", () => {
  it("reports what the run has spent so far", () => {
    render(
      <RunningCard
        iteration={1}
        since={new Date().toISOString()}
        timeoutMinutes={15}
        run={{ ...run, tokens: { input: 64010, output: 5, total: 64015 } }}
      />,
    );

    expect(screen.getByText(/64\.0k tokens/)).toBeTruthy();
  });

  it("breaks the total into prompt and completion for the reader who wants it", () => {
    render(
      <RunningCard
        iteration={1}
        since={new Date().toISOString()}
        timeoutMinutes={15}
        run={{ ...run, tokens: { input: 64010, output: 5, total: 64015 } }}
      />,
    );

    expect(screen.getByText(/64\.0k tokens/).getAttribute("title")).toEqual(
      "64,010 prompt (including cached) + 5 completion",
    );
  });

  it("says nothing at all before the run has reported any usage", () => {
    render(
      <RunningCard
        iteration={1}
        since={new Date().toISOString()}
        timeoutMinutes={15}
        run={{ ...run, tokens: null }}
      />,
    );

    expect(screen.queryByText(/tokens/)).toBeNull();
  });
});

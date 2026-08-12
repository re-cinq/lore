// @vitest-environment jsdom
//
// The accept flow, end to end, against a mocked server.
//
// Every part of this walk broke in production during one evening — the button did
// nothing visible, the graph vanished, a finished line left a progress card ticking
// past 80 minutes, and the controls never came back — and not one of those was caught
// by a unit test, because each component was individually correct. What was wrong was
// the SEQUENCE. So this drives the sequence: parked → press → spec phase → the line
// finishing, asserting what the author can SEE at each step.
//
// The server is the poll endpoint plus the `finalize` action; both are mocked, so the
// test asserts the wizard's reaction to server states rather than any real pipeline.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PlanningWizard from "./PlanningWizard";
import type {
  FeatureWithIterations,
  FeatureIterationRow,
  GapResult,
} from "@/lib/feature-types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

/** The run panel opens an SSE stream; jsdom has no EventSource, and the graph's
 *  own rendering is not what this test is about — only whether it is on screen. */
vi.mock("@/app/assembly-lines/[id]/RunVisualizationPanel", () => ({
  default: () => <div data-testid="run-graph" />,
}));

const gap: GapResult = {
  sections: [{ title: "Overview", content: "A spec standard." }],
  draft_spec_markdown: "# Spec standard",
};

const round = (
  over: Partial<FeatureIterationRow> = {},
): FeatureIterationRow => ({
  id: "it3",
  feature_id: "f1",
  iteration: 3,
  task_id: null,
  status: "ready",
  user_answers: null,
  gap_result: gap,
  created_at: "2026-08-12T18:00:00Z",
  ...over,
});

const feature = (): FeatureWithIterations =>
  ({
    id: "f1",
    title: "Define the spec standard",
    status: "awaiting-input",
    current_iteration: 3,
    iterations: [round()],
  }) as unknown as FeatureWithIterations;

/** One node row as the poll payload carries it. */
const node = (nodeId: string, outcome: string | null) => ({
  nodeId,
  iteration: 3,
  outcome,
  startedAt: "2026-08-12T19:30:00Z",
  agentCrName: null,
  commitSha: null,
  durationSeconds: null,
});

/** A poll response: the feature, its latest round, and the line's current shape. */
const poll = (status: string, nodes: ReturnType<typeof node>[]) => ({
  feature: feature(),
  latestIteration: round(),
  task: { status: "completed", failure_reason: null },
  run: {
    id: "line-1",
    status,
    startedAt: "2026-08-12T18:00:00Z",
    repo: "re-cinq/lore",
    reason: null,
    definition: null,
    synthetic: true,
    nodes,
  },
});

/** Drives the poll endpoint: each call returns the next queued server state, and the
 *  last one repeats — the wizard polls on a timer and must not run off the end. */
function server(states: object[]) {
  let at = 0;

  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => states[Math.min(at++, states.length - 1)],
  }));
}

/** Let the polling interval fire once and the resulting state settle. */
async function tick() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(4000);
  });
}

function mount(states: object[]) {
  const fetchMock = server(states);

  vi.stubGlobal("fetch", fetchMock);
  const finalize = vi.fn().mockResolvedValue(undefined);

  render(
    <PlanningWizard
      owner="re-cinq"
      repo="lore"
      feature={feature()}
      timeoutMinutes={15}
      refine={vi.fn().mockResolvedValue(undefined)}
      finalize={finalize}
      onCreateDraft={vi.fn()}
    />,
  );

  return { finalize };
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("pressing Create the spec PR", () => {
  const parked = poll("running", [node("analyze", "success")]);
  const analysing = poll("running", [
    node("analyze", "success"),
    node("author", "success"),
    node("analyse-specs", null),
  ]);
  const finished = poll("finished", [
    node("analyse-specs", "success"),
    node("write", "success"),
    node("push", "success"),
  ]);

  it("offers the decision while the line waits on the author", async () => {
    mount([parked]);

    expect(
      screen.getByRole("button", { name: /create the spec pr/i }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: /refine again/i })).toBeTruthy();
  });

  it("reports the accept to the server exactly once per press", async () => {
    const { finalize } = mount([parked, analysing]);

    await userEvent.click(
      screen.getByRole("button", { name: /create the spec pr/i }),
    );

    expect(finalize).toHaveBeenCalledTimes(1);
  });

  it("replaces the decision with the spec phase, and shows the graph", async () => {
    // The two bugs the author actually hit: a row of DISABLED buttons ("press one and
    // the other says waiting"), and the run graph disappearing — it rendered only
    // while a planning round was running, so accepting blanked the one live view.
    mount([parked, analysing]);

    await userEvent.click(
      screen.getByRole("button", { name: /create the spec pr/i }),
    );
    await tick();

    expect(screen.getByText(/writing the spec/i)).toBeTruthy();
    expect(screen.getByTestId("run-graph")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /refine again/i })).toBeNull();
    expect(
      screen.queryByRole("button", { name: /create the spec pr/i }),
    ).toBeNull();
  });

  it("gives the controls back when the line ends without a PR", async () => {
    // The worst of the four: a finished line left "Writing the spec…" on screen
    // forever, because the phase came from a local flag that only the feature
    // leaving the planning phase could clear — and with no PR, it never did.
    mount([parked, analysing, finished]);

    await userEvent.click(
      screen.getByRole("button", { name: /create the spec pr/i }),
    );
    await tick();
    expect(screen.getByText(/writing the spec/i)).toBeTruthy();

    await tick();

    expect(screen.queryByText(/writing the spec/i)).toBeNull();
    expect(
      screen.getByRole("button", { name: /create the spec pr/i }),
    ).toBeTruthy();
  });

  it("keeps showing the spec phase while the line is still walking it", async () => {
    // write follows analyse-specs on the same line: the author is not back in
    // control between nodes, and a flicker to the decision row would invite the
    // second press that mints a second line.
    const writing = poll("running", [
      node("analyse-specs", "success"),
      node("write", null),
    ]);

    mount([parked, analysing, writing]);

    await userEvent.click(
      screen.getByRole("button", { name: /create the spec pr/i }),
    );
    await tick();
    await tick();

    expect(screen.getByText(/writing the spec/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /refine again/i })).toBeNull();
  });
});

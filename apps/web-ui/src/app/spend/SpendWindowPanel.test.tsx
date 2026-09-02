// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import SpendWindowPanel from "./SpendWindowPanel";

const WINDOW = {
  interval: { from: "2026-08-26", to: "2026-09-02" },
  llm: {
    total_usd: 82.5,
    calls: 42,
    by_blueprint: [{ blueprint: "implementation-loop", runs: 15, usd: 27.47 }],
    by_repo: [{ repo: "re-cinq/lore", usd: 80.1 }],
  },
  compute: {
    rates: { cpu_hour_usd: 0.022, mem_gib_hour_usd: 0.003 },
    assumed_profile: { cpu: "1", memory: "4Gi" },
    pod_hours: [
      { blueprint: "implementation-loop", pods: 9, hours: 6.5, est_usd: 0.22 },
    ],
    est_total_usd: 0.22,
    live_pods: [
      {
        name: "agent-job-run1-tdd-round-abc",
        phase: "Running",
        started_at: "2026-09-02T11:00:00.000Z",
        requests: { cpu: "1", memory: "16Gi" },
        usd_per_hour: 0.07,
        usd_so_far: 0.07,
        station_run_id: "sr-1",
      },
    ],
    live_usd_per_hour: 0.07,
  },
};

function stubFetch() {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => WINDOW,
  });

  vi.stubGlobal("fetch", fetchMock);

  return fetchMock;
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SpendWindowPanel", () => {
  it("fetches the default 7-day window and renders both halves of the spend", async () => {
    const fetchMock = stubFetch();

    render(<SpendWindowPanel />);
    await settle();

    expect(String(fetchMock.mock.calls[0][0])).toMatch(
      /^\/api\/spend-window\?from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}$/,
    );
    expect(screen.getByText("$82.50")).toBeInTheDocument();
    // Twice: the LLM table and the pod-hours table each carry the line.
    expect(screen.getAllByText("implementation-loop")).toHaveLength(2);
    expect(
      screen.getByText("agent-job-run1-tdd-round-abc"),
    ).toBeInTheDocument();
    expect(screen.getByText("+ $0.07/h burning now")).toBeInTheDocument();
    // The estimate is labeled as one, with the rates it assumed.
    expect(
      screen.getByText(
        (_, element) =>
          element?.tagName === "P" &&
          /estimate from resource requests × on-demand rates \(\$0\.022\/cpu-h/.test(
            element.textContent ?? "",
          ),
      ),
    ).toBeInTheDocument();
  });

  it("a preset click refetches with that interval", async () => {
    const fetchMock = stubFetch();

    render(<SpendWindowPanel />);
    await settle();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Today" }));
    });

    const last = String(fetchMock.mock.calls.at(-1)?.[0]);
    const today = new Date().toISOString().slice(0, 10);

    expect(last).toBe(`/api/spend-window?from=${today}&to=${today}`);
  });

  it("an API refusal renders inline instead of a blank section", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ error: "from must not be after to" }),
      }),
    );

    render(<SpendWindowPanel />);
    await settle();

    expect(screen.getByText("from must not be after to")).toBeInTheDocument();
  });
});

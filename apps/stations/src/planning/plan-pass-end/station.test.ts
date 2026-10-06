import { describe, expect, it } from "vitest";
import type { Tools } from "@re-cinq/floor-station";
import { planPassEndHandle, type PlanPassEndDeps } from "./station.js";

const PLAN_ID = "3b3a67af-1111-4a35-9d1f-8f6f0a2f4e21";

const TOOLS: Tools = {
  read: () => Promise.resolve(Buffer.from("")),
  produce: () => Promise.resolve(),
  modelCall: () => Promise.resolve(),
  signal: new AbortController().signal,
};

function refineNeed(slot: string, uses?: unknown): string {
  return JSON.stringify({ slot, baseHash: "h1", ...(uses ? { uses } : {}) });
}

function brief(needs: Partial<Record<string, string>> = {}) {
  return {
    visitId: "visit-pass-end",
    iteration: 1,
    needs: { plan_id: PLAN_ID, ...needs },
  };
}

function scene(
  runId: string | null,
  visits: { nodeId: string; report: { outcome: string } | null }[],
  refineFailedImpl?: (input: {
    planId: string;
    slot: string;
    reason: string;
  }) => Promise<void>,
) {
  const calls: { planId: string; slot: string; reason: string }[] = [];
  const done: { planId: string; slot: string; uses: unknown }[] = [];
  const deps: PlanPassEndDeps = {
    runOf: () => Promise.resolve(runId),
    visitsOf: () => Promise.resolve(visits),
    refineFailed: async (input) => {
      calls.push(input);
      await refineFailedImpl?.(input);
    },
    refineDone: async (input) => {
      done.push(input);
    },
  };

  return { handle: planPassEndHandle(deps), calls, done, deps };
}

describe("planPassEndHandle", () => {
  it("reports success and posts nothing for a first draft, which carries no refine need", async () => {
    const { handle, calls } = scene("run-1", [
      { nodeId: "analyze", report: { outcome: "success" } },
    ]);

    expect(await handle(brief(), TOOLS)).toEqual({
      outcome: "success",
    });
    expect(calls).toEqual([]);
  });

  it("reports success and posts nothing when the refine value is not JSON, which names no section to tell", async () => {
    const { handle, calls } = scene("run-1", [
      { nodeId: "analyze", report: { outcome: "failed" } },
    ]);

    expect(await handle(brief({ refine: "not json at all" }), TOOLS)).toEqual({
      outcome: "success",
    });
    expect(calls).toEqual([]);
  });

  it("reports success and posts nothing for a refine value that names no slot", async () => {
    const { handle, calls } = scene("run-1", [
      { nodeId: "analyze", report: { outcome: "failed" } },
    ]);

    expect(
      await handle(
        brief({ refine: JSON.stringify({ baseHash: "h1" }) }),
        TOOLS,
      ),
    ).toEqual({ outcome: "success" });
    expect(calls).toEqual([]);
  });

  it("posts refine-failed naming the section and reason when the analyze pass it asks for settled failed", async () => {
    const { handle, calls } = scene("run-1", [
      { nodeId: "author", report: { outcome: "changes_requested" } },
      { nodeId: "analyze", report: { outcome: "failed" } },
    ]);

    const result = await handle(brief({ refine: refineNeed("scope") }), TOOLS);

    expect(result).toEqual({ outcome: "success" });
    expect(calls).toEqual([
      {
        planId: PLAN_ID,
        slot: "scope",
        reason:
          "the planning agent stopped with outcome failed before it answered",
      },
    ]);
  });

  it("reads the LATEST analyze visit of the run, not an earlier iteration's", async () => {
    const { handle, calls } = scene("run-1", [
      { nodeId: "analyze", report: { outcome: "failed" } },
      { nodeId: "analyze", report: { outcome: "success" } },
    ]);

    await handle(brief({ refine: refineNeed("intent") }), TOOLS);

    expect(calls).toEqual([]);
  });

  it("posts refine-done for section kpis with the question it used, and no failure, when the analyze pass settled success", async () => {
    const uses = { questions: ["q-1"], comments: [] };
    const { handle, calls, done } = scene("run-1", [
      { nodeId: "analyze", report: { outcome: "success" } },
    ]);

    const result = await handle(
      brief({ refine: refineNeed("kpis", uses) }),
      TOOLS,
    );

    expect({ result, done, calls }).toEqual({
      result: { outcome: "success" },
      done: [{ planId: PLAN_ID, slot: "kpis", uses }],
      calls: [],
    });
  });

  it("posts refine-done with nothing used for an ask that named no settled input", async () => {
    const { handle, done } = scene("run-1", [
      { nodeId: "analyze", report: { outcome: "success" } },
    ]);

    await handle(brief({ refine: refineNeed("scope") }), TOOLS);

    expect(done).toEqual([
      { planId: PLAN_ID, slot: "scope", uses: { questions: [], comments: [] } },
    ]);
  });

  it("reports failed with the error message when the refine-done post itself fails", async () => {
    const { deps } = scene("run-1", [
      { nodeId: "analyze", report: { outcome: "success" } },
    ]);
    const handle = planPassEndHandle({
      ...deps,
      refineDone: () =>
        Promise.reject(new Error("refine-done post failed: 502")),
    });

    expect(await handle(brief({ refine: refineNeed("kpis") }), TOOLS)).toEqual({
      outcome: "failed",
      error: "refine-done post failed: 502",
    });
  });

  it("reports failed with the error message when the refine-failed post itself fails", async () => {
    const { handle } = scene(
      "run-1",
      [{ nodeId: "analyze", report: { outcome: "failed" } }],
      () => Promise.reject(new Error("lore-api unreachable")),
    );

    const result = await handle(brief({ refine: refineNeed("scope") }), TOOLS);

    expect(result).toEqual({
      outcome: "failed",
      error: "lore-api unreachable",
    });
  });
});

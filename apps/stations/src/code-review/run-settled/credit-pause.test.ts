import { describe, expect, it } from "vitest";
import type { Report, Tools } from "@re-cinq/floor-station";
import type { VisitView } from "@re-cinq/floor-client";
import type { LoopKey } from "@re-cinq/lore-shared/loops/loop-kinds.js";
import type { LoopPause } from "@re-cinq/lore-shared/loops/loop-pause.js";
import {
  planRun,
  planVisit,
} from "@re-cinq/lore-shared/floor/recorded-plan-floor.js";
import { pausingLoopsOnCredit } from "./credit-pause.js";

const TOOLS: Tools = {
  read: () => Promise.resolve(Buffer.from("")),
  produce: () => Promise.resolve(),
  modelCall: () => Promise.resolve(),
  signal: new AbortController().signal,
};

const CREDIT =
  "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.";
const NOW = new Date("2026-10-30T10:00:00.000Z");

function scene(lineId: string, outcome: string, visits: VisitView[]) {
  const pauses: Array<{ repo: string; key: LoopKey; pause: LoopPause }> = [];
  let nextCalled = false;
  const handle = pausingLoopsOnCredit(
    {
      run: () =>
        Promise.resolve(
          planRun({ id: "run-1", lineId, repo: "github.com/acme/widgets" }),
        ),
      visits: () => Promise.resolve(visits),
      pauseLoop: async (repo, key, pause) => {
        pauses.push({ repo, key, pause });
      },
      now: () => NOW,
    },
    (): Promise<Report> => {
      nextCalled = true;

      return Promise.resolve({ outcome: "success" });
    },
  );
  const settle = () =>
    handle(
      {
        visitId: "visit-1",
        iteration: 1,
        needs: { run_id: "run-1", line_id: lineId, outcome },
      },
      TOOLS,
    );

  return { settle, pauses, nextCalled: () => nextCalled };
}

describe("pausingLoopsOnCredit", () => {
  it("pauses the implementation loop of acme/widgets when tdd-round ran out of credit", async () => {
    const { settle, pauses } = scene("implementation-loop", "failed", [
      planVisit("dod", { outcome: "success" }),
      planVisit("tdd-round", { outcome: "failed", error: CREDIT }),
    ]);

    await settle();

    expect(pauses).toEqual([
      {
        repo: "acme/widgets",
        key: "implementation",
        pause: {
          reason: "model credit exhausted",
          run_id: "run-1",
          at: "2026-10-30T10:00:00.000Z",
          until: null,
        },
      },
    ]);
  });

  it("pauses the tickets loop when a spec-tickets service station ran out of quota", async () => {
    const { settle, pauses } = scene("spec-tickets", "error", [
      planVisit("file-tickets", {
        outcome: "failed",
        error:
          "429 You exceeded your current quota, please check your plan and billing details.",
      }),
    ]);

    await settle();

    expect(pauses.map(({ key }) => key)).toEqual(["tickets"]);
  });

  it("pauses nothing when the round failed on red tests", async () => {
    const { settle, pauses } = scene("implementation-loop", "failed", [
      planVisit("tdd-round", { outcome: "failed", error: "3 tests failed" }),
    ]);

    await settle();

    expect(pauses).toEqual([]);
  });

  it("pauses nothing when an onboard run ran out of credit", async () => {
    const { settle, pauses } = scene("onboard", "failed", [
      planVisit("author", { outcome: "failed", error: CREDIT }),
    ]);

    await settle();

    expect(pauses).toEqual([]);
  });

  it("pauses nothing when the review that ran out of credit succeeded on its retry", async () => {
    const { settle, pauses } = scene("code-review", "success", [
      planVisit("review", { outcome: "failed", error: CREDIT }),
      planVisit("review", { outcome: "success" }),
    ]);

    await settle();

    expect(pauses).toEqual([]);
  });

  it("hands the settled run on to the next step after pausing", async () => {
    const { settle, nextCalled } = scene("issue-triage", "failed", [
      planVisit("triage", { outcome: "failed", error: CREDIT }),
    ]);

    expect(await settle()).toEqual({ outcome: "success" });
    expect(nextCalled()).toBe(true);
  });

  it("pauses the triage loop when reproduce ran out of credit and the run ended green through label-failed", async () => {
    const { settle, pauses } = scene("issue-triage", "success", [
      planVisit("reproduce", { outcome: "failed", error: CREDIT }),
      planVisit("label-failed", { outcome: "success" }),
    ]);

    await settle();

    expect(pauses.map(({ key }) => key)).toEqual(["triage"]);
  });
});

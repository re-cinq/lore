import { describe, expect, it } from "vitest";
import type { RefineProposal } from "@re-cinq/planning-document";
import {
  NEVER_STARTED,
  clearStaleAsks,
  staleAskSlots,
  type StaleAskDeps,
} from "./stale-refine-asks.js";

const NOW = new Date("2026-11-14T02:00:00.000Z");

function asked(slot: string, askedAt: string): RefineProposal {
  return {
    status: "asked",
    slot,
    baseHash: "h",
    askedBy: "Szabo Bogdan",
    askedAt,
  };
}

const SIX_MINUTES_AGO = "2026-11-14T01:54:00.000Z";
const ONE_MINUTE_AGO = "2026-11-14T01:59:00.000Z";

describe("staleAskSlots", () => {
  it("names the scope ask made six minutes ago and leaves the intent ask made a minute ago", () => {
    expect(
      staleAskSlots(
        [asked("scope", SIX_MINUTES_AGO), asked("intent", ONE_MINUTE_AGO)],
        NOW,
      ),
    ).toEqual(["scope"]);
  });
});

function plan143(given: { working: boolean; asks: RefineProposal[] }) {
  const failed: Array<{ planId: string; slot: string; reason: string }> = [];
  const deps: StaleAskDeps = {
    asks: async () => given.asks,
    agentWorking: async () => given.working,
    failRefine: async (request) => {
      failed.push(request);
    },
  };

  return { deps, failed };
}

const PLAN = { id: "143a6e64", repo: "re-cinq/lore" };

describe("clearStaleAsks", () => {
  it("fails plan 143a6e64's scope ask from six minutes ago when no agent works on the plan", async () => {
    const { deps, failed } = plan143({
      working: false,
      asks: [asked("scope", SIX_MINUTES_AGO)],
    });

    await clearStaleAsks(deps, PLAN, NOW);

    expect(failed).toEqual([
      { planId: "143a6e64", slot: "scope", reason: NEVER_STARTED },
    ]);
  });

  it("leaves plan 143a6e64's scope ask alone while an agent works on the plan", async () => {
    const { deps, failed } = plan143({
      working: true,
      asks: [asked("scope", SIX_MINUTES_AGO)],
    });

    await clearStaleAsks(deps, PLAN, NOW);

    expect(failed).toEqual([]);
  });
});

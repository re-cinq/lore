import { describe, it, expect } from "vitest";
import { shouldDropOverlay, dropOverlayEvent } from "./drop-overlay.js";

describe("shouldDropOverlay", () => {
  it("asks for a drop when an implementation run closes", () => {
    expect(
      shouldDropOverlay({ blueprintName: "implementation", repo: "o/r" }),
    ).toBe(true);
  });

  it("refuses for an ingest run, whose drop would start another ingest run forever", () => {
    expect(shouldDropOverlay({ blueprintName: "ingest", repo: "o/r" })).toBe(
      false,
    );
  });

  it("refuses for a run with no repo, which can own no overlay", () => {
    expect(
      shouldDropOverlay({ blueprintName: "implementation", repo: null }),
    ).toBe(false);
  });
});

describe("dropOverlayEvent", () => {
  it("names the run's repo, the overlay-drop kind, and the run whose overlay goes", () => {
    expect(
      dropOverlayEvent({
        id: "run-42",
        repo: "o/r",
      } as Parameters<typeof dropOverlayEvent>[0]),
    ).toEqual({
      eventName: "internal.ingest.spec_trace",
      params: {
        repo: "o/r",
        kind: "overlay-drop",
        payload: { assemblyRunId: "run-42" },
      },
      dedupeKey: "overlay-drop:run-42",
    });
  });
});

import { describe, it, expect } from "vitest";
import { roundInFlight, ROUND_IN_FLIGHT_MS, type FeatureIteration } from "./features-port.js";

const now = 1_000_000_000_000;
function iter(over: Partial<FeatureIteration>): FeatureIteration {
  return {
    id: "i",
    feature_id: "f",
    iteration: 1,
    task_id: "t",
    status: "ready",
    user_answers: null,
    gap_result: null,
    created_at: new Date(now).toISOString(),
    updated_at: new Date(now).toISOString(),
    ...over,
  };
}

describe("roundInFlight", () => {
  it("returns a recent running iteration (a round is in flight)", () => {
    const running = iter({ iteration: 3, status: "running", created_at: new Date(now - 60_000).toISOString() });
    expect(roundInFlight([iter({ iteration: 2, status: "ready" }), running], now)).toBe(running);
  });

  it("returns null when the only running iteration is older than the window (orphaned)", () => {
    const orphan = iter({
      iteration: 3,
      status: "running",
      created_at: new Date(now - (ROUND_IN_FLIGHT_MS + 60_000)).toISOString(),
    });
    expect(roundInFlight([orphan], now)).toBeNull();
  });

  it("returns null when no iteration is running", () => {
    expect(roundInFlight([iter({ status: "ready" }), iter({ status: "failed" })], now)).toBeNull();
  });
});

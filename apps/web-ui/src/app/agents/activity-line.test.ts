import { describe, it, expect } from "vitest";
import { activityLine } from "./activity-line";

const loopDod = {
  name: "loop-dod",
  visits: 12,
  cost_usd: 3.4,
  tokens_in: 1_200_000,
  tokens_out: 64_000,
};

describe("activityLine", () => {
  it("returns 12 runs · $3.40 · 1.3M tokens for loop-dod's last 30 days", () => {
    expect(activityLine({ "loop-dod": loopDod }, "loop-dod")).toBe(
      "12 runs · $3.40 · 1.3M tokens",
    );
  });

  it("returns 1 run when the definition ran once", () => {
    expect(
      activityLine({ "loop-dod": { ...loopDod, visits: 1 } }, "loop-dod"),
    ).toMatch(/^1 run · /);
  });

  it("returns No runs for a definition the floor did not run", () => {
    expect(activityLine({ "loop-dod": loopDod }, "loop-sync")).toBe("No runs");
  });

  it("returns a dash when the activity is unknown", () => {
    expect(activityLine(null, "loop-dod")).toBe("—");
  });
});

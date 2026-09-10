import { describe, it, expect } from "vitest";
import { decideGitCredential } from "./grant.js";

const claims = {
  stationRunId: "4fd0f8d9-3fc2-4c4d-9471-a9e4f1eb24c7",
  repo: "re-cinq/bowman-ui",
  expiresAt: "2026-09-10T18:00:00.000Z",
};

describe("decideGitCredential", () => {
  it("grants re-cinq/bowman-ui to the still-open station run its credential names", () => {
    expect(
      decideGitCredential({
        claims,
        stationRun: { stationRunId: claims.stationRunId, outcome: null },
        repo: "re-cinq/bowman-ui",
      }),
    ).toEqual({ grant: true, repo: "re-cinq/bowman-ui" });
  });
});

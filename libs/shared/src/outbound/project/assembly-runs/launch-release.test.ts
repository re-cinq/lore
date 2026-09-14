import { describe, expect, it } from "vitest";
import { launchAttemptsFromEnv, launchReleaseOf } from "./launch-release.js";

describe("launchReleaseOf", () => {
  it("marks an installation token refused for an unreachable repository as a permanent github-permission release", () => {
    const reason =
      "There is at least one repository that does not exist or is not accessible to the parent installation.";

    expect(launchReleaseOf(reason, 3)).toEqual({
      reason,
      failureClass: "github-permission",
      permanent: true,
      maxAttempts: 3,
    });
  });

  it("marks an unrecognised launch error as a retryable unknown release under the given bound", () => {
    expect(launchReleaseOf("GitHub not configured", 5)).toEqual({
      reason: "GitHub not configured",
      failureClass: "unknown",
      permanent: false,
      maxAttempts: 5,
    });
  });
});

describe("launchAttemptsFromEnv", () => {
  it("reads 5 from LORE_STATION_LAUNCH_ATTEMPTS and falls back to 3 when it is 0 or unset", () => {
    expect(launchAttemptsFromEnv({ LORE_STATION_LAUNCH_ATTEMPTS: "5" })).toBe(
      5,
    );
    expect(launchAttemptsFromEnv({ LORE_STATION_LAUNCH_ATTEMPTS: "0" })).toBe(
      3,
    );
    expect(launchAttemptsFromEnv({})).toBe(3);
  });
});

import { describe, it, expect, beforeEach } from "vitest";
import {
  projectFor,
  stationBackendNow,
  useStationBackend,
  resetStationBackend,
} from "./project-boot.js";
import type { StationBackend } from "@re-cinq/lore-shared";

const fakeBackend = { isActive: async () => true } as unknown as StationBackend;

describe("project-boot wiring", () => {
  beforeEach(() => {
    resetStationBackend();
  });

  it("names the composition root when projectFor runs before anything wired it", async () => {
    await expect(projectFor("o/unwired")).rejects.toThrow(
      /no station backend registered/,
    );
  });

  it("names the composition root when stationBackendNow runs before anything wired it", async () => {
    await expect(stationBackendNow()).rejects.toThrow(
      /no station backend registered/,
    );
  });

  it("hands back the backend the composition root registered", async () => {
    useStationBackend(async () => fakeBackend);

    expect(await stationBackendNow()).toBe(fakeBackend);
  });

  it("retries the build after a rejection rather than caching the failure", async () => {
    await expect(projectFor("o/retry")).rejects.toThrow();
    useStationBackend(async () => fakeBackend);

    await expect(projectFor("o/retry")).rejects.not.toThrow(
      /no station backend registered/,
    );
  });
});

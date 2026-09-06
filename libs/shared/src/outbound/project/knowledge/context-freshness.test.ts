import { describe, it, expect } from "vitest";
import { computeFreshness } from "./context-assembly.js";

const DAY_MS = 86400000;

describe("computeFreshness", () => {
  const now = new Date("2026-08-05T12:00:00.000Z");

  it("returns fresh when ingested three days ago", () => {
    const lastIngestedAt = new Date(now.getTime() - 3 * DAY_MS);

    expect(computeFreshness(lastIngestedAt, now)).toEqual("fresh");
  });

  it("returns stale when ingested ten days ago", () => {
    const lastIngestedAt = new Date(now.getTime() - 10 * DAY_MS);

    expect(computeFreshness(lastIngestedAt, now)).toEqual("stale");
  });

  it("returns never-ingested when last ingested is null", () => {
    expect(computeFreshness(null, now)).toEqual("never-ingested");
  });

  it("returns fresh when ingested exactly seven days ago", () => {
    const lastIngestedAt = new Date(now.getTime() - 7 * DAY_MS);

    expect(computeFreshness(lastIngestedAt, now)).toEqual("fresh");
  });

  it("returns stale from an ISO string ingested twenty days ago", () => {
    expect(computeFreshness("2026-07-16T12:00:00.000Z", now)).toEqual("stale");
  });
});

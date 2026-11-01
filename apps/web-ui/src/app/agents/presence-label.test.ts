import { describe, it, expect } from "vitest";
import { presenceLabel } from "./presence-label";

describe("presenceLabel", () => {
  it("returns On every cluster: east, west when both hold the latest version", () => {
    expect(
      presenceLabel({
        state: "all",
        latest: "h2",
        clusters: [
          { id: "east", hash: "h2", current: true },
          { id: "west", hash: "h2", current: true },
        ],
      }),
    ).toBe("On every cluster: east, west");
  });

  it("names west as behind and north as holding none while east has the latest", () => {
    expect(
      presenceLabel({
        state: "some",
        latest: "h2",
        clusters: [
          { id: "east", hash: "h2", current: true },
          { id: "west", hash: "h1", current: false },
          { id: "north", hash: null, current: false },
        ],
      }),
    ).toBe(
      "Not live everywhere yet. Latest: east. Older version: west. None: north",
    );
  });

  it("returns On no cluster yet when no cluster holds any version", () => {
    expect(presenceLabel({ state: "none", latest: "h2", clusters: [] })).toBe(
      "On no cluster yet",
    );
  });
});

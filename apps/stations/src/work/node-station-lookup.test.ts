import { describe, it, expect } from "vitest";
import { nodeStationFor } from "./node-station-lookup.js";

describe("nodeStationFor", () => {
  it("finds a station whose folder name matches the node type", () => {
    expect(nodeStationFor("validate")?.manifest.name).toBe("validate");
  });

  it("finds a station by its exact node type, hyphen and all", () => {
    expect(nodeStationFor("comment-triage")?.manifest.name).toBe(
      "comment-triage",
    );
  });

  it("returns nothing for a node type no station claims, rather than a wrong one", () => {
    expect(nodeStationFor("agent")).toBeUndefined();
  });

  it("returns nothing for a station NAME that is not also a node type", () => {
    expect(nodeStationFor("approval-check")).toBeUndefined();
  });
});

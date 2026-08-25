import { describe, it, expect } from "vitest";
import { nodeStationFor } from "./node-station-lookup.js";

/**
 * A blueprint names a node TYPE; the registry is keyed by the station's folder
 * NAME. They coincide today, but not every station HAS a node type — a sweep has
 * a folder and a URL and no node at all — so resolving by folder name would let
 * a blueprint dispatch a node that cannot exist.
 */
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
    // approval-check is a sweep: it has a folder and a URL, but no node type.
    // Resolving it here would let a blueprint dispatch a node that cannot exist.
    expect(nodeStationFor("approval-check")).toBeUndefined();
  });
});

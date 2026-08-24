import { describe, it, expect } from "vitest";
import { nodeStationFor } from "./node-station-lookup.js";

/**
 * A blueprint names a node TYPE; the registry is keyed by the station's folder
 * NAME. They mostly coincide and, for the two that do not, an underscore is the
 * whole difference — which is exactly the kind of near-miss that reached a pod
 * and died there with `unknown station type`.
 */
describe("nodeStationFor", () => {
  it("finds a station whose folder name matches the node type", () => {
    expect(nodeStationFor("validate")?.manifest.name).toBe("validate");
  });

  it("finds a station whose node type differs from its folder name by an underscore", () => {
    expect(nodeStationFor("github_action")?.manifest.name).toBe(
      "github-action",
    );
  });

  it("returns nothing for a node type no station claims, rather than a wrong one", () => {
    expect(nodeStationFor("agent")).toBeUndefined();
  });

  it("returns nothing for a name that is a station's FOLDER but not its node type", () => {
    // "github-action" is the folder; the type is "github_action". Resolving the
    // folder name here would let a blueprint typo dispatch successfully.
    expect(nodeStationFor("github-action")).toBeUndefined();
  });
});

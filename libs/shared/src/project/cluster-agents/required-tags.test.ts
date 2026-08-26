import { describe, it, expect } from "vitest";
import {
  nodeTypeTag,
  tagsSatisfy,
  resolveRequiredTags,
} from "./required-tags.js";

describe("tagsSatisfy", () => {
  it("matches when every required tag is offered", () => {
    expect(tagsSatisfy(["node:agent", "gpu"], ["gpu", "node:agent", "x"])).toBe(
      true,
    );
  });

  it("refuses a run requiring gpu to an agent without it", () => {
    expect(tagsSatisfy(["gpu"], ["node:agent"])).toBe(false);
  });

  it("matches empty required tags against any agent, even a tagless one", () => {
    expect(tagsSatisfy([], [])).toBe(true);
    expect(tagsSatisfy([], ["gpu"])).toBe(true);
  });
});

describe("resolveRequiredTags", () => {
  it("always requires the node type's own tag — node:ingest for an ingest node", () => {
    expect(resolveRequiredTags("ingest", undefined, null)).toEqual([
      "node:ingest",
    ]);
    expect(resolveRequiredTags("agent", [], null)).toEqual(["node:agent"]);
  });

  it("adds the node's own list on top of the type tag, deduplicated", () => {
    expect(
      resolveRequiredTags("agent", ["gpu", "node:agent"], {
        station_default_tags: ["ignored"],
      }),
    ).toEqual(["node:agent", "gpu"]);
  });

  it("inherits the repo-level station_default_tags for an absent node list", () => {
    expect(
      resolveRequiredTags("validate", undefined, {
        station_default_tags: ["gpu"],
      }),
    ).toEqual(["node:validate", "gpu"]);
  });

  it("adds nothing beyond the type tag for absent or malformed defaults", () => {
    expect(resolveRequiredTags("gate", undefined, {})).toEqual(["node:gate"]);
    expect(
      resolveRequiredTags("gate", undefined, { station_default_tags: "gpu" }),
    ).toEqual(["node:gate"]);
    expect(
      resolveRequiredTags("gate", undefined, {
        station_default_tags: [1, "gpu"],
      }),
    ).toEqual(["node:gate"]);
  });
});

describe("nodeTypeTag", () => {
  it("prefixes the node type with node:", () => {
    expect(nodeTypeTag("comment-triage")).toBe("node:comment-triage");
  });
});

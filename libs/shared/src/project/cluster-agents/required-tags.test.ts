import { describe, it, expect } from "vitest";
import { tagsSatisfy, resolveRequiredTags } from "./required-tags.js";

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
  it("uses the node's own list when present, even when empty", () => {
    expect(
      resolveRequiredTags(["gpu"], { station_default_tags: ["node:agent"] }),
    ).toEqual(["gpu"]);
    expect(
      resolveRequiredTags([], { station_default_tags: ["node:agent"] }),
    ).toEqual([]);
  });

  it("inherits the repo-level station_default_tags for an absent node list", () => {
    expect(
      resolveRequiredTags(undefined, { station_default_tags: ["node:agent"] }),
    ).toEqual(["node:agent"]);
  });

  it("resolves to empty for absent settings, absent default, or a malformed default", () => {
    expect(resolveRequiredTags(undefined, null)).toEqual([]);
    expect(resolveRequiredTags(undefined, {})).toEqual([]);
    expect(
      resolveRequiredTags(undefined, { station_default_tags: "gpu" }),
    ).toEqual([]);
    expect(
      resolveRequiredTags(undefined, { station_default_tags: [1, "gpu"] }),
    ).toEqual([]);
  });
});

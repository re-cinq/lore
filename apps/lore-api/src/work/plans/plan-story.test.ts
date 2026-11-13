import { describe, expect, it } from "vitest";
import { storyOf } from "./plan-story.js";

describe("storyOf", () => {
  it("prefers saved story 12 over the run's 7", () => {
    expect(storyOf({ issueNumber: 12 }, 7)).toBe(12);
  });

  it("reads a removed story as none though the run names 7", () => {
    expect(storyOf({ issueNumber: null }, 7)).toBeNull();
  });

  it("falls back to the run's 7 when nothing was saved", () => {
    expect(storyOf(undefined, 7)).toBe(7);
  });

  it("reads none when nothing was saved and the run names no story", () => {
    expect(storyOf(undefined, null)).toBeNull();
  });
});

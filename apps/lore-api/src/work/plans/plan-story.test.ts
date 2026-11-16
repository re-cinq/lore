import { describe, expect, it } from "vitest";
import type { IssueRef } from "@re-cinq/lore-shared";
import {
  planStoryContext,
  storyOf,
  type PlanStoryPorts,
} from "./plan-story.js";

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

const PLAN = { id: "p1", repo: "re-cinq/lore" };

function storyPorts(saved: number | null): PlanStoryPorts {
  return {
    plan: async () => PLAN,
    stories: {
      saved: async () => ({ issueNumber: saved }),
      save: async () => undefined,
    },
    runStory: async () => null,
  };
}

const STORY_ISSUE: IssueRef = {
  repo: "re-cinq/lore",
  number: 12,
  title: "Faster checkout",
  state: "open",
  labels: [],
  body: "Shoppers leave at the price step.",
};

describe("planStoryContext", () => {
  it("hands the agents story #12 with its title and body", async () => {
    const context = await planStoryContext(
      "p1",
      storyPorts(12),
      async () => STORY_ISSUE,
    );

    expect(context).toEqual({
      number: 12,
      url: "https://github.com/re-cinq/lore/issues/12",
      title: "Faster checkout",
      state: "open",
      body: "Shoppers leave at the price step.",
    });
  });

  it("hands the agents no story for a plan without one", async () => {
    expect(
      await planStoryContext("p1", storyPorts(null), async () => STORY_ISSUE),
    ).toBeNull();
  });

  it("cuts story #12's body at 8000 characters", async () => {
    const long = { ...STORY_ISSUE, body: "x".repeat(9000) };
    const context = await planStoryContext(
      "p1",
      storyPorts(12),
      async () => long,
    );

    expect(context?.body?.length).toBe(8000);
  });

  it("keeps story #12's number and link when GitHub cannot read the issue", async () => {
    const context = await planStoryContext("p1", storyPorts(12), async () => {
      throw new Error("GitHub is down");
    });

    expect(context).toEqual({
      number: 12,
      url: "https://github.com/re-cinq/lore/issues/12",
      title: null,
      state: null,
      body: null,
    });
  });
});

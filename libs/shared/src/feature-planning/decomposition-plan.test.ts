import { describe, it, expect } from "vitest";
import { specTaskRows, storyIssueBody } from "./decomposition-plan.js";
import type { UserStory } from "./decomposition-result.js";

const story: UserStory = {
  title: "Favorite a repo",
  summary: "A developer can star a repo and revisit it from a Favorites list.",
  acceptance_criteria: [
    "Star toggles the favorite",
    "Favorites list shows starred repos",
  ],
  tasks: [
    {
      id: "T001",
      description: "Add favorites table",
      depends_on: [],
      parallelizable: false,
      phase: 1,
      file_path: "m.sql",
    },
    {
      id: "T002",
      description: "Star button",
      depends_on: ["T001"],
      parallelizable: true,
      phase: 2,
    },
  ],
};

describe("specTaskRows", () => {
  it("maps a story's tasks to spec-task rows linked to the story issue and feature", () => {
    expect(
      specTaskRows(story, {
        specSlug: "favorite-a-repo",
        featureId: "f1",
        storyIssue: 42,
      }),
    ).toEqual([
      {
        title: "T001: Add favorites table",
        metadata: {
          spec_task_id: "T001",
          depends_on: [],
          spec_slug: "favorite-a-repo",
          parallelizable: false,
          phase: 1,
          file_path: "m.sql",
          story_issue: 42,
          feature_id: "f1",
        },
      },
      {
        title: "T002: Star button",
        metadata: {
          spec_task_id: "T002",
          depends_on: ["T001"],
          spec_slug: "favorite-a-repo",
          parallelizable: true,
          phase: 2,
          feature_id: "f1",
          story_issue: 42,
        },
      },
    ]);
  });

  it("omits story_issue when no Issue was created (tasks-only mode)", () => {
    const rows = specTaskRows(story, { specSlug: "fav", featureId: "f1" });
    expect(rows[0].metadata.story_issue).toBeUndefined();
    expect(rows[0].metadata.feature_id).toBe("f1");
  });
});

describe("storyIssueBody", () => {
  it("renders the summary, acceptance criteria, task list, and a spec link", () => {
    const body = storyIssueBody(story, {
      specPath: "specs/favorite-a-repo/spec.md",
      featureTitle: "Favorites",
    });
    expect(body).toContain("A developer can star a repo");
    expect(body).toContain("Star toggles the favorite");
    expect(body).toContain("T001: Add favorites table");
    expect(body).toContain("specs/favorite-a-repo/spec.md");
  });
});
